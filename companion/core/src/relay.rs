//! The companion's outbound connection to the relay, at the URL Convex
//! returns with each credential, which carries every bridged stream.
//!
//! The client mints a credential, connects with it as a Bearer token, renews it
//! on the open connection before it expires, and reconnects with jittered
//! backoff when the connection drops. It stops for good when woofx3 will no
//! longer issue a credential, when the relay says another companion displaced
//! it (close code 4001, or a 409 whose body says `displaced`), or when
//! cancelled. Credentials and stream payloads never appear in a status or an
//! error.

use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use futures::future::BoxFuture;
use futures::{SinkExt, StreamExt};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tokio::time::{sleep, sleep_until, timeout, Instant};
use tokio_tungstenite::connect_async_with_config;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::error::Error as WsError;
use tokio_tungstenite::tungstenite::http::header::AUTHORIZATION;
use tokio_tungstenite::tungstenite::http::{HeaderValue, StatusCode};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

use crate::address::ConfirmedAddress;
use crate::backoff::Backoff;
use crate::bridge::{self, close_code, BridgeContext, EndpointResolver, FromRelayData, Outgoing};
use crate::budget::ByteBudget;
use crate::frame::{self, FromRelay, ToRelay, HEADER_LEN, MAX_PAYLOAD};

/// The relay closes a companion socket with this code when this same
/// companion connected again. It is not terminal: the client reconnects.
pub const CLOSE_REPLACED: u16 = 4000;
/// The relay closes a companion socket with this code when another companion
/// for the instance took over. The only terminal close: the client stops and
/// waits to be started again.
pub const CLOSE_DISPLACED: u16 = 4001;
/// The relay closes a companion socket with this code when its credential
/// expired without a refresh, or a refresh was refused.
pub const CLOSE_CREDENTIAL: u16 = 4401;

pub struct RelayGrant {
    pub relay_url: String,
    pub credential: String,
    pub expires_at: SystemTime,
}

