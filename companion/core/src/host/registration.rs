//! Local registration: once the local engine is ready, the host becomes its
//! client with the registration token the engine wrote to
//! `WOOFX3_REGISTRATION_TOKEN_FILE`, and keeps the client id and secret in
//! the OS credential store. Stored credentials are checked against the
//! engine first, so an engine whose data was wiped is registered with again
//! rather than handed credentials it no longer knows. Only a refused
//! `authenticate` counts as that; any other failure is retried with the
//! same credentials, so a passing engine fault never orphans a client.
//!
//! Registering is the one step with an effect outside the host: the engine
//! issues a new client every time. So credentials the engine issued are
//! kept until the store takes them, and a failed store is retried on its
//! own rather than by registering again.

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
    /// Bounds each call to the engine's gateway, connecting included.
    pub request_timeout: Duration,
    /// The delay before each retry of a failed registration.
    pub backoff: Backoff,
    /// The jitter for each retry delay, in `[0, 1]`.
    pub jitter: fn() -> f64,
}

impl Default for RegistrationOptions {
    fn default() -> Self {
        RegistrationOptions {
            request_timeout: Duration::from_secs(10),
            backoff: Backoff {
                initial: Duration::from_secs(1),
                max: Duration::from_secs(30),
            },
            jitter: random_jitter,
        }
    }
}

/// Gets the host credentials the engine accepts, remembering across attempts
/// any it issued that the store has not taken yet.
pub struct Registrar {
    gateway: Arc<dyn EngineGateway>,
    store: Arc<dyn CredentialStore>,
    token_file: PathBuf,
    /// Issued by the engine and not stored yet. Set before the store is
    /// tried, so an attempt cut short keeps them too.
    unsaved: Option<ClientCredentials>,
}

impl Registrar {
    pub fn new(
        gateway: Arc<dyn EngineGateway>,
        store: Arc<dyn CredentialStore>,
        token_file: PathBuf,
    ) -> Self {
        Registrar {
            gateway,
            store,
            token_file,
            unsaved: None,
        }
    }

