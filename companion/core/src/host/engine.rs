//! How the host starts the engine release it runs: the orchestrator in the
//! release's directory, run from that directory as the release's own start
//! scripts run it (build/scripts/package.sh in the engine repository), and
//! configured as a local engine. The settings follow "Host and Origin
//! checks" and "Client registration" in the engine's
//! docs/services/deployment.md.

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

use super::config::orchestrator_file_name;
use super::sidecar::SidecarSpec;
use super::HostError;

/// The directory sceneManager serves its static assets from, as the
/// release's start scripts set it.
const ROOT_PATH_ENV: &str = "WOOFX3_ROOT_PATH";
const HOSTING_ENV: &str = "WOOFX3_HOSTING";
/// Adds the `engine.localMode` capability and reports `hosting: "local"`.
const HOSTING_LOCAL: &str = "local";
/// Where the engine writes everything: databases, module storage, uploaded
/// modules, caches and logs. Without it the engine writes into its release
/// directory, which may be read-only and is replaced by every update.
const DATA_DIR_ENV: &str = "WOOFX3_DATA_DIR";
const REGISTRATION_TOKEN_FILE_ENV: &str = "WOOFX3_REGISTRATION_TOKEN_FILE";
const API_PORT_ENV: &str = "WOOFX3_API_PORT";
const ALLOWED_HOSTS_ENV: &str = "WOOFX3_ALLOWED_HOSTS";
/// Every service's origin list, the api's included.
const ALLOWED_ORIGINS_ENV: &str = "WOOFX3_ALLOWED_ORIGINS";
/// sceneManager's own origin list, which replaces the shared one for it.
const SCENE_MANAGER_ALLOWED_ORIGINS_ENV: &str = "WOOFX3_SCENE_MANAGER_ALLOWED_ORIGINS";

/// Every name the engine is reached by on loopback. The services' own
/// health checks use 127.0.0.1.
const ALLOWED_HOSTS: &[&str] = &["localhost", "127.0.0.1", "[::1]"];

/// Loopback pages (sceneManager's overlays post from their own origin) and
/// the desktop app's webview, which is `tauri://localhost` on macOS and Linux
/// and `http://tauri.localhost` on Windows.
const ALLOWED_ORIGINS: &[&str] = &[
    "http://localhost:*",
    "http://127.0.0.1:*",
    "tauri://localhost",
    "http://tauri.localhost",
];

/// The origin sandboxed widget frames send on their CORS loads from
/// sceneManager (module scripts, fonts). Only sceneManager's list may hold
/// it: the api refuses to start with it, since a listed `null` admits every
/// sandboxed page.
const OPAQUE_ORIGIN: &str = "null";

/// An allowlist as the engine reads it: comma-separated entries. The engine
/// refuses at startup a list that is set but names nothing, so one is never
/// built empty.
fn allowlist(entries: &[&str]) -> OsString {
    assert!(
        !entries.is_empty() && entries.iter().all(|entry| !entry.trim().is_empty()),
        "an allowlist needs entries, and no blank one: {entries:?}"
    );
    entries.join(",").into()
}

/// The shared origins, then `null`, for sceneManager alone.
fn scene_manager_origins() -> Vec<&'static str> {
    let mut origins = ALLOWED_ORIGINS.to_vec();
    origins.push(OPAQUE_ORIGIN);
    origins
}

/// The api port of an engine release (`apiPort` in the engine's
/// build/config/.woofx3.json), used unless the host configuration names one.
pub const DEFAULT_API_PORT: u16 = 5050;

/// Where a local engine keeps what it writes, and where it is reached.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalEngineLayout {
    /// The engine's database, modules, uploads and logs.
    pub data_dir: PathBuf,
    /// Written by the engine on its first start (mode 0600, in a directory
    /// it creates 0700), and read by the host to register.
    pub registration_token_file: PathBuf,
    pub api_port: u16,
}