/// Never prints the credential.
impl fmt::Debug for RelayGrant {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RelayGrant")
            .field("relay_url", &self.relay_url)
            .field("credential", &"<redacted>")
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

/// Mints relay credentials through Convex. `Ok(None)` means woofx3 will not
/// issue one (unpaired, revoked, nothing enabled, relay not configured).
pub trait CredentialSource: Send + Sync + 'static {
    fn mint(&self) -> BoxFuture<'_, anyhow::Result<Option<RelayGrant>>>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Stopped {
    Cancelled,
    /// woofx3 would not issue a credential.
    Unauthorized,
    /// Another companion connection for this instance took over. Reconnecting
    /// would only take it back, so the client waits to be started again.
    Displaced,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelayStatus {
    Connecting,
    Connected,
    Retrying { after: Duration, error: String },
    Stopped(Stopped),
}

#[derive(Debug, Clone)]
pub struct RelayOptions {
    pub backoff: Backoff,
    /// How often to send `{"t":"ping"}`, which the relay answers.
    pub ping_interval: Duration,
    /// The connection is dropped when nothing arrives for this long.
    pub idle_timeout: Duration,
    pub connect_timeout: Duration,
    pub mint_timeout: Duration,
    /// The longest a single write to the relay or a local endpoint may take.
    pub write_timeout: Duration,
    /// The relay holds the engine's upgrade for 5 s waiting for `opened`, so
    /// a local dial must finish well within that.
    pub dial_timeout: Duration,
    /// How long a connection must last for the backoff to start over.
    pub stable_after: Duration,
    /// When a refresh fails, try again after this long.
    pub refresh_retry: Duration,
    /// The bytes one direction of one stream may have queued at once. A
    /// stream that would exceed it is closed with 1009.
    pub stream_buffer_bytes: usize,
}

impl Default for RelayOptions {
    fn default() -> Self {
        RelayOptions {
            backoff: Backoff::default(),
            ping_interval: Duration::from_secs(30),
            idle_timeout: Duration::from_secs(75),
            connect_timeout: Duration::from_secs(15),
            mint_timeout: Duration::from_secs(15),
            write_timeout: Duration::from_secs(10),
            dial_timeout: Duration::from_secs(4),
            stable_after: Duration::from_secs(30),
            refresh_retry: Duration::from_secs(5),
            stream_buffer_bytes: 4 * 1024 * 1024,
        }
    }
}

/// Bounded so a stalled relay connection pushes back on the bridges, which
/// then stop reading from their local endpoints.
const WRITER_CAPACITY: usize = 256;
const BRIDGE_CAPACITY: usize = 256;
/// How long a closing session waits for its bridges and its writer.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);
const MIN_REFRESH_DELAY: Duration = Duration::from_secs(1);

pub async fn run_relay(
    credentials: Arc<dyn CredentialSource>,
    endpoints: Arc<dyn EndpointResolver>,
    status: watch::Sender<RelayStatus>,
    cancel: CancellationToken,
) {
    run_relay_with(
        credentials,
        endpoints,
        status,
        cancel,
        RelayOptions::default(),
    )
    .await;
}

pub async fn run_relay_with(
    credentials: Arc<dyn CredentialSource>,
    endpoints: Arc<dyn EndpointResolver>,
    status: watch::Sender<RelayStatus>,
    cancel: CancellationToken,
    options: RelayOptions,
) {
    let mut attempt: u32 = 0;
    loop {
        status.send_replace(RelayStatus::Connecting);
        let end = mint_and_connect(&credentials, &endpoints, &status, &cancel, &options).await;
        let (error, stable) = match end {
            SessionEnd::Stopped(stopped) => {
                status.send_replace(RelayStatus::Stopped(stopped));
                return;
            }
            SessionEnd::Failed { error, lasted } => (error, lasted >= options.stable_after),
        };
        if stable {
            attempt = 0;
        }
        let after = options.backoff.delay(attempt);
        attempt = attempt.saturating_add(1);
        status.send_replace(RelayStatus::Retrying { after, error });
        tokio::select! {
            _ = cancel.cancelled() => {
                status.send_replace(RelayStatus::Stopped(Stopped::Cancelled));
                return;
            }
            _ = sleep(after) => {}
        }
    }
}

enum SessionEnd {
    Stopped(Stopped),
    Failed { error: String, lasted: Duration },
}

impl SessionEnd {
    fn failed_before_connecting(error: impl Into<String>) -> Self {
        SessionEnd::Failed {
            error: error.into(),
            lasted: Duration::ZERO,
        }
    }
}

/// Cancellation is checked around each step rather than by dropping this
/// future, so that once connected, [`serve`] can close the bridges first.
async fn mint_and_connect(
    credentials: &Arc<dyn CredentialSource>,
    endpoints: &Arc<dyn EndpointResolver>,
    status: &watch::Sender<RelayStatus>,
    cancel: &CancellationToken,
    options: &RelayOptions,
) -> SessionEnd {
    let Some(minted) =
        or_cancelled(cancel, timeout(options.mint_timeout, credentials.mint())).await
    else {
        return SessionEnd::Stopped(Stopped::Cancelled);
    };
    let grant = match minted {
        Ok(Ok(Some(grant))) => grant,
        Ok(Ok(None)) => return SessionEnd::Stopped(Stopped::Unauthorized),
        Ok(Err(error)) => {
            return SessionEnd::failed_before_connecting(format!(
                "could not get a relay credential: {error}"
            ))
        }
        Err(_) => {
            return SessionEnd::failed_before_connecting("getting a relay credential timed out")
        }
    };
    if !(grant.relay_url.starts_with("wss://") || grant.relay_url.starts_with("ws://")) {
        return SessionEnd::failed_before_connecting("the relay URL is not a WebSocket URL");
    }

    let mut request = match grant.relay_url.as_str().into_client_request() {
        Ok(request) => request,
        Err(_) => return SessionEnd::failed_before_connecting("the relay URL is not valid"),
    };
    let Ok(mut bearer) = HeaderValue::from_str(&format!("Bearer {}", grant.credential)) else {
        return SessionEnd::failed_before_connecting(
            "the relay credential is not a valid header value",
        );
    };
    bearer.set_sensitive(true);
    request.headers_mut().insert(AUTHORIZATION, bearer);

    let config = WebSocketConfig::default()
        .max_message_size(Some(HEADER_LEN + MAX_PAYLOAD))
        .max_frame_size(Some(HEADER_LEN + MAX_PAYLOAD));
    let connecting = timeout(
        options.connect_timeout,
        connect_async_with_config(request, Some(config), true),
    );
    let Some(connected) = or_cancelled(cancel, connecting).await else {
        return SessionEnd::Stopped(Stopped::Cancelled);
    };
    let socket = match connected {
        Ok(Ok((socket, _response))) => socket,
        Ok(Err(WsError::Http(response))) if response.status() == StatusCode::CONFLICT => {
            if conflict_is_displaced(response.body().as_deref()) {
                return SessionEnd::Stopped(Stopped::Displaced);
            }
            // `stale_credential`: the next attempt mints a fresh one.
            return SessionEnd::failed_before_connecting("the relay asked for a fresh credential");
        }
        Ok(Err(WsError::Http(response))) => {
            return SessionEnd::failed_before_connecting(format!(
                "the relay refused the connection ({})",
                response.status()
            ));
        }
        Ok(Err(error)) => {
            return SessionEnd::failed_before_connecting(format!(
                "could not reach the relay: {error}"
            ))
        }
        Err(_) => return SessionEnd::failed_before_connecting("connecting to the relay timed out"),
    };

    status.send_replace(RelayStatus::Connected);
    serve(
        socket,
        grant.expires_at,
        credentials,
        endpoints,
        cancel,
        options,
    )
    .await
}

async fn or_cancelled<F: std::future::Future>(
    cancel: &CancellationToken,
    future: F,
) -> Option<F::Output> {
    tokio::select! {
        _ = cancel.cancelled() => None,
        output = future => Some(output),
    }
}

/// What a 409 at the upgrade means; the relay says which in its JSON body,
/// `{"error":"displaced"}` or `{"error":"stale_credential"}`. Only an explicit
/// `displaced` is terminal.
fn conflict_is_displaced(body: Option<&[u8]>) -> bool {
    #[derive(serde::Deserialize)]
    struct Conflict {
        error: String,
    }
    body.and_then(|body| serde_json::from_slice::<Conflict>(body).ok())
        .is_some_and(|conflict| conflict.error == "displaced")
}

/// One open stream, and what it was opened for, so it can be closed when its
/// endpoint stops resolving to the same address.
struct Stream {
    module_id: String,
    endpoint_id: String,
    address: ConfirmedAddress,
    sender: mpsc::Sender<FromRelayData>,
    /// What the relay may have queued for the local endpoint at once.
    inbound: ByteBudget,
    task: JoinHandle<()>,
}

/// The streams open on one relay connection.
struct Bridges {
    streams: HashMap<u32, Stream>,
}

impl Bridges {
    /// Closes every stream and waits briefly for each to close its local
    /// socket, so local endpoints see the close before any reconnect.
    async fn close_all(&mut self) {
        let tasks: Vec<JoinHandle<()>> = self
            .streams
            .drain()
            .map(|(_, stream)| stream.task)
            .collect();
        for mut task in tasks {
            if timeout(SHUTDOWN_GRACE, &mut task).await.is_err() {
                task.abort();
            }
        }
    }
}

impl Drop for Bridges {
    fn drop(&mut self) {
        for (_, stream) in self.streams.drain() {
            stream.task.abort();
        }
    }
}

async fn serve<S>(
    socket: tokio_tungstenite::WebSocketStream<S>,
    expires_at: SystemTime,
    credentials: &Arc<dyn CredentialSource>,
    endpoints: &Arc<dyn EndpointResolver>,
    cancel: &CancellationToken,
    options: &RelayOptions,
) -> SessionEnd
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let connected_at = Instant::now();
    let (mut sink, mut read) = socket.split();
    let (to_relay, mut writer_rx) = mpsc::channel::<Outgoing>(WRITER_CAPACITY);
    let write_timeout = options.write_timeout;
    let mut writer_done = false;
    let mut writer = tokio::spawn(async move {
        while let Some(Outgoing { message, charge }) = writer_rx.recv().await {
            let written = timeout(write_timeout, sink.send(message)).await;
            drop(charge);
            match written {
                Ok(Ok(())) => {}
                _ => return,
            }
        }
        let _ = timeout(write_timeout, sink.close()).await;
    });

