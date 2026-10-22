//! The gateway client against proxy settings in the environment. A binary
//! of its own, because it sets process-wide variables that tests running in
//! parallel would also see.

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use woofx3_companion_core::host::{ClientCredentials, EngineGateway, HttpEngineGateway};

/// The `/api` URL of an engine stand-in that accepts one request and
/// answers it with `body`, and the task that ends once it has.
async fn stand_in(body: &'static str) -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let url = format!("http://{}/api", listener.local_addr().expect("address"));
    let answered = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.expect("a request");
        let mut request = Vec::new();
        let mut chunk = [0u8; 4096];
        // The whole request: headers, then a body of content-length bytes.
        loop {
            let read = socket.read(&mut chunk).await.expect("read the request");
            assert!(read > 0, "the client closed before sending a whole request");
            request.extend_from_slice(&chunk[..read]);
            let text = String::from_utf8_lossy(&request).to_string();
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
            if request.len() >= header_end + 4 + length {
                break;
            }
        }
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        socket
            .write_all(response.as_bytes())
            .await
            .expect("write the response");
    });
    (url, answered)
}

fn credentials() -> ClientCredentials {
    ClientCredentials {
        client_id: "id-1".to_string(),
        client_secret: "s3cret".to_string(),
    }
}

#[tokio::test]
async fn test_http_engine_gateway_ignores_proxies_from_the_environment() {
    // A proxy that is not there: a client that used it could not connect.
    let closed = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let proxy = format!("http://{}", closed.local_addr().expect("address"));
    drop(closed);
    std::env::set_var("HTTP_PROXY", &proxy);
    std::env::set_var("http_proxy", &proxy);
    std::env::set_var("ALL_PROXY", &proxy);

    let (url, answered) = stand_in("[\"resolve\",2,{\"version\":\"dev\"}]").await;
    let verified = HttpEngineGateway::new(url, Duration::from_secs(5))
        .expect("a client")
        .verify(&credentials())
        .await;
    std::env::remove_var("HTTP_PROXY");
    std::env::remove_var("http_proxy");
    std::env::remove_var("ALL_PROXY");
    verified.expect("goes straight to the engine");
    tokio::time::timeout(Duration::from_secs(5), answered)
        .await
        .expect("the stand-in answered")
        .expect("the stand-in did not panic");
}
