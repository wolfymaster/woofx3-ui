//! The addresses the companion may dial. An address exists only because the
//! companion discovered it or the streamer confirmed it in the companion's own
//! window; nothing that arrives from the relay, the engine or module settings
//! becomes one.
//!
//! Nothing here limits addresses to private ranges: the streamer typed and
//! confirmed them, and an OBS on another PC on the LAN is legitimate. What the
//! companion refuses is any address it did not discover and the streamer did
//! not confirm.

use std::net::{IpAddr, Ipv6Addr};

use serde::{Deserialize, Serialize};

const MAX_DNS_NAME_LEN: usize = 253;
const MAX_DNS_LABEL_LEN: usize = 63;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AddressOrigin {
    /// Found by the companion on this PC or network.
    Discovered,
    /// Typed and confirmed by the streamer in the companion window.
    Confirmed,
}

/// A host and port the bridge may dial. The host is always an IP literal or a
/// valid DNS name, which the constructors and deserialization check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "StoredAddress", into = "StoredAddress")]
pub struct ConfirmedAddress {
    host: String,
    port: u16,
    origin: AddressOrigin,
}

#[derive(Serialize, Deserialize)]
struct StoredAddress {
    host: String,
    port: u16,
    origin: AddressOrigin,
}

impl TryFrom<StoredAddress> for ConfirmedAddress {
    type Error = anyhow::Error;

    fn try_from(stored: StoredAddress) -> anyhow::Result<Self> {
        validate_host(&stored.host)?;
        anyhow::ensure!(stored.port != 0, "port 0 cannot be dialled");
        Ok(ConfirmedAddress {
            host: stored.host,
            port: stored.port,
            origin: stored.origin,
        })
    }
}

impl From<ConfirmedAddress> for StoredAddress {
    fn from(address: ConfirmedAddress) -> Self {
        StoredAddress {
            host: address.host,
            port: address.port,
            origin: address.origin,
        }
    }
}

impl ConfirmedAddress {
    /// A server the companion found listening on this PC.
    pub fn discovered_loopback(port: u16) -> Self {
        assert!(port != 0, "a discovered port is never 0");
        ConfirmedAddress {
            host: "127.0.0.1".into(),
            port,
            origin: AddressOrigin::Discovered,
        }
    }

