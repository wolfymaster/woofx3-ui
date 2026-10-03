//! The relay client and the bridge against a fake relay and a fake OBS, both
//! tokio-tungstenite servers on loopback.

// tungstenite's handshake callback must return its own large `ErrorResponse`.
#![allow(clippy::result_large_err)]

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use futures::future::BoxFuture;
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, watch};
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::{HeaderValue, StatusCode};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use tokio_util::sync::CancellationToken;

use woofx3_companion_core::backoff::Backoff;
use woofx3_companion_core::frame::{self, Frame, FrameKind};
use woofx3_companion_core::{
    run_relay_with, ConfirmedAddress, CredentialSource, EndpointResolver, RelayGrant, RelayOptions,
    RelayStatus, Stopped,
};

const WAIT: Duration = Duration::from_secs(5);

// ---------------------------------------------------------------- fake relay

struct FakeRelay {
    url: String,
    connections: mpsc::UnboundedReceiver<RelayConnection>,
}

struct RelayConnection {
    authorization: String,
    socket: WebSocketStream<TcpStream>,
}

#[derive(Debug, PartialEq)]
enum FromCompanion {
    Control(Value),
    Frame(Frame),
    Closed,
}

/// `refuse_with` answers every upgrade with that HTTP status and body instead.
async fn fake_relay(refuse_with: Option<(StatusCode, &'static str)>) -> FakeRelay {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}/v1/companion", listener.local_addr().unwrap());
    let (sender, connections) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let authorization = Arc::new(Mutex::new(String::new()));
            let seen = Arc::clone(&authorization);
            let accepted = tokio_tungstenite::accept_hdr_async(
                stream,
                move |request: &Request, response: Response| {
                    *seen.lock().unwrap() = header(request, "authorization");
                    match refuse_with {
                        Some((status, body)) => {
                            let body = (!body.is_empty()).then(|| body.to_string());
                            let mut refusal = ErrorResponse::new(body);
                            *refusal.status_mut() = status;
                            Err(refusal)
                        }
                        None => Ok(response),
                    }
                },
            )
            .await;
            if let Ok(socket) = accepted {
                let authorization = authorization.lock().unwrap().clone();
                let _ = sender.send(RelayConnection {
                    authorization,
                    socket,
                });
            }
        }
    });
    FakeRelay { url, connections }
}

impl FakeRelay {
    async fn next_connection(&mut self) -> RelayConnection {
        timeout(WAIT, self.connections.recv())
            .await
            .expect("the companion did not connect")
            .unwrap()
    }
}

impl RelayConnection {
    /// The next message from the companion, skipping pings.
    async fn next(&mut self) -> FromCompanion {
        loop {
            let message = timeout(WAIT, self.socket.next())
                .await
                .expect("the companion sent nothing");
            match message {
                Some(Ok(Message::Text(text))) => {
                    let value: Value = serde_json::from_str(text.as_str()).unwrap();
                    if value == json!({ "t": "ping" }) {
                        continue;
                    }
                    return FromCompanion::Control(value);
                }
                Some(Ok(Message::Binary(bytes))) => {
                    return FromCompanion::Frame(frame::decode(&bytes).expect("a valid frame"));
                }
                Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => continue,
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return FromCompanion::Closed,
            }
        }
    }

    async fn control(&mut self, value: Value) {
        self.socket
            .send(Message::text(value.to_string()))
            .await
            .unwrap();
    }

    async fn frame(&mut self, kind: FrameKind, stream_id: u32, payload: &[u8]) {
        let bytes = frame::encode(&Frame {
            kind,
            stream_id,
            payload: payload.to_vec(),
        })
        .unwrap();
        self.socket.send(Message::binary(bytes)).await.unwrap();
    }

    async fn open_obs(&mut self, sid: u32) {
        self.control(json!({
            "t": "open", "sid": sid, "module": "woofx3_obs", "endpoint": "obs", "protocols": ["obswebsocket.json"]
        }))
        .await;
    }
}

