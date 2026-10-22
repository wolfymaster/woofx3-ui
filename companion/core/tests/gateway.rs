//! The engine gateway client against a stand-in `/api` on loopback that
//! answers with capnweb replies as the engine's capnweb 0.4.0 writes them.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use woofx3_companion_core::host::{
    ClientCredentials, EngineGateway, GatewayTimeouts, HostError, HttpEngineGateway,
    TwitchHelixResult,
};

const TIMEOUT: Duration = Duration::from_secs(5);

/// How the stand-in answers every request.
#[derive(Clone)]
enum Answer {
    Reply {
        status: u16,
        body: &'static str,
    },
    /// Answers `body` after `delay`.
    Late {
        delay: Duration,
        body: &'static str,
    },
    /// Reads the request and never answers.
    Silence,
}

/// The `/api` URL of a stand-in that answers `answer`, and the request
/// bodies it received.
async fn stand_in(answer: Answer) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let url = format!("http://{}/api", listener.local_addr().expect("address"));
    let bodies = Arc::new(Mutex::new(Vec::new()));
    let received = Arc::clone(&bodies);
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let request = read_request(&mut socket).await;
            received.lock().expect("bodies lock").push(request);
            match &answer {
                Answer::Reply { status, body } => {
                    reply(&mut socket, *status, body).await;
                }
                Answer::Late { delay, body } => {
                    tokio::time::sleep(*delay).await;
                    reply(&mut socket, 200, body).await;
                }
                Answer::Silence => {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                }
            }
        }
    });
    (url, bodies)
}

/// Writes one HTTP response. A client that gave up has closed the socket,
/// so a failed write is the case under test, not an error.
async fn reply(socket: &mut tokio::net::TcpStream, status: u16, body: &str) {
    let response = format!(
        "HTTP/1.1 {status} X\r\ncontent-type: text/plain\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    let _client_may_have_gone = socket.write_all(response.as_bytes()).await;
}

/// The body of one HTTP request, read up to its Content-Length.
async fn read_request(socket: &mut tokio::net::TcpStream) -> String {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let read = socket.read(&mut chunk).await.expect("read the request");
        assert!(read > 0, "the client closed before sending a whole request");
        buffer.extend_from_slice(&chunk[..read]);
        let text = String::from_utf8_lossy(&buffer).to_string();
        let Some(header_end) = text.find("\r\n\r\n") else {
            continue;
        };
        let length = text[..header_end]
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())?
            })
            .unwrap_or(0);
        let body = &buffer[header_end + 4..];
        if body.len() >= length {
            return String::from_utf8_lossy(&body[..length]).to_string();
        }
    }
}

fn gateway(url: String) -> HttpEngineGateway {
    HttpEngineGateway::new(
        url,
        GatewayTimeouts {
            request: TIMEOUT,
            twitch_call: TIMEOUT,
        },
    )
    .expect("a client")
}

fn credentials() -> ClientCredentials {
    ClientCredentials {
        client_id: "id-1".to_string(),
        client_secret: "s3cret".to_string(),
    }
}

#[tokio::test]
async fn test_http_engine_gateway_registers_a_client() {
    let (url, bodies) = stand_in(Answer::Reply {
        status: 200,
        body: "[\"resolve\",1,{\"clientId\":\"id-1\",\"clientSecret\":\"s3cret\"}]",
    })
    .await;
    let registered = gateway(url)
        .register_client("woofx3-desktop", "tok")
        .await
        .expect("registers");
    assert_eq!(registered, credentials());
    assert_eq!(
        bodies.lock().expect("lock").as_slice(),
        ["[\"push\",[\"pipeline\",0,[\"registerClient\"],[\"woofx3-desktop\",{\"registrationToken\":\"tok\"}]]]\n[\"pull\",1]"]
    );
}

#[tokio::test]
async fn test_http_engine_gateway_reports_a_refused_registration() {
    let (url, _) = stand_in(Answer::Reply {
        status: 200,
        body: "[\"reject\",1,[\"error\",\"RegistrationRefused\",\"bad token\"]]",
    })
    .await;
    let err = gateway(url)
        .register_client("woofx3-desktop", "wrong")
        .await
        .expect_err("refused");
    assert!(
        matches!(&err, HostError::EngineRefused { name, message } if name == "RegistrationRefused" && message == "bad token"),
        "{err:?}"
    );
}

#[tokio::test]
async fn test_http_engine_gateway_verifies_credentials_in_one_batch() {
    let (url, bodies) = stand_in(Answer::Reply {
        status: 200,
        body: "[\"resolve\",2,{\"version\":\"dev\",\"hosting\":\"local\",\"overlayPublicUrl\":\"x\"}]",
    })
    .await;
    gateway(url).verify(&credentials()).await.expect("verifies");
    assert_eq!(
        bodies.lock().expect("lock").as_slice(),
        ["[\"push\",[\"pipeline\",0,[\"authenticate\"],[\"id-1\",\"s3cret\"]]]\n[\"push\",[\"pipeline\",1,[\"getEngineInfo\"],[]]]\n[\"pull\",2]"]
    );
}

