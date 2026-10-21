//! Local registration: once the local engine is ready, the host becomes its
//! client with the registration token the engine wrote to
//! `WOOFX3_REGISTRATION_TOKEN_FILE`, and keeps the client id and secret in
//! the OS credential store. Stored credentials are checked against the
//! engine first, so an engine whose data was wiped is registered with again
//! rather than handed credentials it no longer knows.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use futures::future::BoxFuture;
use tokio::sync::watch;
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;

use super::gateway::{ClientCredentials, EngineGateway};
use super::sidecar::{random_jitter, EnginePhase, EngineStatus};
use super::HostError;
use crate::backoff::Backoff;

/// The description the engine records for the host's client.
pub const CLIENT_DESCRIPTION: &str = "woofx3-desktop";

/// Where the host keeps its engine client credentials.
pub trait CredentialStore: Send + Sync {
    fn load(&self) -> BoxFuture<'_, anyhow::Result<Option<ClientCredentials>>>;
    fn store(&self, credentials: ClientCredentials) -> BoxFuture<'_, anyhow::Result<()>>;
}

/// Where the host's engine session stands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalSession {
    /// The engine is not ready, or registration is under way.
    Starting,
    Ready(ClientCredentials),
    /// The last attempt failed; another follows while the engine is ready.
    Failed {
        reason: String,
    },
}

#[derive(Debug, Clone)]
pub struct RegistrationOptions {
    /// The delay before each retry of a failed registration.
    pub backoff: Backoff,
    /// The jitter for each retry delay, in `[0, 1]`.
    pub jitter: fn() -> f64,
}

impl Default for RegistrationOptions {
    fn default() -> Self {
        RegistrationOptions {
            backoff: Backoff {
                initial: Duration::from_secs(1),
                max: Duration::from_secs(30),
            },
            jitter: random_jitter,
        }
    }
}

/// The credentials to open a session with: the stored ones when the engine
/// still accepts them, else new ones from registering, which are stored
/// before they are returned.
pub async fn ensure_registered(
    gateway: &dyn EngineGateway,
    store: &dyn CredentialStore,
    token_file: &Path,
) -> Result<ClientCredentials, HostError> {
    if let Some(stored) = store.load().await.map_err(HostError::CredentialStoreRead)? {
        match gateway.verify(&stored).await {
            Ok(()) => return Ok(stored),
            // The engine no longer knows them.
            Err(HostError::EngineRefused { .. }) => {}
            Err(err) => return Err(err),
        }
    }
    let token = read_registration_token(token_file).await?;
    let credentials = gateway.register_client(CLIENT_DESCRIPTION, &token).await?;
    store
        .store(credentials.clone())
        .await
        .map_err(HostError::CredentialStoreWrite)?;
    Ok(credentials)
}

async fn read_registration_token(path: &Path) -> Result<String, HostError> {
    let raw = tokio::fs::read_to_string(path).await.map_err(|source| {
        HostError::RegistrationTokenUnreadable {
            path: path.to_path_buf(),
            source,
        }
    })?;
    let token = raw.trim();
    if token.is_empty() {
        return Err(HostError::RegistrationTokenEmpty(path.to_path_buf()));
    }
    Ok(token.to_string())
}