    let (ended_tx, mut ended_rx) = mpsc::unbounded_channel::<u32>();
    let mut bridges = Bridges {
        streams: HashMap::new(),
    };
    let mut ping = tokio::time::interval_at(
        Instant::now() + options.ping_interval,
        options.ping_interval,
    );
    let mut last_read = Instant::now();
    let mut refresh_at = Instant::now() + refresh_delay(expires_at);
    let mut refresh: Option<
        JoinHandle<Result<anyhow::Result<Option<RelayGrant>>, tokio::time::error::Elapsed>>,
    > = None;
    let mut resolver_changes = endpoints.changes();
    let mut watching_resolver = true;

    let end: Result<Stopped, String> = loop {
        tokio::select! {
            _ = cancel.cancelled() => break Ok(Stopped::Cancelled),
            _ = &mut writer => {
                writer_done = true;
                break Err("lost the connection to the relay".into());
            }
            _ = sleep_until(last_read + options.idle_timeout) => {
                break Err("the relay stopped answering".into());
            }
            _ = ping.tick() => {
                if bridge::send_control(&to_relay, ToRelay::Ping).await.is_err() {
                    break Err("lost the connection to the relay".into());
                }
            }
            _ = sleep_until(refresh_at), if refresh.is_none() => {
                let credentials = Arc::clone(credentials);
                let mint_timeout = options.mint_timeout;
                refresh = Some(tokio::spawn(async move { timeout(mint_timeout, credentials.mint()).await }));
            }
            minted = async { refresh.as_mut().expect("guarded by the precondition").await }, if refresh.is_some() => {
                refresh = None;
                match minted {
                    Ok(Ok(Ok(Some(grant)))) => {
                        refresh_at = Instant::now() + refresh_delay(grant.expires_at);
                        let control = ToRelay::Refresh { credential: grant.credential };
                        if bridge::send_control(&to_relay, control).await.is_err() {
                            break Err("lost the connection to the relay".into());
                        }
                    }
                    Ok(Ok(Ok(None))) => break Ok(Stopped::Unauthorized),
                    // The relay closes the connection with 4401 if the
                    // credential runs out; until then, keep trying.
                    _ => refresh_at = Instant::now() + options.refresh_retry,
                }
            }
            Some(sid) = ended_rx.recv() => {
                bridges.streams.remove(&sid);
            }
            changed = resolver_changes.changed(), if watching_resolver => {
                if changed.is_err() {
                    watching_resolver = false;
                    continue;
                }
                close_unresolved(endpoints, &mut bridges, &to_relay).await;
            }
            message = read.next() => {
                last_read = Instant::now();
                match message {
                    Some(Ok(Message::Text(text))) => match FromRelay::parse(text.as_str()) {
                        Some(FromRelay::Open { sid, module, endpoint, protocols }) => {
                            open_stream(sid, &module, &endpoint, protocols, endpoints, &mut bridges, &to_relay, &ended_tx, options).await;
                        }
                        Some(FromRelay::Close { sid, .. }) => {
                            // Dropping the sender closes the bridge's local socket.
                            bridges.streams.remove(&sid);
                        }
                        // Pongs only prove the connection is alive. Unknown
                        // control messages come from a newer relay and are
                        // ignored rather than treated as fatal.
                        Some(FromRelay::Pong) | None => {}
                    },
                    Some(Ok(Message::Binary(bytes))) => {
                        let Some(frame) = frame::decode(&bytes) else {
                            break Err("the relay sent a frame this companion cannot read".into());
                        };
                        deliver(frame, &mut bridges, &to_relay).await;
                    }
                    Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => {}
                    Some(Ok(Message::Close(frame))) => {
                        let code = frame.as_ref().map(|frame| u16::from(frame.code));
                        match code {
                            Some(CLOSE_DISPLACED) => break Ok(Stopped::Displaced),
                            Some(CLOSE_REPLACED) => break Err("this companion connected to the relay again".into()),
                            Some(CLOSE_CREDENTIAL) => break Err("the relay did not accept the credential".into()),
                            Some(code) => break Err(format!("the relay closed the connection ({code})")),
                            None => break Err("the relay closed the connection".into()),
                        }
                    }
                    Some(Err(error)) => break Err(format!("lost the connection to the relay: {error}")),
                    None => break Err("lost the connection to the relay".into()),
                }
            }
        }
    };