/// Whether an error is the one a case expects.
type Expected = fn(&HostError) -> bool;

#[tokio::test]
async fn test_http_engine_gateway_tells_refused_credentials_from_other_failures() {
    let cases: [(&str, Expected); 4] = [
        (
            "[\"reject\",2,[\"error\",\"Error\",\"AuthenticationRefused: Invalid client credentials\"]]",
            |err| matches!(err, HostError::CredentialsRefused { .. }),
        ),
        (
            "[\"reject\",2,[\"error\",\"Error\",\"Invalid client credentials\"]]",
            |err| matches!(err, HostError::CredentialsRefused { .. }),
        ),
        (
            "[\"reject\",2,[\"error\",\"Error\",\"db-proxy unavailable\"]]",
            |err| matches!(err, HostError::EngineRefused { message, .. } if message == "db-proxy unavailable"),
        ),
        (
            "[\"abort\",[\"error\",\"Error\",\"the session broke\"]]",
            |err| matches!(err, HostError::EngineSessionAborted { message, .. } if message == "the session broke"),
        ),
    ];
    for (body, expected) in cases {
        let (url, _) = stand_in(Answer::Reply { status: 200, body }).await;
        let err = gateway(url)
            .verify(&credentials())
            .await
            .expect_err("fails");
        assert!(expected(&err), "{body}: {err:?}");
    }
}

#[tokio::test]
async fn test_http_engine_gateway_verify_ignores_values_it_does_not_read() {
    let (url, _) = stand_in(Answer::Reply {
        status: 200,
        body: "[\"resolve\",2,{\"version\":\"dev\",\"hosting\":[\"undefined\"],\"startedAt\":[\"date\",1]}]",
    })
    .await;
    gateway(url).verify(&credentials()).await.expect("verifies");
}

#[tokio::test]
async fn test_http_engine_gateway_reports_transport_failures() {
    let (url, _) = stand_in(Answer::Reply {
        status: 421,
        body: "Misdirected Request",
    })
    .await;
    assert!(matches!(
        gateway(url).verify(&credentials()).await,
        Err(HostError::EngineHttpStatus(421))
    ));

    let (url, _) = stand_in(Answer::Reply {
        status: 200,
        body: "<html>not capnweb</html>",
    })
    .await;
    assert!(matches!(
        gateway(url).verify(&credentials()).await,
        Err(HostError::EngineReplyUnreadable(_))
    ));

    let (url, _) = stand_in(Answer::Reply {
        status: 200,
        body: "[\"resolve\",1,{\"clientId\":\"id-1\"}]",
    })
    .await;
    assert!(matches!(
        gateway(url).register_client("woofx3-desktop", "tok").await,
        Err(HostError::EngineReplyUnreadable(_))
    ));

    let closed = {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        format!("http://{}/api", listener.local_addr().expect("address"))
    };
    assert!(matches!(
        gateway(closed).verify(&credentials()).await,
        Err(HostError::EngineUnreachable(_))
    ));
}