fn header(request: &Request, name: &str) -> String {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string()
}

// ------------------------------------------------------------------ fake OBS

const OBS_PROTOCOLS: [&str; 2] = ["obswebsocket.json", "obswebsocket.msgpack"];

#[derive(Debug, PartialEq)]
enum ObsEvent {
    Connected,
    Closed,
}

struct FakeObs {
    port: u16,
    /// TCP connections accepted, whether or not the handshake succeeded.
    dials: Arc<AtomicUsize>,
    events: mpsc::UnboundedReceiver<ObsEvent>,
}

/// Requires one of obs-websocket's subprotocols and, like obs-websocket,
/// picks the first one offered that it speaks. Echoes text as `echo:<text>`
/// and binary unchanged; answers `big:<n>` with `n` binary bytes; closes the
/// connection on `bye`.
async fn fake_obs() -> FakeObs {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let dials = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&dials);
    let (events_tx, events) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            counted.fetch_add(1, Ordering::SeqCst);
            let events_tx = events_tx.clone();
            tokio::spawn(async move {
                let accepted = tokio_tungstenite::accept_hdr_async(
                    stream,
                    |request: &Request, mut response: Response| {
                        let offered = header(request, "sec-websocket-protocol");
                        let chosen = offered
                            .split(',')
                            .map(str::trim)
                            .find(|protocol| OBS_PROTOCOLS.contains(protocol));
                        if let Some(chosen) = chosen {
                            response.headers_mut().insert(
                                "sec-websocket-protocol",
                                HeaderValue::from_str(chosen).unwrap(),
                            );
                            Ok(response)
                        } else {
                            let mut refusal = ErrorResponse::new(None);
                            *refusal.status_mut() = StatusCode::BAD_REQUEST;
                            Err(refusal)
                        }
                    },
                )
                .await;
                let Ok(mut socket) = accepted else {
                    return;
                };
                let _ = events_tx.send(ObsEvent::Connected);
                while let Some(Ok(message)) = socket.next().await {
                    match message {
                        Message::Text(text) if text.as_str() == "bye" => {
                            let _ = socket
                                .send(Message::Close(Some(CloseFrame {
                                    code: CloseCode::Normal,
                                    reason: "bye".into(),
                                })))
                                .await;
                        }
                        Message::Text(text) if text.as_str().starts_with("big:") => {
                            let size: usize = text.as_str()["big:".len()..].parse().unwrap();
                            let _ = socket.send(Message::binary(vec![7u8; size])).await;
                        }
                        Message::Text(text) => {
                            let _ = socket
                                .send(Message::text(format!("echo:{}", text.as_str())))
                                .await;
                        }
                        Message::Binary(bytes) => {
                            let _ = socket.send(Message::Binary(bytes)).await;
                        }
                        Message::Close(_) => break,
                        _ => {}
                    }
                }
                let _ = events_tx.send(ObsEvent::Closed);
            });
        }
    });
    FakeObs {
        port,
        dials,
        events,
    }
}

impl FakeObs {
    async fn next_event(&mut self) -> ObsEvent {
        timeout(WAIT, self.events.recv())
            .await
            .expect("OBS saw nothing")
            .unwrap()
    }

    fn dials(&self) -> usize {
        self.dials.load(Ordering::SeqCst)
    }
}

/// A port nothing listens on.
async fn closed_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    listener.local_addr().unwrap().port()
}

// --------------------------------------------------- resolver and credentials

/// Endpoints keyed `module/endpoint`, each with an enabled flag, standing in
/// for the companion's integration store.
struct Endpoints {
    entries: Mutex<HashMap<String, (bool, ConfirmedAddress)>>,
    changes: watch::Sender<()>,
}

impl Endpoints {
    fn obs(port: u16, enabled: bool) -> Arc<Self> {
        let address = ConfirmedAddress::discovered_loopback(port);
        Arc::new(Endpoints {
            entries: Mutex::new(HashMap::from([(
                "woofx3_obs/obs".to_string(),
                (enabled, address),
            )])),
            changes: watch::channel(()).0,
        })
    }

