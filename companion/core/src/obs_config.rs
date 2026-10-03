//! Finds OBS's WebSocket server from obs-websocket's own config file, which
//! obs-websocket 5.3 (OBS 30) and later keep at
//! `<config dir>/obs-studio/plugin_config/obs-websocket/config.json`
//! (`%APPDATA%` on Windows). Older versions kept it in OBS's global.ini and
//! are not read: nothing is discovered, and the streamer enters the port.
//!
//! Key names and defaults follow obs-websocket's `src/Config.cpp` and
//! `src/Config.h`. Like obs-websocket, a key of the wrong type is treated as
//! absent rather than failing the whole file.

use std::fmt;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::address::ConfirmedAddress;

/// obs-websocket's defaults when a key is absent (`Config.h`).
const DEFAULT_PORT: u16 = 4455;
const DEFAULT_SERVER_ENABLED: bool = false;
const DEFAULT_AUTH_REQUIRED: bool = true;

/// obs-websocket's file is a few hundred bytes. Anything far larger is not
/// it, and is not read into memory.
pub const MAX_CONFIG_BYTES: u64 = 64 * 1024;

#[derive(Clone, PartialEq, Eq)]
pub struct ObsDiscovery {
    pub server_enabled: bool,
    pub port: u16,
    /// Present only when authentication is on and a password is set.
    pub password: Option<String>,
}

impl ObsDiscovery {
    /// OBS's server listens on this PC, so the discovered address is always
    /// loopback.
    pub fn address(&self) -> ConfirmedAddress {
        ConfirmedAddress::discovered_loopback(self.port)
    }
}

/// Never prints the password, so a discovery can be logged.
impl fmt::Debug for ObsDiscovery {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ObsDiscovery")
            .field("server_enabled", &self.server_enabled)
            .field("port", &self.port)
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .finish()
    }
}

pub fn parse(json: &str) -> anyhow::Result<ObsDiscovery> {
    let raw: Value = serde_json::from_str(json)?;
    let Value::Object(config) = raw else {
        anyhow::bail!("obs-websocket config is not a JSON object");
    };
    let flag = |key: &str| config.get(key).and_then(Value::as_bool);

    let server_enabled = flag("server_enabled").unwrap_or(DEFAULT_SERVER_ENABLED);
    let auth_required = flag("auth_required").unwrap_or(DEFAULT_AUTH_REQUIRED);
    let port = config
        .get("server_port")
        .and_then(Value::as_u64)
        .and_then(|port| u16::try_from(port).ok())
        .filter(|port| *port != 0)
        .unwrap_or(DEFAULT_PORT);
    let password = config
        .get("server_password")
        .and_then(Value::as_str)
        .filter(|password| auth_required && !password.is_empty())
        .map(str::to_owned);

    Ok(ObsDiscovery {
        server_enabled,
        port,
        password,
    })
}

pub fn config_path(config_dir: &Path) -> PathBuf {
    config_dir
        .join("obs-studio")
        .join("plugin_config")
        .join("obs-websocket")
        .join("config.json")
}

/// `Ok(None)` when the file does not exist: OBS is not installed, is older
/// than 30, or has never started. The file is small, so this reads it
/// synchronously; call it off the async runtime's worker threads.
pub fn read(config_dir: &Path) -> anyhow::Result<Option<ObsDiscovery>> {
    let path = config_path(config_dir);
    let file = match std::fs::File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(anyhow::Error::new(error).context(format!("reading {}", path.display())))
        }
    };
    let mut json = String::new();
    file.take(MAX_CONFIG_BYTES + 1)
        .read_to_string(&mut json)
        .map_err(|error| {
            anyhow::Error::new(error).context(format!("reading {}", path.display()))
        })?;
    anyhow::ensure!(
        json.len() as u64 <= MAX_CONFIG_BYTES,
        "{} is larger than {MAX_CONFIG_BYTES} bytes",
        path.display()
    );
    parse(&json).map(Some)
}