#[tokio::test]
async fn test_http_engine_gateway_gives_up_on_an_engine_that_never_answers() {
    let (url, _) = stand_in(Answer::Silence).await;
    let gateway = HttpEngineGateway::new(
        url,
        GatewayTimeouts {
            request: Duration::from_millis(200),
            twitch_call: Duration::from_millis(200),
        },
    )
    .expect("a client");
    let started = std::time::Instant::now();
    assert!(matches!(
        gateway.verify(&credentials()).await,
        Err(HostError::EngineUnreachable(_))
    ));
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[tokio::test]
async fn test_http_engine_gateway_sends_a_shoutout_in_one_batch() {
    let (url, bodies) = stand_in(Answer::Reply {
        status: 200,
        body: "[\"resolve\",2,{\"ok\":true,\"body\":null}]",
    })
    .await;
    let sent = gateway(url)
        .send_shoutout(&credentials(), "42")
        .await
        .expect("answered");
    assert_eq!(sent, TwitchHelixResult::Ok);
    assert_eq!(
        bodies.lock().expect("lock").as_slice(),
        ["[\"push\",[\"pipeline\",0,[\"authenticate\"],[\"id-1\",\"s3cret\"]]]\n[\"push\",[\"pipeline\",1,[\"twitchSendShoutout\"],[{\"to_broadcaster_id\":\"42\"}]]]\n[\"pull\",2]"]
    );
}

#[tokio::test]
async fn test_http_engine_gateway_creates_a_stream_marker_and_reads_a_refusal() {
    let (url, bodies) = stand_in(Answer::Reply {
        status: 200,
        body: "[\"resolve\",2,{\"ok\":false,\"code\":\"helix\",\"error\":\"Not Found\",\"status\":404,\"body\":\"{}\"}]",
    })
    .await;
    let created = gateway(url)
        .create_stream_marker(&credentials(), "Stream start")
        .await
        .expect("answered");
    assert_eq!(
        created,
        TwitchHelixResult::Refused {
            status: 404,
            body: "{}".to_string()
        }
    );
    assert_eq!(
        bodies.lock().expect("lock").as_slice(),
        ["[\"push\",[\"pipeline\",0,[\"authenticate\"],[\"id-1\",\"s3cret\"]]]\n[\"push\",[\"pipeline\",1,[\"twitchCreateStreamMarker\"],[{\"description\":\"Stream start\"}]]]\n[\"pull\",2]"]
    );
}

#[tokio::test]
async fn test_http_engine_gateway_reads_whether_the_stream_is_live() {
    let cases = [
        (
            "[\"resolve\",2,{\"isLive\":true,\"uptime\":\"00:01:00\",\"viewerCount\":3,\"streamTitle\":[\"undefined\"]}]",
            true,
        ),
        (
            "[\"resolve\",2,{\"isLive\":false,\"uptime\":\"00:00:00\",\"viewerCount\":0}]",
            false,
        ),
    ];
    for (body, live) in cases {
        let (url, bodies) = stand_in(Answer::Reply { status: 200, body }).await;
        assert_eq!(
            gateway(url)
                .is_live(&credentials())
                .await
                .expect("answered"),
            live,
            "{body}"
        );
        assert!(bodies.lock().expect("lock")[0].contains("[\"getStreamStatus\"],[]"));
    }

    let (url, _) = stand_in(Answer::Reply {
        status: 200,
        body: "[\"resolve\",2,{\"uptime\":\"00:00:00\"}]",
    })
    .await;
    assert!(matches!(
        gateway(url).is_live(&credentials()).await,
        Err(HostError::EngineReplyUnreadable(_))
    ));
}

#[tokio::test]
async fn test_http_engine_gateway_reports_refused_credentials_on_authenticated_calls() {
    let body = "[\"reject\",2,[\"error\",\"Error\",\"AuthenticationRefused: Invalid client credentials\"]]";
    let (url, _) = stand_in(Answer::Reply { status: 200, body }).await;
    let gateway = gateway(url);
    assert!(matches!(
        gateway.send_shoutout(&credentials(), "42").await,
        Err(HostError::CredentialsRefused { .. })
    ));
    assert!(matches!(
        gateway
            .create_stream_marker(&credentials(), "Stream start")
            .await,
        Err(HostError::CredentialsRefused { .. })
    ));
    assert!(matches!(
        gateway.is_live(&credentials()).await,
        Err(HostError::CredentialsRefused { .. })
    ));
}

/// A Twitch call waits past the request timeout for the engine's answer, so
/// the engine's own Twitch timeout reaches the host instead of the host
/// giving up on the engine first.
#[tokio::test]
async fn test_http_engine_gateway_waits_longer_for_calls_forwarded_to_twitch() {
    let timeouts = GatewayTimeouts {
        request: Duration::from_millis(200),
        twitch_call: Duration::from_secs(5),
    };
    let late = Duration::from_millis(600);

    let (url, _) = stand_in(Answer::Late {
        delay: late,
        body: "[\"resolve\",2,{\"ok\":false,\"code\":\"timeout\",\"error\":\"twitch did not answer\"}]",
    })
    .await;
    let gateway = HttpEngineGateway::new(url, timeouts).expect("a client");
    assert!(matches!(
        gateway.send_shoutout(&credentials(), "42").await,
        Ok(TwitchHelixResult::Failed { .. })
    ));
    assert!(gateway
        .create_stream_marker(&credentials(), "Stream start")
        .await
        .is_ok());

    let (url, _) = stand_in(Answer::Late {
        delay: late,
        body: "[\"resolve\",2,{\"isLive\":false,\"twitchUserId\":\"7\"}]",
    })
    .await;
    let gateway = HttpEngineGateway::new(url, timeouts).expect("a client");
    assert!(gateway.is_live(&credentials()).await.is_ok());
    assert!(matches!(
        gateway.verify(&credentials()).await,
        Err(HostError::EngineUnreachable(_))
    ));
}

#[test]
fn test_client_credentials_debug_output_redacts_the_secret() {
    let printed = format!("{:?}", credentials());
    assert!(printed.contains("id-1"));
    assert!(!printed.contains("s3cret"));
}