    /// Changes the OBS endpoint, as the window's commands change the store.
    fn set_obs(&self, enabled: bool, port: u16) {
        self.entries.lock().unwrap().insert(
            "woofx3_obs/obs".to_string(),
            (enabled, ConfirmedAddress::discovered_loopback(port)),
        );
        self.changes.send_replace(());
    }

    /// Reports a change that leaves every answer the same.
    fn touch(&self) {
        self.changes.send_replace(());
    }
}

impl EndpointResolver for Endpoints {
    fn resolve(&self, module_id: &str, endpoint_id: &str) -> Option<ConfirmedAddress> {
        match self
            .entries
            .lock()
            .unwrap()
            .get(&format!("{module_id}/{endpoint_id}"))
        {
            Some((true, address)) => Some(address.clone()),
            _ => None,
        }
    }

    fn changes(&self) -> watch::Receiver<()> {
        self.changes.subscribe()
    }
}

/// Hands out the scripted grants in order, then `None` (revoked).
struct Credentials {
    relay_url: String,
    script: Mutex<VecDeque<Option<(&'static str, Duration)>>>,
}

impl Credentials {
    fn new(relay_url: &str, script: Vec<Option<(&'static str, Duration)>>) -> Arc<Self> {
        Arc::new(Credentials {
            relay_url: relay_url.to_string(),
            script: Mutex::new(script.into()),
        })
    }

    fn lasting(relay_url: &str) -> Arc<Self> {
        let hour = Duration::from_secs(3600);
        Self::new(relay_url, (0..20).map(|_| Some(("cred", hour))).collect())
    }
}

impl CredentialSource for Credentials {
    fn mint(&self) -> BoxFuture<'_, anyhow::Result<Option<RelayGrant>>> {
        let next = self.script.lock().unwrap().pop_front().flatten();
        Box::pin(async move {
            Ok(next.map(|(credential, lifetime)| RelayGrant {
                relay_url: self.relay_url.clone(),
                credential: credential.to_string(),
                expires_at: SystemTime::now() + lifetime,
            }))
        })
    }
}

// -------------------------------------------------------------------- client

struct Client {
    status: watch::Receiver<RelayStatus>,
    cancel: CancellationToken,
    task: tokio::task::JoinHandle<()>,
}

fn quick_options() -> RelayOptions {
    RelayOptions {
        backoff: Backoff {
            initial: Duration::from_millis(200),
            max: Duration::from_millis(400),
        },
        ..RelayOptions::default()
    }
}

fn start(
    credentials: Arc<dyn CredentialSource>,
    endpoints: Arc<dyn EndpointResolver>,
    options: RelayOptions,
) -> Client {
    let (status_tx, status) = watch::channel(RelayStatus::Connecting);
    let cancel = CancellationToken::new();
    let task = tokio::spawn(run_relay_with(
        credentials,
        endpoints,
        status_tx,
        cancel.clone(),
        options,
    ));
    Client {
        status,
        cancel,
        task,
    }
}

impl Client {
    async fn wait_for(&mut self, wanted: impl Fn(&RelayStatus) -> bool) -> RelayStatus {
        timeout(WAIT, self.status.wait_for(|status| wanted(status)))
            .await
            .expect("status never arrived")
            .unwrap()
            .clone()
    }

