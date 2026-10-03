//! One bridged stream: a WebSocket connection to a local endpoint, carried
//! over the relay connection as frames tagged with the relay's stream id.
//!
//! The relay names a module and an endpoint, never an address. The bridge
//! dials only what an [`EndpointResolver`] answers, and the resolver answers
//! only with addresses the companion discovered or the streamer confirmed.

use std::time::Duration;

use tokio::sync::{mpsc, watch};
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::error::{Error as WsError, ProtocolError, SubProtocolError};
use tokio_tungstenite::tungstenite::http::header::SEC_WEBSOCKET_PROTOCOL;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async_with_config, MaybeTlsStream, WebSocketStream};

use futures::{SinkExt, StreamExt};
use tokio::net::TcpStream;

use crate::address::{websocket_url, ConfirmedAddress};
use crate::budget::{ByteBudget, Charge};
use crate::frame::{self, Frame, FrameKind, ToRelay, MAX_PAYLOAD};

/// What the bridge may dial. Answers only for endpoints that are enabled, on a
/// module installed on this companion's instance, that the bridge can carry
/// (`websocket` endpoints), with an address this companion discovered or the
/// streamer confirmed. The relay names an endpoint, never an address.
pub trait EndpointResolver: Send + Sync + 'static {
    fn resolve(&self, module_id: &str, endpoint_id: &str) -> Option<ConfirmedAddress>;

    /// Marked changed whenever `resolve` may answer differently. The relay
    /// client then checks every open stream again and closes, with 4403, each
    /// one whose endpoint no longer resolves to the address it dialled.
    fn changes(&self) -> watch::Receiver<()>;
}

/// Close codes the companion sends for a stream. Must match what the relay
/// forwards to the engine (woofx3-maintenance worker/src/relay/companion-relay.ts).
pub mod close_code {
    pub const NORMAL: u16 = 1000;
    /// The local server accepted none of the subprotocols the engine offered.
    pub const PROTOCOL_ERROR: u16 = 1002;
    pub const INVALID_PAYLOAD: u16 = 1007;
    pub const MESSAGE_TOO_BIG: u16 = 1009;
    pub const INTERNAL_ERROR: u16 = 1011;
    /// The endpoint is unknown, disabled or not on this instance.
    pub const FORBIDDEN: u16 = 4403;
}

/// A message from the relay for one stream. Dropping the bridge's sender is
/// how the relay side closes it.
pub(crate) struct FromRelayData {
    pub kind: FrameKind,
    pub payload: Vec<u8>,
    /// Held against the stream's inbound budget until written locally.
    pub charge: Charge,
}

/// A message for the relay connection's writer. Stream data carries a charge
/// against its stream's outbound budget, released once it is written.
pub(crate) struct Outgoing {
    pub message: Message,
    pub charge: Option<Charge>,
}

pub(crate) struct BridgeContext {
    pub sid: u32,
    pub address: ConfirmedAddress,
    pub protocols: Vec<String>,
    pub from_relay: mpsc::Receiver<FromRelayData>,
    pub to_relay: mpsc::Sender<Outgoing>,
    /// What this stream may have queued for the relay at once.
    pub outbound: ByteBudget,
    /// Told the stream id when the bridge finishes, so the session forgets it.
    pub ended: mpsc::UnboundedSender<u32>,
    pub dial_timeout: Duration,
    pub write_timeout: Duration,
}

type LocalSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub(crate) async fn run_bridge(mut cx: BridgeContext) {
    let sid = cx.sid;
    let (local, protocol) = match dial(&cx.address, &cx.protocols, cx.dial_timeout).await {
        Ok(dialled) => dialled,
        Err(error) => {
            send_close(&cx.to_relay, sid, error.close_code(), error.reason()).await;
            let _ = cx.ended.send(sid);
            return;
        }
    };
    if send_control(&cx.to_relay, ToRelay::Opened { sid, protocol })
        .await
        .is_err()
    {
        let _ = cx.ended.send(sid);
        return;
    }

    let (mut local_write, mut local_read) = local.split();
    let relay_close: Option<(u16, String)> = loop {
        tokio::select! {
            data = cx.from_relay.recv() => {
                let Some(data) = data else {
                    // The relay closed the stream, or the session is ending.
                    let _ = timeout(cx.write_timeout, local_write.close()).await;
                    break None;
                };
                let FromRelayData { kind, payload, charge } = data;
                let message = match kind {
                    FrameKind::WsBinary => Message::binary(payload),
                    FrameKind::WsText => match String::from_utf8(payload) {
                        Ok(text) => Message::text(text),
                        Err(_) => break Some((close_code::INVALID_PAYLOAD, "text frame is not UTF-8".into())),
                    },
                };
                let written = timeout(cx.write_timeout, local_write.send(message)).await;
                drop(charge);
                match written {
                    Ok(Ok(())) => {}
                    _ => break Some((close_code::INTERNAL_ERROR, "local endpoint stopped accepting messages".into())),
                }
            }
            message = local_read.next() => {
                let (kind, payload) = match message {
                    Some(Ok(Message::Text(text))) => (FrameKind::WsText, text.as_bytes().to_vec()),
                    Some(Ok(Message::Binary(bytes))) => (FrameKind::WsBinary, bytes.to_vec()),
                    Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => continue,
                    Some(Ok(Message::Close(frame))) => {
                        let (code, reason) = frame
                            .map(|frame| (u16::from(frame.code), frame.reason.to_string()))
                            .unwrap_or((close_code::NORMAL, String::new()));
                        break Some((sendable_close_code(code), reason));
                    }
                    Some(Err(WsError::Capacity(_))) => {
                        break Some((close_code::MESSAGE_TOO_BIG, "message exceeds the relay's limit".into()));
                    }
                    Some(Err(_)) | None => {
                        break Some((close_code::INTERNAL_ERROR, "local endpoint dropped the connection".into()));
                    }
                };
                let bytes = frame::encode(&Frame { kind, stream_id: sid, payload })
                    .expect("the local socket caps messages at the frame payload limit");
                let Some(charge) = cx.outbound.charge(bytes.len()) else {
                    break Some((close_code::MESSAGE_TOO_BIG, "local endpoint is sending faster than the relay takes it".into()));
                };
                // A full writer channel makes this wait, which stops reading
                // from the local endpoint: the companion's half of flow control.
                let outgoing = Outgoing { message: Message::binary(bytes), charge: Some(charge) };
                if cx.to_relay.send(outgoing).await.is_err() {
                    break None;
                }
            }
        }
    };

    if let Some((code, reason)) = relay_close {
        let _ = timeout(cx.write_timeout, local_write.close()).await;
        send_close(&cx.to_relay, sid, code, reason).await;
    }
    let _ = cx.ended.send(sid);
}

/// Opens the local WebSocket, offering the engine's subprotocols, and returns
/// the protocol the local server chose. When the engine offered some and the
/// server picked none, the stream fails with 1002: the engine asked for a
/// protocol, and handing it a socket that speaks something else would only
/// fail later and less clearly.
async fn dial(
    address: &ConfirmedAddress,
    protocols: &[String],
    dial_timeout: Duration,
) -> Result<(LocalSocket, Option<String>), DialError> {
    if let Some(bad) = protocols.iter().find(|protocol| !is_token(protocol)) {
        return Err(DialError::InvalidProtocol(bad.clone()));
    }
    connect(address, protocols, dial_timeout).await
}

/// What one WebSocket handshake with a local endpoint found. The companion
/// window's Test button shows it; like the bridge's close reasons, it never
/// names the address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProbeOutcome {
    /// The handshake completed. `protocol` is the subprotocol the server chose.
    Reachable {
        protocol: Option<String>,
    },
    Refused {
        reason: String,
    },
    TimedOut,
}

/// Dials `address` exactly as the bridge would, offering `protocols`, then
/// closes the connection at once. Nothing is sent but the handshake, so
/// protocol authentication (such as obs-websocket's password) is not tried.
pub async fn probe(
    address: &ConfirmedAddress,
    protocols: &[String],
    within: Duration,
) -> ProbeOutcome {
    let dialled = match dial(address, protocols, within).await {
        // Unlike the bridge, a probe only asks whether something answers, so
        // a server that ignores the offer still counts. tungstenite treats
        // an ignored offer as fatal, so the probe dials again without one.
        Err(error) if error.is_no_subprotocol() => connect(address, &[], within).await,
        other => other,
    };
    match dialled {
        Ok((mut socket, protocol)) => {
            let _ = timeout(within, socket.close(None)).await;
            ProbeOutcome::Reachable { protocol }
        }
        Err(DialError::TimedOut) => ProbeOutcome::TimedOut,
        Err(error) => ProbeOutcome::Refused {
            reason: error.reason(),
        },
    }
}