    /// What the streamer typed and confirmed in the companion window.
    pub fn confirmed(input: &str) -> anyhow::Result<Self> {
        let (host, port) = parse_manual(input)?;
        Ok(ConfirmedAddress {
            host,
            port,
            origin: AddressOrigin::Confirmed,
        })
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn origin(&self) -> AddressOrigin {
        self.origin
    }

    /// `host:port`, with brackets around an IPv6 host, as the window shows it.
    pub fn display(&self) -> String {
        if self.host.parse::<Ipv6Addr>().is_ok() {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }
}

/// Accepts `host:port` and `[v6]:port` only: no scheme, path, query or
/// userinfo. The host is an IP literal or a DNS name. IPv6 hosts are returned
/// without brackets.
pub fn parse_manual(input: &str) -> anyhow::Result<(String, u16)> {
    let input = input.trim();
    anyhow::ensure!(!input.is_empty(), "enter an address as host:port");
    anyhow::ensure!(
        !input.contains(['/', '@', '?', '#']) && !input.chars().any(char::is_whitespace),
        "enter only host:port, without a scheme, path or user name"
    );

    let (host, port) = if let Some(rest) = input.strip_prefix('[') {
        let (host, port) = rest
            .split_once("]:")
            .ok_or_else(|| anyhow::anyhow!("write an IPv6 address as [address]:port"))?;
        anyhow::ensure!(
            host.parse::<Ipv6Addr>().is_ok(),
            "{host} is not an IPv6 address"
        );
        (host, port)
    } else {
        let (host, port) = input
            .rsplit_once(':')
            .ok_or_else(|| anyhow::anyhow!("add the port, as host:port"))?;
        anyhow::ensure!(
            !host.contains(':'),
            "write an IPv6 address in brackets, as [address]:port"
        );
        validate_host(host)?;
        (host, port)
    };

    anyhow::ensure!(
        !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()),
        "the port must be a number"
    );
    let port: u16 = port
        .parse()
        .map_err(|_| anyhow::anyhow!("the port must be between 1 and 65535"))?;
    anyhow::ensure!(port != 0, "the port must be between 1 and 65535");
    Ok((host.to_ascii_lowercase(), port))
}

pub fn websocket_url(address: &ConfirmedAddress) -> String {
    format!("ws://{}/", address.display())
}

fn validate_host(host: &str) -> anyhow::Result<()> {
    if host.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    anyhow::ensure!(!host.is_empty(), "the host is empty");
    anyhow::ensure!(
        host.len() <= MAX_DNS_NAME_LEN,
        "the host name is longer than {MAX_DNS_NAME_LEN} characters"
    );
    let labels: Vec<&str> = host.split('.').collect();
    for label in &labels {
        anyhow::ensure!(
            !label.is_empty()
                && label.len() <= MAX_DNS_LABEL_LEN
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                && !label.starts_with('-')
                && !label.ends_with('-'),
            "{host} is not a valid host name"
        );
    }
    // A name whose last label is all digits is a mistyped IPv4 address
    // (`192.168.1`, `300.1.1.1`), not a host name.
    let last = labels.last().expect("split yields at least one label");
    anyhow::ensure!(
        !last.bytes().all(|b| b.is_ascii_digit()),
        "{host} is not a valid IP address"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(input: &str) -> (String, u16) {
        parse_manual(input).unwrap_or_else(|error| panic!("{input}: {error}"))
    }

    #[test]
    fn accepts_host_and_port() {
        assert_eq!(ok("127.0.0.1:4455"), ("127.0.0.1".into(), 4455));
        assert_eq!(ok("192.168.1.20:4455"), ("192.168.1.20".into(), 4455));
        assert_eq!(ok("obs-pc.local:4455"), ("obs-pc.local".into(), 4455));
        assert_eq!(ok("Streaming-PC:80"), ("streaming-pc".into(), 80));
        assert_eq!(ok("  localhost:65535 "), ("localhost".into(), 65535));
    }

    #[test]
    fn accepts_bracketed_ipv6() {
        assert_eq!(ok("[::1]:4455"), ("::1".into(), 4455));
        assert_eq!(ok("[fe80::1:2]:1"), ("fe80::1:2".into(), 1));
    }

    #[test]
    fn refuses_schemes_paths_and_userinfo() {
        for input in [
            "ws://127.0.0.1:4455",
            "127.0.0.1:4455/",
            "127.0.0.1:4455/admin",
            "user@127.0.0.1:4455",
            "user:pw@host:80",
            "127.0.0.1:4455?x=1",
            "127.0.0.1:4455#x",
        ] {
            assert!(parse_manual(input).is_err(), "{input}");
        }
    }

    #[test]
    fn refuses_bad_ports() {
        for input in [
            "127.0.0.1",
            "127.0.0.1:",
            "127.0.0.1:0",
            "127.0.0.1:65536",
            "127.0.0.1:+80",
            "127.0.0.1:4a",
        ] {
            assert!(parse_manual(input).is_err(), "{input}");
        }
    }

    #[test]
    fn refuses_bad_hosts() {
        let long_label = format!("{}.com:80", "a".repeat(64));
        let long_name = format!("{}:80", ["abcdefghij"; 26].join("."));
        for input in [
            ":4455",
            "::1:4455",
            "[::1:4455",
            "[not-v6]:4455",
            "[127.0.0.1]:4455",
            "-bad.example:80",
            "bad-.example:80",
            "under_score:80",
            "a..b:80",
            "trailing.dot.:80",
            "192.168.1:80",
            "300.1.1.1:80",
            "two words:80",
            "émoji.example:80",
            long_label.as_str(),
            long_name.as_str(),
        ] {
            assert!(parse_manual(input).is_err(), "{input}");
        }
    }

    #[test]
    fn a_253_character_name_is_allowed() {
        let name = format!("{}.{}", vec!["a".repeat(63); 3].join("."), "a".repeat(61));
        assert_eq!(name.len(), 253);
        assert_eq!(ok(&format!("{name}:80")).0, name);
    }

    #[test]
    fn builds_websocket_urls() {
        assert_eq!(
            websocket_url(&ConfirmedAddress::discovered_loopback(4455)),
            "ws://127.0.0.1:4455/"
        );
        assert_eq!(
            websocket_url(&ConfirmedAddress::confirmed("[::1]:4455").unwrap()),
            "ws://[::1]:4455/"
        );
        assert_eq!(
            websocket_url(&ConfirmedAddress::confirmed("obs.lan:4455").unwrap()),
            "ws://obs.lan:4455/"
        );
    }

    #[test]
    fn records_where_an_address_came_from() {
        assert_eq!(
            ConfirmedAddress::discovered_loopback(4455).origin(),
            AddressOrigin::Discovered
        );
        assert_eq!(
            ConfirmedAddress::confirmed("10.0.0.2:4455")
                .unwrap()
                .origin(),
            AddressOrigin::Confirmed
        );
    }

    #[test]
    fn serializes_as_the_integration_store_shape() {
        let json = serde_json::to_string(&ConfirmedAddress::discovered_loopback(4455)).unwrap();
        assert_eq!(
            json,
            r#"{"host":"127.0.0.1","port":4455,"origin":"discovered"}"#
        );
        let back: ConfirmedAddress = serde_json::from_str(&json).unwrap();
        assert_eq!(back, ConfirmedAddress::discovered_loopback(4455));
    }

    #[test]
    fn deserialization_revalidates_the_host_and_port() {
        for json in [
            r#"{"host":"ws://x","port":80,"origin":"confirmed"}"#,
            r#"{"host":"","port":80,"origin":"confirmed"}"#,
            r#"{"host":"127.0.0.1","port":0,"origin":"discovered"}"#,
            r#"{"host":"127.0.0.1","port":80,"origin":"relay"}"#,
        ] {
            assert!(
                serde_json::from_str::<ConfirmedAddress>(json).is_err(),
                "{json}"
            );
        }
    }
}