    async fn stopped(mut self) -> Stopped {
        let status = self
            .wait_for(|status| matches!(status, RelayStatus::Stopped(_)))
            .await;
        timeout(WAIT, self.task)
            .await
            .expect("run_relay did not return")
            .unwrap();
        match status {
            RelayStatus::Stopped(stopped) => stopped,
            other => unreachable!("{other:?}"),
        }
    }
}

fn text(stream_id: u32, payload: &str) -> FromCompanion {
    FromCompanion::Frame(Frame {
        kind: FrameKind::WsText,
        stream_id,
        payload: payload.as_bytes().to_vec(),
    })
}

// --------------------------------------------------------------------- tests

/// sceneManager's obs-websocket-js runs its msgpack build under Bun, so the
/// engine offers only `obswebsocket.msgpack` and every message is binary.
#[tokio::test]
async fn bridges_obs_msgpack_as_binary_frames_unchanged() {
    let mut relay = fake_relay(None).await;
    let mut obs = fake_obs().await;
    let client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(obs.port, true),
        quick_options(),
    );

    let mut connection = relay.next_connection().await;
    connection
        .control(json!({
            "t": "open", "sid": 3, "module": "woofx3_obs", "endpoint": "obs", "protocols": ["obswebsocket.msgpack"]
        }))
        .await;
    assert_eq!(
        connection.next().await,
        FromCompanion::Control(
            json!({ "t": "opened", "sid": 3, "protocol": "obswebsocket.msgpack" })
        )
    );
    assert_eq!(obs.next_event().await, ObsEvent::Connected);

    // A msgpack Identify-shaped map, including bytes that are not UTF-8.
    let payload = [0x82, 0xa2, b'o', b'p', 0x01, 0xa1, b'd', 0x80, 0xff, 0x00];
    connection.frame(FrameKind::WsBinary, 3, &payload).await;
    assert_eq!(
        connection.next().await,
        FromCompanion::Frame(Frame {
            kind: FrameKind::WsBinary,
            stream_id: 3,
            payload: payload.to_vec(),
        })
    );

    client.cancel.cancel();
    assert_eq!(client.stopped().await, Stopped::Cancelled);
}

#[tokio::test]
async fn bridges_obs_through_the_relay_with_its_subprotocol() {
    let mut relay = fake_relay(None).await;
    let mut obs = fake_obs().await;
    let client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(obs.port, true),
        quick_options(),
    );

    let mut connection = relay.next_connection().await;
    assert_eq!(connection.authorization, "Bearer cred");

    connection.open_obs(1).await;
    assert_eq!(
        connection.next().await,
        FromCompanion::Control(json!({ "t": "opened", "sid": 1, "protocol": "obswebsocket.json" }))
    );
    assert_eq!(obs.next_event().await, ObsEvent::Connected);

    connection.frame(FrameKind::WsText, 1, br#"{"op":1}"#).await;
    assert_eq!(connection.next().await, text(1, r#"echo:{"op":1}"#));

    connection
        .frame(FrameKind::WsBinary, 1, &[0xde, 0xad])
        .await;
    assert_eq!(
        connection.next().await,
        FromCompanion::Frame(Frame {
            kind: FrameKind::WsBinary,
            stream_id: 1,
            payload: vec![0xde, 0xad],
        })
    );

    client.cancel.cancel();
    assert_eq!(client.stopped().await, Stopped::Cancelled);
    assert_eq!(obs.next_event().await, ObsEvent::Closed);
}

#[tokio::test]
async fn carries_several_streams_at_once() {
    let mut relay = fake_relay(None).await;
    let obs = fake_obs().await;
    let _client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(obs.port, true),
        quick_options(),
    );
    let mut connection = relay.next_connection().await;

    connection.open_obs(1).await;
    connection.next().await;
    connection.open_obs(2).await;
    connection.next().await;

    connection.frame(FrameKind::WsText, 2, b"two").await;
    assert_eq!(connection.next().await, text(2, "echo:two"));
    connection.frame(FrameKind::WsText, 1, b"one").await;
    assert_eq!(connection.next().await, text(1, "echo:one"));
    assert_eq!(obs.dials(), 2);
}

#[tokio::test]
async fn refuses_unknown_and_disabled_endpoints_without_dialling() {
    let mut relay = fake_relay(None).await;
    let obs = fake_obs().await;
    let _client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(obs.port, false),
        quick_options(),
    );
    let mut connection = relay.next_connection().await;

    // Disabled.
    connection.open_obs(1).await;
    let refused = connection.next().await;
    assert_eq!(
        refused,
        FromCompanion::Control(
            json!({ "t": "close", "sid": 1, "code": 4403, "reason": "endpoint is not enabled on this companion" })
        )
    );

    // Unknown, and carrying an address the companion must not use.
    connection
        .control(json!({
            "t": "open", "sid": 2, "module": "woofx3_router", "endpoint": "admin", "protocols": [],
            "host": "127.0.0.1", "port": obs.port, "address": format!("127.0.0.1:{}", obs.port)
        }))
        .await;
    match connection.next().await {
        FromCompanion::Control(value) => {
            assert_eq!(value["t"], "close");
            assert_eq!(value["sid"], 2);
            assert_eq!(value["code"], 4403);
        }
        other => panic!("{other:?}"),
    }

    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(
        obs.dials(),
        0,
        "nothing may be dialled for a refused endpoint"
    );
}

