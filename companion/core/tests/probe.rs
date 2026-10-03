//! `probe`, the one-off handshake behind the companion window's Test button,
//! against servers on loopback.

// tungstenite's handshake callback must return its own large `ErrorResponse`.
#![allow(clippy::result_large_err)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::http::HeaderValue;

use woofx3_companion_core::{probe, ConfirmedAddress, ProbeOutcome};

const WITHIN: Duration = Duration::from_millis(500);

fn obs_protocols() -> Vec<String> {
    vec!["obswebsocket.json".to_string()]
}

/// Accepts WebSocket handshakes, choosing `obswebsocket.json` when it is
/// offered and `choose_protocol` is set. Counts TCP connections.
async fn server(choose_protocol: bool) -> (u16, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let dials = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&dials);
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            counted.fetch_add(1, Ordering::SeqCst);
            tokio::spawn(async move {
                let _ = tokio_tungstenite::accept_hdr_async(
                    stream,
                    move |request: &Request, mut response: Response| {
                        let offered = request
                            .headers()
                            .get("sec-websocket-protocol")
                            .and_then(|value| value.to_str().ok())
                            .unwrap_or_default();
                        if choose_protocol && offered.contains("obswebsocket.json") {
                            response.headers_mut().insert(
                                "sec-websocket-protocol",
                                HeaderValue::from_static("obswebsocket.json"),
                            );
                        }
                        Ok(response)
                    },
                )
                .await;
            });
        }
    });
    (port, dials)
}

fn loopback(port: u16) -> ConfirmedAddress {
    ConfirmedAddress::confirmed(&format!("127.0.0.1:{port}")).unwrap()
}

#[tokio::test]
async fn reports_the_protocol_the_server_chose() {
    let (port, _) = server(true).await;
    assert_eq!(
        probe(&loopback(port), &obs_protocols(), WITHIN).await,
        ProbeOutcome::Reachable {
            protocol: Some("obswebsocket.json".into())
        }
    );
}

#[tokio::test]
async fn reports_msgpack_when_that_is_what_the_server_speaks() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let _ = tokio_tungstenite::accept_hdr_async(
            stream,
            |_request: &Request, mut response: Response| {
                response.headers_mut().insert(
                    "sec-websocket-protocol",
                    HeaderValue::from_static("obswebsocket.msgpack"),
                );
                Ok(response)
            },
        )
        .await;
    });
    let both = vec![
        "obswebsocket.json".to_string(),
        "obswebsocket.msgpack".to_string(),
    ];
    assert_eq!(
        probe(&loopback(port), &both, WITHIN).await,
        ProbeOutcome::Reachable {
            protocol: Some("obswebsocket.msgpack".into())
        }
    );
}

#[tokio::test]
async fn a_server_that_ignores_the_offer_is_still_reachable() {
    let (port, _) = server(false).await;
    assert_eq!(
        probe(&loopback(port), &obs_protocols(), WITHIN).await,
        ProbeOutcome::Reachable { protocol: None }
    );
}

#[tokio::test]
async fn nothing_listening_is_refused_without_naming_the_address() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let outcome = probe(&loopback(port), &[], WITHIN).await;
    let ProbeOutcome::Refused { reason } = outcome else {
        panic!("expected Refused, got {outcome:?}");
    };
    assert!(!reason.contains("127.0.0.1"), "{reason}");
    assert!(!reason.contains(&port.to_string()), "{reason}");
}

#[tokio::test]
async fn a_server_that_never_answers_times_out() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    // Accepts the TCP connection and holds it without a handshake.
    tokio::spawn(async move {
        let mut held = Vec::new();
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            held.push(stream);
        }
    });
    assert_eq!(
        probe(&loopback(port), &[], Duration::from_millis(200)).await,
        ProbeOutcome::TimedOut
    );
}

#[tokio::test]
async fn an_invalid_subprotocol_is_refused_before_dialling() {
    let (port, dials) = server(true).await;
    let outcome = probe(&loopback(port), &["a, b".to_string()], WITHIN).await;
    assert!(
        matches!(outcome, ProbeOutcome::Refused { .. }),
        "{outcome:?}"
    );
    assert_eq!(dials.load(Ordering::SeqCst), 0);
}