    bridges.close_all().await;
    if let Some(task) = refresh {
        task.abort();
    }
    drop(to_relay);
    drop(ended_tx);
    if !writer_done && timeout(SHUTDOWN_GRACE, &mut writer).await.is_err() {
        writer.abort();
    }

    match end {
        Ok(stopped) => SessionEnd::Stopped(stopped),
        Err(error) => SessionEnd::Failed {
            error,
            lasted: connected_at.elapsed(),
        },
    }
}

#[allow(clippy::too_many_arguments)]
async fn open_stream(
    sid: u32,
    module: &str,
    endpoint: &str,
    protocols: Vec<String>,
    endpoints: &Arc<dyn EndpointResolver>,
    bridges: &mut Bridges,
    to_relay: &mpsc::Sender<Outgoing>,
    ended: &mpsc::UnboundedSender<u32>,
    options: &RelayOptions,
) {
    if sid == 0 || bridges.streams.contains_key(&sid) {
        return;
    }
    let Some(address) = endpoints.resolve(module, endpoint) else {
        bridge::send_close(
            to_relay,
            sid,
            close_code::FORBIDDEN,
            "endpoint is not enabled on this companion",
        )
        .await;
        return;
    };
    let (sender, receiver) = mpsc::channel(BRIDGE_CAPACITY);
    let task = tokio::spawn(bridge::run_bridge(BridgeContext {
        sid,
        address: address.clone(),
        protocols,
        from_relay: receiver,
        to_relay: to_relay.clone(),
        outbound: ByteBudget::new(options.stream_buffer_bytes),
        ended: ended.clone(),
        dial_timeout: options.dial_timeout,
        write_timeout: options.write_timeout,
    }));
    bridges.streams.insert(
        sid,
        Stream {
            module_id: module.to_string(),
            endpoint_id: endpoint.to_string(),
            address,
            sender,
            inbound: ByteBudget::new(options.stream_buffer_bytes),
            task,
        },
    );
}