#[tokio::test]
async fn reports_a_refused_local_connection_as_1011() {
    let mut relay = fake_relay(None).await;
    let port = closed_port().await;
    let _client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(port, true),
        quick_options(),
    );
    let mut connection = relay.next_connection().await;

    connection.open_obs(1).await;
    match connection.next().await {
        FromCompanion::Control(value) => {
            assert_eq!(value["t"], "close");
            assert_eq!(value["sid"], 1);
            assert_eq!(value["code"], 1011);
            let reason = value["reason"].as_str().unwrap();
            assert!(
                !reason.contains(&port.to_string()),
                "the reason names no address: {reason}"
            );
        }
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn a_relay_close_closes_obs_and_an_obs_close_reaches_the_relay() {
    let mut relay = fake_relay(None).await;
    let mut obs = fake_obs().await;
    let _client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(obs.port, true),
        quick_options(),
    );
    let mut connection = relay.next_connection().await;

    connection.open_obs(1).await;
    connection.next().await;
    assert_eq!(obs.next_event().await, ObsEvent::Connected);
    connection
        .control(json!({ "t": "close", "sid": 1, "code": 1000, "reason": "" }))
        .await;
    assert_eq!(obs.next_event().await, ObsEvent::Closed);

    connection.open_obs(2).await;
    connection.next().await;
    assert_eq!(obs.next_event().await, ObsEvent::Connected);
    connection.frame(FrameKind::WsText, 2, b"bye").await;
    assert_eq!(
        connection.next().await,
        FromCompanion::Control(json!({ "t": "close", "sid": 2, "code": 1000, "reason": "bye" }))
    );
}