    /// The credentials to open a session with: issued ones the store has not
    /// taken yet, once it takes them; else the stored ones while the engine
    /// accepts them; else new ones from registering, stored before they are
    /// returned.
    pub async fn ensure(&mut self) -> Result<ClientCredentials, HostError> {
        let credentials = match self.unsaved.clone() {
            Some(unsaved) => unsaved,
            None => {
                if let Some(stored) = self
                    .store
                    .load()
                    .await
                    .map_err(HostError::CredentialStoreRead)?
                {
                    match self.gateway.verify(&stored).await {
                        Ok(()) => return Ok(stored),
                        // The engine no longer knows them.
                        Err(HostError::CredentialsRefused { .. }) => {}
                        Err(err) => return Err(err),
                    }
                }
                let token = read_registration_token(&self.token_file).await?;
                let issued = self
                    .gateway
                    .register_client(CLIENT_DESCRIPTION, &token)
                    .await?;
                self.unsaved = Some(issued.clone());
                issued
            }
        };
        self.store
            .store(credentials.clone())
            .await
            .map_err(HostError::CredentialStoreWrite)?;
        self.unsaved = None;
        Ok(credentials)
    }
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
    mut registrar: Registrar,
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
                registered = registrar.ensure() => registered,
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
        HostError::CredentialsRefused {
            message: "AuthenticationRefused: Invalid client credentials".to_string(),
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
        fn registering(replies: Vec<Result<ClientCredentials, HostError>>) -> Self {
            ScriptedGateway {
                registrations: Mutex::new(replies.into()),
                ..Default::default()
            }
        }

        fn verifying(self, replies: Vec<Result<(), HostError>>) -> Self {
            *self.verifications.lock().expect("lock") = replies.into();
            self
        }

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

    /// Fails its next `failing_writes` writes, as a locked keychain does.
    #[derive(Default)]
    struct MemoryStore {
        stored: Mutex<Option<ClientCredentials>>,
        failing_writes: Mutex<u32>,
    }

    impl MemoryStore {
        fn holding(credentials: ClientCredentials) -> Self {
            MemoryStore {
                stored: Mutex::new(Some(credentials)),
                ..Default::default()
            }
        }

        fn failing(writes: u32) -> Self {
            MemoryStore {
                failing_writes: Mutex::new(writes),
                ..Default::default()
            }
        }

        fn stored(&self) -> Option<ClientCredentials> {
            self.stored.lock().expect("store lock").clone()
        }
    }

    impl CredentialStore for MemoryStore {
        fn load(&self) -> BoxFuture<'_, anyhow::Result<Option<ClientCredentials>>> {
            let stored = self.stored();
            Box::pin(async move { Ok(stored) })
        }

        fn store(&self, credentials: ClientCredentials) -> BoxFuture<'_, anyhow::Result<()>> {
            let mut failing = self.failing_writes.lock().expect("store lock");
            let result = if *failing > 0 {
                *failing -= 1;
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

    fn registrar(
        gateway: &Arc<ScriptedGateway>,
        store: &Arc<MemoryStore>,
        token: &TokenFile,
    ) -> Registrar {
        Registrar::new(gateway.clone(), store.clone(), token.0.clone())
    }

    #[tokio::test]
    async fn test_registrar_registers_and_stores_on_first_run() {
        let token = TokenFile::new("first", Some("tok\n"));
        let gateway = Arc::new(ScriptedGateway::registering(vec![Ok(credentials("c1"))]));
        let store = Arc::new(MemoryStore::default());

        let registered = registrar(&gateway, &store, &token)
            .ensure()
            .await
            .expect("registers");
        assert_eq!(registered, credentials("c1"));
        assert_eq!(gateway.calls(), vec!["register woofx3-desktop tok"]);
        assert_eq!(store.stored(), Some(credentials("c1")));
    }

    #[tokio::test]
    async fn test_registrar_reuses_credentials_the_engine_accepts() {
        let token = TokenFile::new("reuse", None);
        let gateway = Arc::new(ScriptedGateway::default().verifying(vec![Ok(())]));
        let store = Arc::new(MemoryStore::holding(credentials("c1")));

        let registered = registrar(&gateway, &store, &token)
            .ensure()
            .await
            .expect("reuses");
        assert_eq!(registered, credentials("c1"));
        assert_eq!(gateway.calls(), vec!["verify c1"]);
    }

    #[tokio::test]
    async fn test_registrar_registers_again_when_authenticate_is_refused() {
        let token = TokenFile::new("forgot", Some("tok"));
        let gateway = Arc::new(
            ScriptedGateway::registering(vec![Ok(credentials("c2"))])
                .verifying(vec![Err(refused())]),
        );
        let store = Arc::new(MemoryStore::holding(credentials("c1")));

        let registered = registrar(&gateway, &store, &token)
            .ensure()
            .await
            .expect("registers again");
        assert_eq!(registered, credentials("c2"));
        assert_eq!(
            gateway.calls(),
            vec!["verify c1", "register woofx3-desktop tok"]
        );
        assert_eq!(store.stored(), Some(credentials("c2")));
    }

    #[tokio::test]
    async fn test_registrar_keeps_credentials_through_any_other_engine_failure() {
        let failures = vec![
            HostError::EngineHttpStatus(503),
            HostError::EngineRefused {
                name: "Error".to_string(),
                message: "db-proxy unavailable".to_string(),
            },
            HostError::EngineSessionAborted {
                name: "Error".to_string(),
                message: "the session broke".to_string(),
            },
        ];
        for failure in failures {
            let token = TokenFile::new("transient", Some("tok"));
            let shown = failure.to_string();
            let gateway = Arc::new(ScriptedGateway::default().verifying(vec![Err(failure)]));
            let store = Arc::new(MemoryStore::holding(credentials("c1")));

            assert!(
                registrar(&gateway, &store, &token).ensure().await.is_err(),
                "{shown}"
            );
            assert_eq!(gateway.calls(), vec!["verify c1"], "{shown}");
            assert_eq!(store.stored(), Some(credentials("c1")), "{shown}");
        }
    }

    #[tokio::test]
    async fn test_registrar_retries_only_the_store_after_a_failed_write() {
        let token = TokenFile::new("unsaved", Some("tok"));
        let gateway = Arc::new(ScriptedGateway::registering(vec![Ok(credentials("c1"))]));
        let store = Arc::new(MemoryStore::failing(3));
        let mut registrar = registrar(&gateway, &store, &token);

        for _ in 0..3 {
            assert!(matches!(
                registrar.ensure().await,
                Err(HostError::CredentialStoreWrite(_))
            ));
        }
        assert_eq!(registrar.ensure().await.expect("stored"), credentials("c1"));
        assert_eq!(gateway.calls(), vec!["register woofx3-desktop tok"]);
        assert_eq!(store.stored(), Some(credentials("c1")));
    }

    #[tokio::test]
    async fn test_registrar_reports_a_missing_or_empty_token() {
        let gateway = Arc::new(ScriptedGateway::default());
        let store = Arc::new(MemoryStore::default());
        let missing = TokenFile::new("missing", None);
        assert!(matches!(
            registrar(&gateway, &store, &missing).ensure().await,
            Err(HostError::RegistrationTokenUnreadable { .. })
        ));
        let empty = TokenFile::new("empty", Some(" \n"));
        assert!(matches!(
            registrar(&gateway, &store, &empty).ensure().await,
            Err(HostError::RegistrationTokenEmpty(_))
        ));
        assert!(gateway.calls().is_empty());
    }

    #[tokio::test]
    async fn test_registrar_reports_a_refused_registration() {
        let token = TokenFile::new("refused", Some("tok"));
        let gateway = Arc::new(ScriptedGateway::registering(vec![Err(
            HostError::EngineRefused {
                name: "RegistrationRefused".to_string(),
                message: "wrong token".to_string(),
            },
        )]));
        let store = Arc::new(MemoryStore::default());
        assert!(matches!(
            registrar(&gateway, &store, &token).ensure().await,
            Err(HostError::EngineRefused { name, .. }) if name == "RegistrationRefused"
        ));
        assert_eq!(store.stored(), None);
    }

    fn no_jitter() -> f64 {
        0.0
    }

    fn status(phase: EnginePhase) -> EngineStatus {
        EngineStatus {
            phase,
            ..EngineStatus::starting()
        }
    }

    #[tokio::test]
    async fn test_run_registration_follows_the_engine() {
        let token = TokenFile::new("run", Some("tok"));
        let gateway = Arc::new(
            ScriptedGateway::registering(vec![
                Err(HostError::EngineHttpStatus(503)),
                Ok(credentials("c1")),
            ])
            .verifying(vec![Ok(())]),
        );
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
            ..RegistrationOptions::default()
        };
        let task = tokio::spawn(run_registration(
            engine,
            registrar(&gateway, &store, &token),
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