/// Registers each time the engine becomes ready, until cancelled or until
/// the engine's supervisor ends. A failed attempt is retried with backoff
/// for as long as the engine stays ready.
pub async fn run_registration(
    mut engine: watch::Receiver<EngineStatus>,
    gateway: Arc<dyn EngineGateway>,
    store: Arc<dyn CredentialStore>,
    token_file: PathBuf,
    options: RegistrationOptions,
    session: watch::Sender<LocalSession>,
    cancel: CancellationToken,
) {
    loop {
        session.send_replace(LocalSession::Starting);
        let ready = tokio::select! {
            _ = cancel.cancelled() => return,
            ready = engine.wait_for(|status| status.phase == EnginePhase::Ready) => ready.is_ok(),
        };
        if !ready {
            return;
        }
        let mut attempt: u32 = 0;
        loop {
            let registered = tokio::select! {
                _ = cancel.cancelled() => return,
                registered = ensure_registered(gateway.as_ref(), store.as_ref(), &token_file) => registered,
            };
            match registered {
                Ok(credentials) => {
                    session.send_replace(LocalSession::Ready(credentials));
                    break;
                }
                Err(err) => {
                    session.send_replace(LocalSession::Failed {
                        reason: err.to_string(),
                    });
                }
            }
            let after = options
                .backoff
                .delay_with_jitter(attempt, (options.jitter)());
            attempt = attempt.saturating_add(1);
            let still_ready = tokio::select! {
                _ = cancel.cancelled() => return,
                _ = sleep(after) => true,
                left = engine.wait_for(|status| status.phase != EnginePhase::Ready) => {
                    if left.is_err() {
                        return;
                    }
                    false
                }
            };
            if !still_ready {
                break;
            }
        }
        let left = tokio::select! {
            _ = cancel.cancelled() => return,
            left = engine.wait_for(|status| status.phase != EnginePhase::Ready) => left.is_ok(),
        };
        if !left {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use super::*;

    fn credentials(id: &str) -> ClientCredentials {
        ClientCredentials {
            client_id: id.to_string(),
            client_secret: format!("{id}-secret"),
        }
    }

    fn refused() -> HostError {
        HostError::EngineRefused {
            name: "Error".to_string(),
            message: "Invalid client credentials".to_string(),
        }
    }

    /// Answers each call with the next queued reply, and records the calls.
    #[derive(Default)]
    struct ScriptedGateway {
        registrations: Mutex<VecDeque<Result<ClientCredentials, HostError>>>,
        verifications: Mutex<VecDeque<Result<(), HostError>>>,
        calls: Mutex<Vec<String>>,
    }

    impl ScriptedGateway {
        fn calls(&self) -> Vec<String> {
            self.calls.lock().expect("calls lock").clone()
        }
    }

    impl EngineGateway for ScriptedGateway {
        fn register_client<'a>(
            &'a self,
            description: &'a str,
            registration_token: &'a str,
        ) -> BoxFuture<'a, Result<ClientCredentials, HostError>> {
            self.calls
                .lock()
                .expect("calls lock")
                .push(format!("register {description} {registration_token}"));
            let reply = self
                .registrations
                .lock()
                .expect("registrations lock")
                .pop_front()
                .expect("a scripted registration");
            Box::pin(async move { reply })
        }

        fn verify<'a>(
            &'a self,
            credentials: &'a ClientCredentials,
        ) -> BoxFuture<'a, Result<(), HostError>> {
            self.calls
                .lock()
                .expect("calls lock")
                .push(format!("verify {}", credentials.client_id));
            let reply = self
                .verifications
                .lock()
                .expect("verifications lock")
                .pop_front()
                .expect("a scripted verification");
            Box::pin(async move { reply })
        }
    }

    #[derive(Default)]
    struct MemoryStore {
        stored: Mutex<Option<ClientCredentials>>,
        fail_writes: bool,
    }

    impl CredentialStore for MemoryStore {
        fn load(&self) -> BoxFuture<'_, anyhow::Result<Option<ClientCredentials>>> {
            let stored = self.stored.lock().expect("store lock").clone();
            Box::pin(async move { Ok(stored) })
        }

        fn store(&self, credentials: ClientCredentials) -> BoxFuture<'_, anyhow::Result<()>> {
            let result = if self.fail_writes {
                Err(anyhow::anyhow!("the keychain is locked"))
            } else {
                *self.stored.lock().expect("store lock") = Some(credentials);
                Ok(())
            };
            Box::pin(async move { result })
        }
    }

    struct TokenFile(PathBuf);

    impl TokenFile {
        fn new(name: &str, contents: Option<&str>) -> Self {
            let path = std::env::temp_dir()
                .join(format!("woofx3-registration-{name}-{}", std::process::id()));
            match contents {
                Some(contents) => std::fs::write(&path, contents).expect("write the token"),
                None => {
                    let _ = std::fs::remove_file(&path);
                }
            }
            TokenFile(path)
        }
    }

    impl Drop for TokenFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    #[tokio::test]
    async fn test_ensure_registered_registers_and_stores_on_first_run() {
        let token = TokenFile::new("first", Some("tok\n"));
        let gateway = ScriptedGateway::default();
        gateway
            .registrations
            .lock()
            .expect("lock")
            .push_back(Ok(credentials("c1")));
        let store = MemoryStore::default();

        let registered = ensure_registered(&gateway, &store, &token.0)
            .await
            .expect("registers");
        assert_eq!(registered, credentials("c1"));
        assert_eq!(gateway.calls(), vec!["register woofx3-desktop tok"]);
        assert_eq!(*store.stored.lock().expect("lock"), Some(credentials("c1")));
    }

    #[tokio::test]
    async fn test_ensure_registered_reuses_credentials_the_engine_accepts() {
        let token = TokenFile::new("reuse", None);
        let gateway = ScriptedGateway::default();
        gateway
            .verifications
            .lock()
            .expect("lock")
            .push_back(Ok(()));
        let store = MemoryStore {
            stored: Mutex::new(Some(credentials("c1"))),
            fail_writes: false,
        };

        let registered = ensure_registered(&gateway, &store, &token.0)
            .await
            .expect("reuses");
        assert_eq!(registered, credentials("c1"));
        assert_eq!(gateway.calls(), vec!["verify c1"]);
    }

    #[tokio::test]
    async fn test_ensure_registered_registers_again_when_the_engine_forgot_the_client() {
        let token = TokenFile::new("forgot", Some("tok"));
        let gateway = ScriptedGateway::default();
        gateway
            .verifications
            .lock()
            .expect("lock")
            .push_back(Err(refused()));
        gateway
            .registrations
            .lock()
            .expect("lock")
            .push_back(Ok(credentials("c2")));
        let store = MemoryStore {
            stored: Mutex::new(Some(credentials("c1"))),
            fail_writes: false,
        };

        let registered = ensure_registered(&gateway, &store, &token.0)
            .await
            .expect("registers again");
        assert_eq!(registered, credentials("c2"));
        assert_eq!(
            gateway.calls(),
            vec!["verify c1", "register woofx3-desktop tok"]
        );
        assert_eq!(*store.stored.lock().expect("lock"), Some(credentials("c2")));
    }

    #[tokio::test]
    async fn test_ensure_registered_fails_without_registering_when_the_engine_is_unreachable() {
        let token = TokenFile::new("unreachable", Some("tok"));
        let gateway = ScriptedGateway::default();
        gateway
            .verifications
            .lock()
            .expect("lock")
            .push_back(Err(HostError::EngineHttpStatus(503)));
        let store = MemoryStore {
            stored: Mutex::new(Some(credentials("c1"))),
            fail_writes: false,
        };

        let err = ensure_registered(&gateway, &store, &token.0)
            .await
            .expect_err("fails");
        assert!(matches!(err, HostError::EngineHttpStatus(503)));
        assert_eq!(gateway.calls(), vec!["verify c1"]);
        assert_eq!(*store.stored.lock().expect("lock"), Some(credentials("c1")));
    }

    #[tokio::test]
    async fn test_ensure_registered_reports_a_missing_or_empty_token() {
        let gateway = ScriptedGateway::default();
        let store = MemoryStore::default();
        let missing = TokenFile::new("missing", None);
        assert!(matches!(
            ensure_registered(&gateway, &store, &missing.0).await,
            Err(HostError::RegistrationTokenUnreadable { .. })
        ));
        let empty = TokenFile::new("empty", Some(" \n"));
        assert!(matches!(
            ensure_registered(&gateway, &store, &empty.0).await,
            Err(HostError::RegistrationTokenEmpty(_))
        ));
        assert!(gateway.calls().is_empty());
    }

    #[tokio::test]
    async fn test_ensure_registered_reports_a_refused_registration_and_a_failed_store() {
        let token = TokenFile::new("refused", Some("tok"));
        let gateway = ScriptedGateway::default();
        gateway
            .registrations
            .lock()
            .expect("lock")
            .push_back(Err(HostError::EngineRefused {
                name: "RegistrationRefused".to_string(),
                message: "wrong token".to_string(),
            }));
        let store = MemoryStore::default();
        assert!(matches!(
            ensure_registered(&gateway, &store, &token.0).await,
            Err(HostError::EngineRefused { name, .. }) if name == "RegistrationRefused"
        ));

        gateway
            .registrations
            .lock()
            .expect("lock")
            .push_back(Ok(credentials("c1")));
        let failing = MemoryStore {
            stored: Mutex::new(None),
            fail_writes: true,
        };
        assert!(matches!(
            ensure_registered(&gateway, &failing, &token.0).await,
            Err(HostError::CredentialStoreWrite(_))
        ));
    }

    fn no_jitter() -> f64 {
        0.0
    }

    fn status(phase: EnginePhase) -> EngineStatus {
        EngineStatus {
            phase,
            services: Default::default(),
        }
    }

    #[tokio::test]
    async fn test_run_registration_follows_the_engine() {
        let token = TokenFile::new("run", Some("tok"));
        let gateway = Arc::new(ScriptedGateway::default());
        {
            let mut registrations = gateway.registrations.lock().expect("lock");
            registrations.push_back(Err(HostError::EngineHttpStatus(503)));
            registrations.push_back(Ok(credentials("c1")));
        }
        gateway
            .verifications
            .lock()
            .expect("lock")
            .push_back(Ok(()));
        let store = Arc::new(MemoryStore::default());
        let (engine_tx, engine) = watch::channel(EngineStatus::starting());
        let (session_tx, mut session) = watch::channel(LocalSession::Starting);
        let cancel = CancellationToken::new();
        let options = RegistrationOptions {
            backoff: Backoff {
                initial: Duration::from_millis(20),
                max: Duration::from_millis(20),
            },
            jitter: no_jitter,
        };
        let task = tokio::spawn(run_registration(
            engine,
            gateway.clone(),
            store.clone(),
            token.0.clone(),
            options,
            session_tx,
            cancel.clone(),
        ));
        let within = Duration::from_secs(5);

        assert_eq!(*session.borrow(), LocalSession::Starting);
        engine_tx.send_replace(status(EnginePhase::Ready));
        tokio::time::timeout(
            within,
            session.wait_for(|session| *session == LocalSession::Ready(credentials("c1"))),
        )
        .await
        .expect("ready in time")
        .expect("session open");

        engine_tx.send_replace(status(EnginePhase::Restarting {
            attempt: 1,
            after: Duration::from_secs(1),
            reason: "crashed".to_string(),
        }));
        tokio::time::timeout(
            within,
            session.wait_for(|session| *session == LocalSession::Starting),
        )
        .await
        .expect("starting in time")
        .expect("session open");

        engine_tx.send_replace(status(EnginePhase::Ready));
        tokio::time::timeout(
            within,
            session.wait_for(|session| matches!(session, LocalSession::Ready(_))),
        )
        .await
        .expect("ready again in time")
        .expect("session open");
        assert_eq!(
            gateway.calls(),
            vec![
                "register woofx3-desktop tok",
                "register woofx3-desktop tok",
                "verify c1"
            ]
        );

        drop(engine_tx);
        tokio::time::timeout(within, task)
            .await
            .expect("ends with the engine")
            .expect("no panic");
    }
}