#[tokio::test]
async fn invalid_utf8_in_a_text_frame_closes_the_stream_with_1007() {
    let mut relay = fake_relay(None).await;
    let mut obs = fake_obs().await;
    let _client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(obs.port, true),
        quick_options(),
    );
    let mut connection = relay.next_connection().await;

    connection.open_obs(1).await;
    connection.next().await;
    connection.frame(FrameKind::WsText, 1, &[0xff, 0xfe]).await;
    match connection.next().await {
        FromCompanion::Control(value) => {
            assert_eq!(value["t"], "close");
            assert_eq!(value["code"], 1007);
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(obs.next_event().await, ObsEvent::Connected);
    assert_eq!(obs.next_event().await, ObsEvent::Closed);
}

#[tokio::test]
async fn refreshes_the_credential_before_it_expires_and_stops_when_revoked() {
    let mut relay = fake_relay(None).await;
    let obs = fake_obs().await;
    let lifetime = Duration::from_secs(3);
    let credentials = Credentials::new(
        &relay.url,
        vec![Some(("first", lifetime)), Some(("second", lifetime)), None],
    );
    let client = start(credentials, Endpoints::obs(obs.port, true), quick_options());

    let mut connection = relay.next_connection().await;
    assert_eq!(connection.authorization, "Bearer first");
    let started = std::time::Instant::now();
    assert_eq!(
        connection.next().await,
        FromCompanion::Control(json!({ "t": "refresh", "credential": "second" }))
    );
    assert!(
        started.elapsed() < lifetime,
        "refresh came after expiry: {:?}",
        started.elapsed()
    );

    // The next renewal is refused: woofx3 revoked the companion.
    assert_eq!(client.stopped().await, Stopped::Unauthorized);
    assert_eq!(connection.next().await, FromCompanion::Closed);
}

#[tokio::test]
async fn stops_without_connecting_when_no_credential_is_issued() {
    let mut relay = fake_relay(None).await;
    let client = start(
        Credentials::new(&relay.url, vec![None]),
        Endpoints::obs(1, true),
        quick_options(),
    );
    assert_eq!(client.stopped().await, Stopped::Unauthorized);
    assert!(relay.connections.try_recv().is_err());
}

#[tokio::test]
async fn a_dropped_relay_closes_bridges_then_reconnects_with_backoff() {
    let mut relay = fake_relay(None).await;
    let mut obs = fake_obs().await;
    let mut client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(obs.port, true),
        quick_options(),
    );

    let mut connection = relay.next_connection().await;
    connection.open_obs(1).await;
    connection.next().await;
    assert_eq!(obs.next_event().await, ObsEvent::Connected);

    drop(connection);
    let retrying = client
        .wait_for(|status| matches!(status, RelayStatus::Retrying { .. }))
        .await;
    let RelayStatus::Retrying { after, .. } = retrying else {
        unreachable!()
    };
    assert!(
        after >= Duration::from_millis(100) && after <= Duration::from_millis(200),
        "{after:?}"
    );
    // The bridge's local socket closes before the client reconnects.
    assert_eq!(obs.next_event().await, ObsEvent::Closed);
    assert!(
        relay.connections.try_recv().is_err(),
        "reconnected before closing the bridge"
    );

    let mut again = relay.next_connection().await;
    client
        .wait_for(|status| *status == RelayStatus::Connected)
        .await;
    again.open_obs(2).await;
    assert_eq!(
        again.next().await,
        FromCompanion::Control(json!({ "t": "opened", "sid": 2, "protocol": "obswebsocket.json" }))
    );
}

#[tokio::test]
async fn a_malformed_frame_drops_the_connection_and_reconnects() {
    let mut relay = fake_relay(None).await;
    let _client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(1, true),
        quick_options(),
    );
    let mut connection = relay.next_connection().await;
    connection
        .socket
        .send(Message::binary(vec![9, 9, 9]))
        .await
        .unwrap();
    assert_eq!(connection.next().await, FromCompanion::Closed);
    relay.next_connection().await;
}

#[tokio::test]
async fn stops_when_displaced_by_another_companion() {
    let mut relay = fake_relay(None).await;
    let client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(1, true),
        quick_options(),
    );
    let mut connection = relay.next_connection().await;
    connection
        .socket
        .send(Message::Close(Some(CloseFrame {
            code: CloseCode::from(4001),
            reason: "displaced".into(),
        })))
        .await
        .unwrap();
    assert_eq!(client.stopped().await, Stopped::Displaced);
}

#[tokio::test]
async fn reconnects_when_replaced_by_its_own_newer_connection() {
    let mut relay = fake_relay(None).await;
    let mut client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(1, true),
        quick_options(),
    );
    let mut connection = relay.next_connection().await;
    connection
        .socket
        .send(Message::Close(Some(CloseFrame {
            code: CloseCode::from(4000),
            reason: "replaced".into(),
        })))
        .await
        .unwrap();
    client
        .wait_for(|status| matches!(status, RelayStatus::Retrying { .. }))
        .await;
    relay.next_connection().await;
}

