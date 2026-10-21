//! Which mode the desktop host runs in, read from a JSON file in the app's
//! config directory. Without the file the host is the tray companion it has
//! always been. Local mode, which runs an engine under the host, is selected
//! only by this file:
//!
//! ```json
//! { "mode": "local", "engineDir": "C:\\woofx3\\engine" }
//! ```
//!
//! `engineDir` is the unpacked engine release (the orchestrator, its
//! `services.json` and every service binary). Without it the host uses the
//! engine bundled with the app.

use std::path::{Path, PathBuf};

use serde::Deserialize;

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalEngineSettings {
    /// Absolute when set; checked when the file is read.
    pub engine_dir: Option<PathBuf>,
}

impl LocalEngineSettings {
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
    },
}

impl HostMode {
    /// Reads the mode from `path`. A missing file means [`HostMode::Companion`];
    /// a file that is there but unreadable or invalid is an error, so a typo
    /// never quietly turns local mode off.
    pub fn load(path: &Path) -> Result<Self, HostError> {
        match std::fs::read_to_string(path) {
            Ok(raw) => HostMode::parse(&raw, path),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(HostMode::Companion),
            Err(source) => Err(HostError::ConfigUnreadable {
                path: path.to_path_buf(),
                source,
            }),
        }
    }

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
            ConfigFile::Local { engine_dir } => {
                if let Some(dir) = &engine_dir {
                    if !dir.is_absolute() {
                        return Err(HostError::EngineDirNotAbsolute(dir.clone()));
                    }
                }
                Ok(HostMode::Local(LocalEngineSettings { engine_dir }))
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
                HostMode::Local(LocalEngineSettings { engine_dir: None }),
            ),
            (
                "local with an engine directory",
                format!(r#"{{"mode":"local","engineDir":{engine_json}}}"#),
                HostMode::Local(LocalEngineSettings {
                    engine_dir: Some(engine.clone()),
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
                HostMode::Local(LocalEngineSettings { engine_dir: None }),
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
    }

    #[test]
    fn test_host_mode_load_treats_a_missing_file_as_companion() {
        let path = absolute(&format!("woofx3-host-config-{}.json", std::process::id()));
        assert_eq!(
            HostMode::load(&path).expect("missing is fine"),
            HostMode::Companion
        );
        std::fs::write(&path, r#"{"mode":"local"}"#).expect("write");
        assert_eq!(
            HostMode::load(&path).expect("reads"),
            HostMode::Local(LocalEngineSettings { engine_dir: None })
        );
        std::fs::remove_file(&path).expect("cleanup");
    }

    #[test]
    fn test_host_mode_load_reports_a_path_it_cannot_read() {
        let dir = absolute(&format!("woofx3-host-config-dir-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("mkdir");
        assert!(matches!(
            HostMode::load(&dir),
            Err(HostError::ConfigUnreadable { .. })
        ));
        std::fs::remove_dir(&dir).expect("cleanup");
    }

    #[test]
    fn test_local_engine_settings_engine_dir_falls_back_to_the_bundle() {
        let bundled = absolute("bundled");
        let configured = absolute("configured");
        let unset = LocalEngineSettings { engine_dir: None };
        assert_eq!(unset.engine_dir(&bundled), bundled.as_path());
        let set = LocalEngineSettings {
            engine_dir: Some(configured.clone()),
        };
        assert_eq!(set.engine_dir(&bundled), configured.as_path());
    }
}