impl LocalEngineLayout {
    /// The layout under the app's local data directory, which on Windows is
    /// under `%LOCALAPPDATA%` and so readable only by the user, as the token
    /// file needs.
    pub fn under(app_local_data_dir: &Path, api_port: u16) -> Self {
        LocalEngineLayout {
            data_dir: app_local_data_dir.join("engine"),
            registration_token_file: app_local_data_dir
                .join("engine-secrets")
                .join("registration-token"),
            api_port,
        }
    }

    /// The URL of the engine's capnweb `/api`.
    pub fn api_url(&self) -> String {
        format!("http://127.0.0.1:{}/api", self.api_port)
    }

    fn env(&self) -> Vec<(OsString, OsString)> {
        vec![
            (HOSTING_ENV.into(), HOSTING_LOCAL.into()),
            (DATA_DIR_ENV.into(), self.data_dir.clone().into_os_string()),
            (
                REGISTRATION_TOKEN_FILE_ENV.into(),
                self.registration_token_file.clone().into_os_string(),
            ),
            (API_PORT_ENV.into(), self.api_port.to_string().into()),
            (ALLOWED_HOSTS_ENV.into(), allowlist(ALLOWED_HOSTS)),
            (ALLOWED_ORIGINS_ENV.into(), allowlist(ALLOWED_ORIGINS)),
            (
                SCENE_MANAGER_ALLOWED_ORIGINS_ENV.into(),
                allowlist(&scene_manager_origins()),
            ),
        ]
    }
}

/// The orchestrator in `engine_dir`, configured as a local engine laid out
/// as `layout` says. A release without an orchestrator is an error, so a
/// wrong `engineDir` stops the host at startup rather than turning into
/// endless restarts. So is a data directory that is not absolute (the engine
/// refuses one) or that lies inside the release: the orchestrator would then
/// try to copy the release's own data into it, which it refuses.
pub fn orchestrator_spec(
    engine_dir: &Path,
    layout: &LocalEngineLayout,
) -> Result<SidecarSpec, HostError> {
    let program = engine_dir.join(orchestrator_file_name());
    if !program.is_file() {
        return Err(HostError::OrchestratorMissing(program));
    }
    if !layout.data_dir.is_absolute() {
        return Err(HostError::DataDirNotAbsolute(layout.data_dir.clone()));
    }
    if within(&layout.data_dir, engine_dir) {
        return Err(HostError::DataDirInsideEngine(layout.data_dir.clone()));
    }
    let mut env = vec![(
        OsString::from(ROOT_PATH_ENV),
        engine_dir.as_os_str().to_os_string(),
    )];
    env.extend(layout.env());
    Ok(SidecarSpec {
        program,
        args: Vec::new(),
        current_dir: engine_dir.to_path_buf(),
        env,
    })
}

/// Whether `path` is `dir` or lies under it, however either is spelled: `.`
/// and `..` are resolved, each is resolved through the file system as far
/// as it exists (symbolic links, Windows short names), and on Windows the
/// rest is compared without regard to case, as the file system does.
fn within(path: &Path, dir: &Path) -> bool {
    within_resolved(&resolved(path), &resolved(dir), cfg!(windows))
}

fn within_resolved(path: &Path, dir: &Path, ignore_case: bool) -> bool {
    let mut path = path.components();
    for dir_part in dir.components() {
        let Some(path_part) = path.next() else {
            return false;
        };
        let (a, b) = (path_part.as_os_str(), dir_part.as_os_str());
        let same = if ignore_case {
            a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
        } else {
            a == b
        };
        if !same {
            return false;
        }
    }
    true
}

/// `path` with `.` and `..` resolved by its text, then with its longest
/// existing ancestor resolved by the file system. The data directory need
/// not exist yet, so the part that does not is kept as written.
fn resolved(path: &Path) -> PathBuf {
    let lexical = lexically_normalized(path);
    let mut existing = lexical.as_path();
    let mut missing = Vec::new();
    loop {
        if let Ok(canonical) = existing.canonicalize() {
            let mut out = canonical;
            out.extend(missing.iter().rev());
            return out;
        }
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                missing.push(name.to_os_string());
                existing = parent;
            }
            _ => return lexical,
        }
    }
}