#[tokio::test]
async fn stops_when_the_relay_refuses_the_upgrade_as_displaced() {
    let relay = fake_relay(Some((StatusCode::CONFLICT, r#"{"error":"displaced"}"#))).await;
    let client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(1, true),
        quick_options(),
    );
    assert_eq!(client.stopped().await, Stopped::Displaced);
}

#[tokio::test]
async fn mints_again_when_the_relay_calls_the_credential_stale() {
    let relay = fake_relay(Some((
        StatusCode::CONFLICT,
        r#"{"error":"stale_credential"}"#,
    )))
    .await;
    let credentials = Credentials::lasting(&relay.url);
    let mut client = start(
        Arc::clone(&credentials) as Arc<dyn CredentialSource>,
        Endpoints::obs(1, true),
        quick_options(),
    );
    let status = client
        .wait_for(|status| matches!(status, RelayStatus::Retrying { .. }))
        .await;
    let RelayStatus::Retrying { error, .. } = status else {
        unreachable!()
    };
    assert_eq!(error, "the relay asked for a fresh credential");
    client
        .wait_for(|status| matches!(status, RelayStatus::Connecting))
        .await;
    client
        .wait_for(|status| matches!(status, RelayStatus::Retrying { .. }))
        .await;
    assert!(
        credentials.script.lock().unwrap().len() <= 18,
        "each attempt mints its own credential"
    );
}

#[tokio::test]
async fn retries_when_the_relay_refuses_the_credential() {
    let relay = fake_relay(Some((StatusCode::UNAUTHORIZED, ""))).await;
    let mut client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(1, true),
        quick_options(),
    );
    let status = client
        .wait_for(|status| matches!(status, RelayStatus::Retrying { .. }))
        .await;
    let RelayStatus::Retrying { error, .. } = status else {
        unreachable!()
    };
    assert!(error.contains("401"), "{error}");
    assert!(
        !error.contains("cred"),
        "the error names no credential: {error}"
    );
}

#[tokio::test]
async fn pings_the_relay_and_drops_a_silent_one() {
    let mut relay = fake_relay(None).await;
    let options = RelayOptions {
        ping_interval: Duration::from_millis(100),
        idle_timeout: Duration::from_millis(500),
        ..quick_options()
    };
    let mut client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(1, true),
        options,
    );
    let mut connection = relay.next_connection().await;

    let message = timeout(WAIT, connection.socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(message, Message::text(r#"{"t":"ping"}"#));

    // The fake relay never answers, so the client gives up on it.
    let status = client
        .wait_for(|status| matches!(status, RelayStatus::Retrying { .. }))
        .await;
    let RelayStatus::Retrying { error, .. } = status else {
        unreachable!()
    };
    assert_eq!(error, "the relay stopped answering");
    relay.next_connection().await;
}

#[tokio::test]
async fn a_local_server_that_ignores_the_offered_subprotocol_fails_the_stream_with_1002() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let Ok(mut socket) = tokio_tungstenite::accept_async(stream).await else {
                    return;
                };
                while let Some(Ok(Message::Text(text))) = socket.next().await {
                    let _ = socket
                        .send(Message::text(format!("plain:{}", text.as_str())))
                        .await;
                }
            });
        }
    });

    let mut relay = fake_relay(None).await;
    let _client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(port, true),
        quick_options(),
    );
    let mut connection = relay.next_connection().await;
    connection.open_obs(1).await;
    match connection.next().await {
        FromCompanion::Control(value) => {
            assert_eq!(value["t"], "close");
            assert_eq!(value["sid"], 1);
            assert_eq!(value["code"], 1002);
        }
        other => panic!("{other:?}"),
    }
}

/// Opens stream 1 to the fake OBS and checks it carries a message.
async fn open_and_check(connection: &mut RelayConnection, obs: &mut FakeObs) {
    connection.open_obs(1).await;
    assert!(matches!(
        connection.next().await,
        FromCompanion::Control(value) if value["t"] == "opened"
    ));
    assert_eq!(obs.next_event().await, ObsEvent::Connected);
    connection.frame(FrameKind::WsText, 1, b"one").await;
    assert_eq!(connection.next().await, text(1, "echo:one"));
}