enum DialError {
    InvalidProtocol(String),
    TimedOut,
    Ws(WsError),
}

impl DialError {
    fn is_no_subprotocol(&self) -> bool {
        matches!(
            self,
            DialError::Ws(WsError::Protocol(
                ProtocolError::SecWebSocketSubProtocolError(SubProtocolError::NoSubProtocol)
            ))
        )
    }

    fn close_code(&self) -> u16 {
        if self.is_no_subprotocol() {
            close_code::PROTOCOL_ERROR
        } else {
            close_code::INTERNAL_ERROR
        }
    }

    /// Safe to send to the relay: it names no address.
    fn reason(&self) -> String {
        if self.is_no_subprotocol() {
            return "local endpoint accepted none of the offered subprotocols".to_string();
        }
        match self {
            DialError::InvalidProtocol(protocol) => format!("invalid subprotocol {protocol:?}"),
            DialError::TimedOut => "local endpoint did not answer in time".to_string(),
            DialError::Ws(WsError::Io(_)) => "local endpoint refused the connection".to_string(),
            DialError::Ws(_) => "local endpoint refused the WebSocket handshake".to_string(),
        }
    }
}

async fn connect(
    address: &ConfirmedAddress,
    protocols: &[String],
    dial_timeout: Duration,
) -> Result<(LocalSocket, Option<String>), DialError> {
    let mut request = websocket_url(address)
        .into_client_request()
        .map_err(DialError::Ws)?;
    if !protocols.is_empty() {
        let offer =
            HeaderValue::from_str(&protocols.join(", ")).expect("tokens are valid header values");
        request.headers_mut().insert(SEC_WEBSOCKET_PROTOCOL, offer);
    }
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_PAYLOAD))
        .max_frame_size(Some(MAX_PAYLOAD));
    let (socket, response) = timeout(
        dial_timeout,
        connect_async_with_config(request, Some(config), true),
    )
    .await
    .map_err(|_| DialError::TimedOut)?
    .map_err(DialError::Ws)?;
    let protocol = response
        .headers()
        .get(SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    Ok((socket, protocol))
}

/// An RFC 6455 subprotocol is an RFC 2616 token: visible ASCII without
/// separators. Anything else could smuggle a second offer into the header.
fn is_token(protocol: &str) -> bool {
    const SEPARATORS: &[u8] = b"()<>@,;:\\\"/[]?={} \t";
    !protocol.is_empty()
        && protocol
            .bytes()
            .all(|b| b.is_ascii_graphic() && !SEPARATORS.contains(&b))
}

/// 1005, 1006 and 1015 describe a close and may not be sent in one.
fn sendable_close_code(code: u16) -> u16 {
    match CloseCode::from(code) {
        CloseCode::Status | CloseCode::Abnormal | CloseCode::Tls => close_code::NORMAL,
        _ => code,
    }
}

pub(crate) async fn send_control(
    to_relay: &mpsc::Sender<Outgoing>,
    control: ToRelay,
) -> Result<(), ()> {
    let outgoing = Outgoing {
        message: Message::text(control.to_json()),
        charge: None,
    };
    to_relay.send(outgoing).await.map_err(|_| ())
}

pub(crate) async fn send_close(
    to_relay: &mpsc::Sender<Outgoing>,
    sid: u32,
    code: u16,
    reason: impl Into<String>,
) {
    let _ = send_control(
        to_relay,
        ToRelay::Close {
            sid,
            code,
            reason: reason.into(),
        },
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subprotocols_must_be_tokens() {
        assert!(is_token("obswebsocket.json"));
        assert!(is_token("obswebsocket.msgpack"));
        assert!(!is_token(""));
        assert!(!is_token("a, b"));
        assert!(!is_token("a b"));
        assert!(!is_token("a\r\nX-Injected: 1"));
    }

    #[test]
    fn descriptive_close_codes_become_normal() {
        assert_eq!(sendable_close_code(1005), 1000);
        assert_eq!(sendable_close_code(1006), 1000);
        assert_eq!(sendable_close_code(1015), 1000);
        assert_eq!(sendable_close_code(1001), 1001);
        assert_eq!(sendable_close_code(4000), 4000);
    }
}