/// Lower-case hex SHA-256 of a password, so the companion can remember which
/// password it last sent without storing the password itself.
pub fn password_sha256_hex(password: &str) -> String {
    Sha256::digest(password.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What obs-websocket 5.5 writes after the streamer has set a password.
    const FULL: &str = r#"{
        "alerts_enabled": false,
        "auth_required": true,
        "first_load": false,
        "server_enabled": true,
        "server_password": "hunter2hunter2",
        "server_port": 4466
    }"#;

    #[test]
    fn reads_a_full_file() {
        assert_eq!(
            parse(FULL).unwrap(),
            ObsDiscovery {
                server_enabled: true,
                port: 4466,
                password: Some("hunter2hunter2".into()),
            }
        );
    }

    #[test]
    fn no_password_when_auth_is_off() {
        let discovery = parse(r#"{"server_enabled":true,"server_port":4455,"auth_required":false,"server_password":"set"}"#)
            .unwrap();
        assert_eq!(discovery.password, None);
    }

    #[test]
    fn no_password_when_it_is_empty() {
        let discovery =
            parse(r#"{"server_enabled":true,"auth_required":true,"server_password":""}"#).unwrap();
        assert_eq!(discovery.password, None);
    }

    #[test]
    fn auth_defaults_to_required() {
        let discovery = parse(r#"{"server_enabled":true,"server_password":"pw"}"#).unwrap();
        assert_eq!(discovery.password.as_deref(), Some("pw"));
    }

    #[test]
    fn a_missing_or_zero_port_is_4455() {
        assert_eq!(parse(r#"{"server_enabled":true}"#).unwrap().port, 4455);
        assert_eq!(
            parse(r#"{"server_enabled":true,"server_port":0}"#)
                .unwrap()
                .port,
            4455
        );
    }

    #[test]
    fn keys_of_the_wrong_type_are_ignored_like_obs_websocket_does() {
        let discovery = parse(r#"{"server_enabled":"yes","server_port":"4456","auth_required":1,"server_password":5}"#)
            .unwrap();
        assert_eq!(
            discovery,
            ObsDiscovery {
                server_enabled: false,
                port: 4455,
                password: None,
            }
        );
        assert_eq!(parse(r#"{"server_port":70000}"#).unwrap().port, 4455);
        assert_eq!(parse(r#"{"server_port":-1}"#).unwrap().port, 4455);
    }

    #[test]
    fn a_disabled_server_is_reported() {
        let discovery = parse(r#"{"server_enabled":false,"server_port":4455}"#).unwrap();
        assert!(!discovery.server_enabled);
        assert!(!parse("{}").unwrap().server_enabled);
    }

    #[test]
    fn invalid_json_is_an_error() {
        assert!(parse("{").is_err());
        assert!(parse("").is_err());
        assert!(parse("[]").is_err());
        assert!(parse("null").is_err());
    }

    #[test]
    fn the_discovered_address_is_loopback() {
        let address = parse(FULL).unwrap().address();
        assert_eq!(address.host(), "127.0.0.1");
        assert_eq!(address.port(), 4466);
    }

    #[test]
    fn debug_output_redacts_the_password() {
        let printed = format!("{:?}", parse(FULL).unwrap());
        assert!(!printed.contains("hunter2"), "{printed}");
        assert!(printed.contains("<redacted>"));
    }

    #[test]
    fn config_path_is_under_plugin_config() {
        let path = config_path(Path::new("/home/streamer/.config"));
        assert_eq!(
            path,
            Path::new("/home/streamer/.config/obs-studio/plugin_config/obs-websocket/config.json")
        );
    }

    #[test]
    fn reads_the_file_from_a_config_dir() {
        let dir = std::env::temp_dir().join(format!("woofx3-obs-config-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(read(&dir).unwrap(), None);

        let path = config_path(&dir);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, FULL).unwrap();
        let discovery = read(&dir).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(discovery.map(|d| d.port), Some(4466));
    }

    #[test]
    fn refuses_a_file_larger_than_the_cap() {
        let dir =
            std::env::temp_dir().join(format!("woofx3-obs-config-big-{}", std::process::id()));
        let path = config_path(&dir);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let padding = " ".repeat(MAX_CONFIG_BYTES as usize);
        std::fs::write(&path, format!("{{{padding}\"server_port\": 4466}}")).unwrap();
        let result = read(&dir);
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(result.is_err());
    }

    #[test]
    fn password_digest_is_lower_hex_sha256() {
        assert_eq!(
            password_sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