fn lexically_normalized(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("woofx3-engine-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    fn env_value<'a>(spec: &'a SidecarSpec, key: &str) -> Option<&'a OsString> {
        spec.env
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value)
    }

    #[test]
    fn test_local_engine_layout_under_the_app_data_directory() {
        let app = PathBuf::from("/data/tv.woofx3.companion");
        let layout = LocalEngineLayout::under(&app, 20200);
        assert_eq!(layout.data_dir, app.join("engine"));
        assert_eq!(
            layout.registration_token_file,
            app.join("engine-secrets").join("registration-token")
        );
        assert_eq!(layout.api_url(), "http://127.0.0.1:20200/api");
    }

    #[test]
    fn test_orchestrator_spec_runs_the_release_as_a_local_engine() {
        let dir = scratch("release");
        let program = dir.join(orchestrator_file_name());
        std::fs::write(&program, b"").expect("write");
        let layout = LocalEngineLayout::under(
            &std::env::temp_dir().join("woofx3-app-data"),
            DEFAULT_API_PORT,
        );
        let spec = orchestrator_spec(&dir, &layout).expect("found");
        assert_eq!(spec.program, program);
        assert_eq!(spec.current_dir, dir);
        assert!(spec.args.is_empty());

        let token_file = layout.registration_token_file.clone().into_os_string();
        let data_dir = layout.data_dir.clone().into_os_string();
        let expected: Vec<(&str, OsString)> = vec![
            ("WOOFX3_ROOT_PATH", dir.clone().into_os_string()),
            ("WOOFX3_HOSTING", "local".into()),
            ("WOOFX3_DATA_DIR", data_dir),
            ("WOOFX3_REGISTRATION_TOKEN_FILE", token_file),
            ("WOOFX3_API_PORT", "5050".into()),
            ("WOOFX3_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]".into()),
            (
                "WOOFX3_ALLOWED_ORIGINS",
                "http://localhost:*,http://127.0.0.1:*,tauri://localhost,http://tauri.localhost"
                    .into(),
            ),
            (
                "WOOFX3_SCENE_MANAGER_ALLOWED_ORIGINS",
                "http://localhost:*,http://127.0.0.1:*,tauri://localhost,http://tauri.localhost,null"
                    .into(),
            ),
        ];
        for (key, value) in &expected {
            assert_eq!(env_value(&spec, key), Some(value), "{key}");
        }
        assert_eq!(spec.env.len(), expected.len());
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }

    /// The engine refuses at startup an allowlist that is set but names
    /// nothing, and the api one that holds `null`.
    #[test]
    fn test_allowlists_name_entries_and_keep_null_from_the_api() {
        for (name, entries) in [
            ("hosts", ALLOWED_HOSTS.to_vec()),
            ("origins", ALLOWED_ORIGINS.to_vec()),
            ("sceneManager origins", scene_manager_origins()),
        ] {
            let list = allowlist(&entries).into_string().expect("UTF-8");
            assert!(
                list.split(',').all(|entry| !entry.trim().is_empty()),
                "{name}: {list}"
            );
        }
        assert!(!ALLOWED_ORIGINS.contains(&OPAQUE_ORIGIN));
        assert!(scene_manager_origins().contains(&OPAQUE_ORIGIN));
    }

    #[test]
    #[should_panic(expected = "an allowlist needs entries")]
    fn test_allowlist_refuses_to_build_an_empty_list() {
        allowlist(&[]);
    }

    #[test]
    #[should_panic(expected = "no blank one")]
    fn test_allowlist_refuses_a_blank_entry() {
        allowlist(&["http://localhost:*", " "]);
    }

    #[test]
    fn test_orchestrator_spec_refuses_a_data_directory_it_cannot_use() {
        let dir = scratch("bad-data");
        std::fs::write(dir.join(orchestrator_file_name()), b"").expect("write");
        let relative = LocalEngineLayout::under(Path::new("app"), DEFAULT_API_PORT);
        assert!(matches!(
            orchestrator_spec(&dir, &relative),
            Err(HostError::DataDirNotAbsolute(_))
        ));
        let inside = LocalEngineLayout::under(&dir, DEFAULT_API_PORT);
        assert!(matches!(
            orchestrator_spec(&dir, &inside),
            Err(HostError::DataDirInsideEngine(_))
        ));
        // A layout whose data directory is `engine` under `app_dir`.
        let under = |app_dir: &Path| LocalEngineLayout::under(app_dir, DEFAULT_API_PORT);
        let name = dir.file_name().expect("a name");
        let around = dir.join("..").join(name).join("data");
        assert!(matches!(
            orchestrator_spec(&dir, &under(&around)),
            Err(HostError::DataDirInsideEngine(_))
        ));
        let detour = dir
            .parent()
            .expect("a parent")
            .join("elsewhere")
            .join("..")
            .join(name)
            .join("data");
        assert!(matches!(
            orchestrator_spec(&dir, &under(&detour)),
            Err(HostError::DataDirInsideEngine(_))
        ));
        #[cfg(unix)]
        {
            let link = dir.with_file_name(format!("{}-link", name.to_string_lossy()));
            let _ = std::fs::remove_file(&link);
            std::os::unix::fs::symlink(&dir, &link).expect("symlink");
            let through_link = orchestrator_spec(&dir, &under(&link.join("data")));
            std::fs::remove_file(&link).expect("cleanup");
            assert!(matches!(
                through_link,
                Err(HostError::DataDirInsideEngine(_))
            ));
        }
        let dotted = dir.join(".").join("data");
        assert!(matches!(
            orchestrator_spec(&dir, &under(&dotted)),
            Err(HostError::DataDirInsideEngine(_))
        ));
        let sibling = dir.with_file_name(format!("{}-data", name.to_string_lossy()));
        assert!(orchestrator_spec(&dir, &under(&sibling)).is_ok());
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn test_orchestrator_spec_refuses_a_directory_without_an_orchestrator() {
        let dir = scratch("empty");
        let layout = LocalEngineLayout::under(
            &std::env::temp_dir().join("woofx3-app-data"),
            DEFAULT_API_PORT,
        );
        assert!(matches!(
            orchestrator_spec(&dir, &layout),
            Err(HostError::OrchestratorMissing(path)) if path == dir.join(orchestrator_file_name())
        ));
        std::fs::create_dir_all(dir.join(orchestrator_file_name())).expect("mkdir");
        assert!(matches!(
            orchestrator_spec(&dir, &layout),
            Err(HostError::OrchestratorMissing(_))
        ));
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn test_within_resolved_compares_whole_components() {
        let cases = [
            ("/a/engine/data", "/a/engine", false, true),
            ("/a/engine", "/a/engine", false, true),
            ("/a/engine-data", "/a/engine", false, false),
            ("/a", "/a/engine", false, false),
            ("/A/Engine/data", "/a/engine", false, false),
            ("/A/Engine/data", "/a/engine", true, true),
            ("/a/ENGINE", "/a/engine", true, true),
            ("/a/engine2", "/a/engine", true, false),
        ];
        for (path, dir, ignore_case, inside) in cases {
            assert_eq!(
                within_resolved(Path::new(path), Path::new(dir), ignore_case),
                inside,
                "{path} in {dir}, ignoring case: {ignore_case}"
            );
        }
    }

    #[test]
    fn test_lexically_normalized_resolves_dots() {
        let cases = [
            ("/a/b/../c", "/a/c"),
            ("/a/./b", "/a/b"),
            ("/a/b/../../c/./d", "/c/d"),
            ("/a/b/", "/a/b"),
        ];
        for (written, normal) in cases {
            assert_eq!(
                lexically_normalized(Path::new(written)),
                Path::new(normal),
                "{written}"
            );
        }
    }
}