fn forbidden_close(sid: u32) -> FromCompanion {
    FromCompanion::Control(json!({
        "t": "close", "sid": sid, "code": 4403, "reason": "endpoint is no longer enabled on this companion"
    }))
}

#[tokio::test]
async fn turning_an_endpoint_off_closes_its_open_streams() {
    let mut relay = fake_relay(None).await;
    let mut obs = fake_obs().await;
    let endpoints = Endpoints::obs(obs.port, true);
    let _client = start(
        Credentials::lasting(&relay.url),
        Arc::clone(&endpoints) as Arc<dyn EndpointResolver>,
        quick_options(),
    );
    let mut connection = relay.next_connection().await;
    open_and_check(&mut connection, &mut obs).await;

    endpoints.set_obs(false, obs.port);
    assert_eq!(connection.next().await, forbidden_close(1));
    assert_eq!(obs.next_event().await, ObsEvent::Closed);
}

#[tokio::test]
async fn a_new_address_closes_streams_to_the_old_one() {
    let mut relay = fake_relay(None).await;
    let mut obs = fake_obs().await;
    let endpoints = Endpoints::obs(obs.port, true);
    let _client = start(
        Credentials::lasting(&relay.url),
        Arc::clone(&endpoints) as Arc<dyn EndpointResolver>,
        quick_options(),
    );
    let mut connection = relay.next_connection().await;
    open_and_check(&mut connection, &mut obs).await;

    endpoints.set_obs(true, closed_port().await);
    assert_eq!(connection.next().await, forbidden_close(1));
    assert_eq!(obs.next_event().await, ObsEvent::Closed);
}

#[tokio::test]
async fn a_change_that_leaves_the_address_alone_keeps_the_stream() {
    let mut relay = fake_relay(None).await;
    let mut obs = fake_obs().await;
    let endpoints = Endpoints::obs(obs.port, true);
    let _client = start(
        Credentials::lasting(&relay.url),
        Arc::clone(&endpoints) as Arc<dyn EndpointResolver>,
        quick_options(),
    );
    let mut connection = relay.next_connection().await;
    open_and_check(&mut connection, &mut obs).await;

    endpoints.touch();
    endpoints.set_obs(true, obs.port);
    connection.frame(FrameKind::WsText, 1, b"two").await;
    assert_eq!(connection.next().await, text(1, "echo:two"));
}

fn small_buffers() -> RelayOptions {
    RelayOptions {
        stream_buffer_bytes: 1024,
        ..quick_options()
    }
}

fn too_big_close(value: &FromCompanion) -> bool {
    matches!(value, FromCompanion::Control(value) if value["t"] == "close" && value["sid"] == 1 && value["code"] == 1009)
}

#[tokio::test]
async fn a_message_over_the_inbound_byte_budget_closes_the_stream_with_1009() {
    let mut relay = fake_relay(None).await;
    let mut obs = fake_obs().await;
    let _client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(obs.port, true),
        small_buffers(),
    );
    let mut connection = relay.next_connection().await;
    open_and_check(&mut connection, &mut obs).await;

    connection.frame(FrameKind::WsBinary, 1, &[0u8; 2048]).await;
    let closed = connection.next().await;
    assert!(too_big_close(&closed), "{closed:?}");
}

#[tokio::test]
async fn a_message_over_the_outbound_byte_budget_closes_the_stream_with_1009() {
    let mut relay = fake_relay(None).await;
    let mut obs = fake_obs().await;
    let _client = start(
        Credentials::lasting(&relay.url),
        Endpoints::obs(obs.port, true),
        small_buffers(),
    );
    let mut connection = relay.next_connection().await;
    open_and_check(&mut connection, &mut obs).await;

    connection.frame(FrameKind::WsText, 1, b"big:2048").await;
    let closed = connection.next().await;
    assert!(too_big_close(&closed), "{closed:?}");
    assert_eq!(obs.next_event().await, ObsEvent::Closed);
}
