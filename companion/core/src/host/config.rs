//! Which mode the desktop host runs in, read from a JSON file in the app's
//! config directory. Without the file the host runs in the mode its build
//! defaults to: the tray companion, or local mode for a build that bundles an
//! engine. The file selects either mode explicitly:
//!
//! ```json
//! { "mode": "local", "engineDir": "C:\\woofx3\\engine", "apiPort": 5050 }
//! ```
//!
//! `engineDir` is the unpacked engine release (the orchestrator, its
//! `services.json` and every service binary). Without it the host uses the
//! engine bundled with the app. `apiPort` is the port the engine's api
//! listens on, [`DEFAULT_API_PORT`] unless set.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::engine::DEFAULT_API_PORT;
use super::HostError;

/// The file the mode is read from, in the app's config directory.
pub const HOST_CONFIG_FILE: &str = "desktop-host.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostMode {
    /// The tray companion: no local engine.
    Companion,
    /// The host runs a local engine as its sidecar.
    Local(LocalEngineSettings),
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LocalEngineSettings {
    /// Absolute when set; checked when the file is read.
    pub engine_dir: Option<PathBuf>,
    /// Never 0; checked when the file is read.
    pub api_port: Option<u16>,
}

impl LocalEngineSettings {
    pub fn api_port(&self) -> u16 {
        self.api_port.unwrap_or(DEFAULT_API_PORT)
    }

    /// The engine release to run: the configured one, else `bundled`.
    pub fn engine_dir<'a>(&'a self, bundled: &'a Path) -> &'a Path {
        self.engine_dir.as_deref().unwrap_or(bundled)
    }
}

/// The orchestrator's file name in an engine release. Must match the
/// packaging in the engine's build/scripts/package.sh.
pub fn orchestrator_file_name() -> &'static str {
    if cfg!(windows) {
        "orchestrator.exe"
    } else {
        "orchestrator"
    }
}

#[derive(Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase", deny_unknown_fields)]
enum ConfigFile {
    // A struct variant, not a unit one, so `deny_unknown_fields` covers it.
    Companion {},
    #[serde(rename_all = "camelCase")]
    Local {
        #[serde(default)]
        engine_dir: Option<PathBuf>,
        #[serde(default)]
        api_port: Option<u16>,
    },
}

/// The mode a host runs in and whether a configuration file chose it. A host
/// whose mode was not chosen runs its build's default, and the dashboard asks
/// the streamer which they want.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostConfig {
    pub mode: HostMode,
    pub chosen: bool,
}

impl HostConfig {
    /// Reads the mode from `path`. A missing file means `when_missing`, the
    /// build's default; a file that is there but unreadable or invalid is an
    /// error, so a typo never quietly switches modes.
    pub fn load(path: &Path, when_missing: HostMode) -> Result<Self, HostError> {
        match std::fs::read_to_string(path) {
            Ok(raw) => Ok(HostConfig {
                mode: HostMode::parse(&raw, path)?,
                chosen: true,
            }),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(HostConfig {
                mode: when_missing,
                chosen: false,
            }),
            Err(source) => Err(HostError::ConfigUnreadable {
                path: path.to_path_buf(),
                source,
            }),
        }
    }
}

/// A mode the streamer can choose, without the settings only a hand-written
/// configuration sets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub enum HostModeKind {
    Local,
    Companion,
}

impl HostModeKind {
    pub fn of(mode: &HostMode) -> Self {
        match mode {
            HostMode::Companion => HostModeKind::Companion,
            HostMode::Local(_) => HostModeKind::Local,
        }
    }
}

/// Writes the configuration file choosing `kind`, as `{"mode": ...}`, only
/// if there is none: a hard link from a fully written temporary file makes
/// the file appear whole or not at all, and fails if one is already there.
pub fn choose_host_mode(path: &Path, kind: HostModeKind) -> Result<(), HostError> {
    let unwritable = |source| HostError::ConfigUnwritable {
        path: path.to_path_buf(),
        source,
    };
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(unwritable)?;
    }
    let contents = serde_json::json!({ "mode": kind }).to_string();
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, contents).map_err(unwritable)?;
    let linked = std::fs::hard_link(&temporary, path);
    let removed = std::fs::remove_file(&temporary);
    match linked {
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(HostError::ConfigAlreadyChosen(path.to_path_buf()));
        }
        Err(source) => return Err(unwritable(source)),
        Ok(()) => {}
    }
    removed.map_err(unwritable)
}

