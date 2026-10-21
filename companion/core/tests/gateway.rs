//! The engine gateway client against a stand-in `/api` on loopback that
//! answers with capnweb replies as the engine's capnweb 0.4.0 writes them.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use woofx3_companion_core::host::{ClientCredentials, EngineGateway, HostError, HttpEngineGateway};

const TIMEOUT: Duration = Duration::from_secs(5);

/// How the stand-in answers every request.
#[derive(Clone)]
enum Answer {
    Reply {
        status: u16,
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
                    let response = format!(
                        "HTTP/1.1 {status} X\r\ncontent-type: text/plain\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    socket
                        .write_all(response.as_bytes())
                        .await
                        .expect("write the response");
                }
                Answer::Silence => {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                }
            }
        }
    });
    (url, bodies)
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
    HttpEngineGateway::new(url, TIMEOUT).expect("a client")
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

#[tokio::test]
async fn test_http_engine_gateway_reports_credentials_the_engine_refuses() {
    let (url, _) = stand_in(Answer::Reply {
        status: 200,
        body: "[\"reject\",2,[\"error\",\"Error\",\"Invalid client credentials\"]]",
    })
    .await;
    assert!(matches!(
        gateway(url).verify(&credentials()).await,
        Err(HostError::EngineRefused { .. })
    ));
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
    let gateway = HttpEngineGateway::new(url, Duration::from_millis(200)).expect("a client");
    let started = std::time::Instant::now();
    assert!(matches!(
        gateway.verify(&credentials()).await,
        Err(HostError::EngineUnreachable(_))
    ));
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[test]
fn test_client_credentials_debug_output_redacts_the_secret() {
    let printed = format!("{:?}", credentials());
    assert!(printed.contains("id-1"));
    assert!(!printed.contains("s3cret"));
}