/// Closes, with 4403, every stream whose endpoint no longer resolves to the
/// address it dialled: turned off, given another address, or its module
/// uninstalled. The bridge task is aborted rather than asked to close, so
/// nothing more from it reaches the relay after the close.
async fn close_unresolved(
    endpoints: &Arc<dyn EndpointResolver>,
    bridges: &mut Bridges,
    to_relay: &mpsc::Sender<Outgoing>,
) {
    let stale: Vec<u32> = bridges
        .streams
        .iter()
        .filter(|(_, stream)| {
            endpoints
                .resolve(&stream.module_id, &stream.endpoint_id)
                .as_ref()
                != Some(&stream.address)
        })
        .map(|(sid, _)| *sid)
        .collect();
    for sid in stale {
        if let Some(stream) = bridges.streams.remove(&sid) {
            stream.task.abort();
        }
        bridge::send_close(
            to_relay,
            sid,
            close_code::FORBIDDEN,
            "endpoint is no longer enabled on this companion",
        )
        .await;
    }
}

async fn deliver(frame: frame::Frame, bridges: &mut Bridges, to_relay: &mpsc::Sender<Outgoing>) {
    let sid = frame.stream_id;
    let Some(stream) = bridges.streams.get(&sid) else {
        // The stream closed while this frame was in flight.
        return;
    };
    let Some(charge) = stream.inbound.charge(frame.payload.len()) else {
        bridges.streams.remove(&sid);
        bridge::send_close(
            to_relay,
            sid,
            close_code::MESSAGE_TOO_BIG,
            "local endpoint is not taking messages fast enough",
        )
        .await;
        return;
    };
    let data = FromRelayData {
        kind: frame.kind,
        payload: frame.payload,
        charge,
    };
    if stream.sender.try_send(data).is_err() {
        // The local endpoint is not keeping up (or the bridge just ended).
        // Waiting here would stall every other stream, so this one closes.
        bridges.streams.remove(&sid);
        bridge::send_close(
            to_relay,
            sid,
            close_code::INTERNAL_ERROR,
            "local endpoint is not keeping up",
        )
        .await;
    }
}

/// Renew at two thirds of the remaining lifetime.
fn refresh_delay(expires_at: SystemTime) -> Duration {
    let remaining = expires_at
        .duration_since(SystemTime::now())
        .unwrap_or(Duration::ZERO);
    (remaining * 2 / 3).max(MIN_REFRESH_DELAY)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refreshes_at_two_thirds_of_the_remaining_lifetime() {
        let delay = refresh_delay(SystemTime::now() + Duration::from_secs(300));
        assert!(
            delay > Duration::from_secs(199) && delay <= Duration::from_secs(200),
            "{delay:?}"
        );
    }

    #[test]
    fn an_expired_credential_refreshes_after_the_minimum_delay() {
        assert_eq!(
            refresh_delay(SystemTime::now() - Duration::from_secs(5)),
            MIN_REFRESH_DELAY
        );
    }

    #[test]
    fn only_an_explicit_displaced_conflict_is_terminal() {
        assert!(conflict_is_displaced(Some(br#"{"error":"displaced"}"#)));
        assert!(!conflict_is_displaced(Some(
            br#"{"error":"stale_credential"}"#
        )));
        assert!(!conflict_is_displaced(Some(b"not json")));
        assert!(!conflict_is_displaced(None));
    }

    #[test]
    fn grant_debug_output_redacts_the_credential() {
        let grant = RelayGrant {
            relay_url: "wss://relay.woofx3.tv/v1/companion".into(),
            credential: "wfxr1.k1.secret.sig".into(),
            expires_at: SystemTime::UNIX_EPOCH,
        };
        let printed = format!("{grant:?}");
        assert!(!printed.contains("secret"), "{printed}");
    }
}