impl HostMode {
    /// `path` only names the file in errors.
    pub fn parse(raw: &str, path: &Path) -> Result<Self, HostError> {
        // Notepad writes a byte order mark.
        let raw = raw.trim_start_matches('\u{feff}');
        let file: ConfigFile =
            serde_json::from_str(raw).map_err(|source| HostError::ConfigInvalid {
                path: path.to_path_buf(),
                source,
            })?;
        match file {
            ConfigFile::Companion {} => Ok(HostMode::Companion),
            ConfigFile::Local {
                engine_dir,
                api_port,
            } => {
                if let Some(dir) = &engine_dir {
                    if !dir.is_absolute() {
                        return Err(HostError::EngineDirNotAbsolute(dir.clone()));
                    }
                }
                if api_port == Some(0) {
                    return Err(HostError::ApiPortZero);
                }
                Ok(HostMode::Local(LocalEngineSettings {
                    engine_dir,
                    api_port,
                }))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn absolute(name: &str) -> PathBuf {
        std::env::temp_dir().join(name)
    }

    fn parse(raw: &str) -> Result<HostMode, HostError> {
        HostMode::parse(raw, Path::new(HOST_CONFIG_FILE))
    }

    #[test]
    fn test_host_mode_parse_reads_each_mode() {
        let engine = absolute("engine");
        let engine_json = serde_json::to_string(&engine).expect("a path serializes");
        let cases: Vec<(&str, String, HostMode)> = vec![
            (
                "companion",
                r#"{"mode":"companion"}"#.to_string(),
                HostMode::Companion,
            ),
            (
                "local with the bundled engine",
                r#"{"mode":"local"}"#.to_string(),
                HostMode::Local(LocalEngineSettings {
                    engine_dir: None,
                    api_port: None,
                }),
            ),
            (
                "local with an engine directory",
                format!(r#"{{"mode":"local","engineDir":{engine_json}}}"#),
                HostMode::Local(LocalEngineSettings {
                    engine_dir: Some(engine.clone()),
                    api_port: None,
                }),
            ),
            (
                "local with an api port",
                r#"{"mode":"local","apiPort":20200}"#.to_string(),
                HostMode::Local(LocalEngineSettings {
                    engine_dir: None,
                    api_port: Some(20200),
                }),
            ),
            (
                "byte order mark",
                "\u{feff}{\"mode\":\"companion\"}".to_string(),
                HostMode::Companion,
            ),
            (
                "whitespace and newlines",
                "\n  { \"mode\" : \"local\" }\r\n".to_string(),
                HostMode::Local(LocalEngineSettings {
                    engine_dir: None,
                    api_port: None,
                }),
            ),
        ];
        for (case, raw, expected) in cases {
            let parsed = parse(&raw).unwrap_or_else(|err| panic!("{case}: {err}"));
            assert_eq!(parsed, expected, "{case}");
        }
    }

    #[test]
    fn test_host_mode_parse_rejects_invalid_files() {
        let invalid = [
            ("empty", ""),
            ("not JSON", "mode=local"),
            ("no mode", "{}"),
            ("unknown mode", r#"{"mode":"cloud"}"#),
            (
                "misspelled field",
                r#"{"mode":"local","engineDirectory":"/x"}"#,
            ),
            (
                "field on companion",
                r#"{"mode":"companion","engineDir":"/x"}"#,
            ),
            ("mode in the wrong case", r#"{"mode":"Local"}"#),
            ("port out of range", r#"{"mode":"local","apiPort":70000}"#),
            ("port as a string", r#"{"mode":"local","apiPort":"5050"}"#),
        ];
        for (case, raw) in invalid {
            assert!(
                matches!(parse(raw), Err(HostError::ConfigInvalid { .. })),
                "{case}: {:?}",
                parse(raw)
            );
        }
        assert!(matches!(
            parse(r#"{"mode":"local","engineDir":"engine"}"#),
            Err(HostError::EngineDirNotAbsolute(dir)) if dir == Path::new("engine")
        ));
        assert!(matches!(
            parse(r#"{"mode":"local","apiPort":0}"#),
            Err(HostError::ApiPortZero)
        ));
    }

    #[test]
    fn test_host_config_load_treats_a_missing_file_as_the_unchosen_build_default() {
        let path = absolute(&format!("woofx3-host-config-{}.json", std::process::id()));
        assert_eq!(
            HostConfig::load(&path, HostMode::Companion).expect("missing is fine"),
            HostConfig {
                mode: HostMode::Companion,
                chosen: false
            }
        );
        assert_eq!(
            HostConfig::load(&path, HostMode::Local(LocalEngineSettings::default()))
                .expect("missing is fine")
                .mode,
            HostMode::Local(LocalEngineSettings::default())
        );
        std::fs::write(&path, r#"{"mode":"local"}"#).expect("write");
        assert_eq!(
            HostConfig::load(&path, HostMode::Companion).expect("reads"),
            HostConfig {
                mode: HostMode::Local(LocalEngineSettings::default()),
                chosen: true
            }
        );
        std::fs::remove_file(&path).expect("cleanup");
    }

    #[test]
    fn test_choose_host_mode_writes_a_configuration_once() {
        let dir = absolute(&format!("woofx3-host-choose-{}", std::process::id()));
        let path = dir.join(HOST_CONFIG_FILE);
        choose_host_mode(&path, HostModeKind::Companion).expect("writes");
        assert_eq!(
            HostConfig::load(&path, HostMode::Local(LocalEngineSettings::default()))
                .expect("reads"),
            HostConfig {
                mode: HostMode::Companion,
                chosen: true
            }
        );
        assert!(matches!(
            choose_host_mode(&path, HostModeKind::Local),
            Err(HostError::ConfigAlreadyChosen(_))
        ));
        assert_eq!(
            HostConfig::load(&path, HostMode::Companion)
                .expect("reads")
                .mode,
            HostMode::Companion
        );
        assert!(!path.with_extension("json.tmp").exists());
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn test_host_mode_load_reports_a_path_it_cannot_read() {
        let dir = absolute(&format!("woofx3-host-config-dir-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("mkdir");
        assert!(matches!(
            HostConfig::load(&dir, HostMode::Companion),
            Err(HostError::ConfigUnreadable { .. })
        ));
        std::fs::remove_dir(&dir).expect("cleanup");
    }

    #[test]
    fn test_local_engine_settings_fall_back_to_the_bundle_and_default_port() {
        let bundled = absolute("bundled");
        let configured = absolute("configured");
        let unset = LocalEngineSettings {
            engine_dir: None,
            api_port: None,
        };
        assert_eq!(unset.engine_dir(&bundled), bundled.as_path());
        assert_eq!(unset.api_port(), DEFAULT_API_PORT);
        let set = LocalEngineSettings {
            engine_dir: Some(configured.clone()),
            api_port: Some(20200),
        };
        assert_eq!(set.engine_dir(&bundled), configured.as_path());
        assert_eq!(set.api_port(), 20200);
    }
}
