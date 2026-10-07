//! Messages on the relay connection. Binary WebSocket messages are data frames,
//! `[u8 version][u8 kind][u32 BE stream id][payload]`; text messages are JSON
//! control messages. Must match woofx3-maintenance worker/src/relay/frame.ts.

use serde::{Deserialize, Serialize};

pub const FRAME_VERSION: u8 = 1;
pub const HEADER_LEN: usize = 6;
pub const MAX_PAYLOAD: usize = 1024 * 1024;

/// Kinds 3–6 are reserved for HTTP head, body, end and reset. This version
/// does not read them, so a frame carrying one is malformed here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameKind {
    WsText = 1,
    WsBinary = 2,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub kind: FrameKind,
    pub stream_id: u32,
    pub payload: Vec<u8>,
}

pub fn encode(frame: &Frame) -> anyhow::Result<Vec<u8>> {
    anyhow::ensure!(frame.stream_id != 0, "stream id 0 is reserved");
    anyhow::ensure!(
        frame.payload.len() <= MAX_PAYLOAD,
        "frame payload {} exceeds {MAX_PAYLOAD}",
        frame.payload.len()
    );
    let mut bytes = Vec::with_capacity(HEADER_LEN + frame.payload.len());
    bytes.push(FRAME_VERSION);
    bytes.push(frame.kind as u8);
    bytes.extend_from_slice(&frame.stream_id.to_be_bytes());
    bytes.extend_from_slice(&frame.payload);
    Ok(bytes)
}

/// None for anything this version cannot read; the relay connection is then
/// closed rather than guessed at.
pub fn decode(bytes: &[u8]) -> Option<Frame> {
    if bytes.len() < HEADER_LEN
        || bytes[0] != FRAME_VERSION
        || bytes.len() - HEADER_LEN > MAX_PAYLOAD
    {
        return None;
    }
    let kind = match bytes[1] {
        1 => FrameKind::WsText,
        2 => FrameKind::WsBinary,
        _ => return None,
    };
    let stream_id = u32::from_be_bytes([bytes[2], bytes[3], bytes[4], bytes[5]]);
    if stream_id == 0 {
        return None;
    }
    Some(Frame {
        kind,
        stream_id,
        payload: bytes[HEADER_LEN..].to_vec(),
    })
}

/// Control messages the relay sends. `open` names a module and an endpoint,
/// never an address: the companion looks the address up itself. Unknown fields
/// are ignored, so an `open` that carries an address has it dropped here.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum FromRelay {
    Open {
        sid: u32,
        module: String,
        endpoint: String,
        protocols: Vec<String>,
    },
    Close {
        sid: u32,
        code: u16,
        reason: String,
    },
    Pong,
}

/// Control messages the companion sends.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum ToRelay {
    Opened {
        sid: u32,
        protocol: Option<String>,
    },
    Close {
        sid: u32,
        code: u16,
        reason: String,
    },
    Refresh {
        credential: String,
    },
    /// Serializes to exactly `{"t":"ping"}`, the Durable Object's auto-response
    /// key, so the relay answers without waking.
    Ping,
}

impl FromRelay {
    pub fn parse(text: &str) -> Option<FromRelay> {
        serde_json::from_str(text).ok()
    }
}

impl ToRelay {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("control messages always serialize")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Must equal the golden bytes in woofx3-maintenance worker/test/frame.test.ts.
    const GOLDEN: [u8; 8] = [0x01, 0x02, 0x00, 0x00, 0x00, 0x07, 0xde, 0xad];

    fn golden_frame() -> Frame {
        Frame {
            kind: FrameKind::WsBinary,
            stream_id: 7,
            payload: vec![0xde, 0xad],
        }
    }

    #[test]
    fn encodes_the_golden_bytes() {
        assert_eq!(encode(&golden_frame()).unwrap(), GOLDEN);
    }

    #[test]
    fn decodes_the_golden_bytes() {
        assert_eq!(decode(&GOLDEN), Some(golden_frame()));
    }

    #[test]
    fn round_trips_text_and_binary_frames() {
        for frame in [
            Frame {
                kind: FrameKind::WsText,
                stream_id: 1,
                payload: br#"{"op":1}"#.to_vec(),
            },
            Frame {
                kind: FrameKind::WsBinary,
                stream_id: u32::MAX,
                payload: vec![],
            },
            Frame {
                kind: FrameKind::WsBinary,
                stream_id: 0x0102_0304,
                payload: vec![0xab; MAX_PAYLOAD],
            },
        ] {
            assert_eq!(decode(&encode(&frame).unwrap()), Some(frame));
        }
    }

    #[test]
    fn stream_id_is_big_endian() {
        let bytes = encode(&Frame {
            kind: FrameKind::WsText,
            stream_id: 0x0102_0304,
            payload: vec![],
        })
        .unwrap();
        assert_eq!(bytes, [1, 1, 1, 2, 3, 4]);
    }

    #[test]
    fn refuses_to_encode_stream_zero_or_an_oversized_payload() {
        assert!(encode(&Frame {
            kind: FrameKind::WsText,
            stream_id: 0,
            payload: vec![],
        })
        .is_err());
        assert!(encode(&Frame {
            kind: FrameKind::WsText,
            stream_id: 1,
            payload: vec![0; MAX_PAYLOAD + 1],
        })
        .is_err());
    }

    #[test]
    fn rejects_malformed_frames() {
        // Shorter than the header.
        assert_eq!(decode(&[]), None);
        assert_eq!(decode(&GOLDEN[..5]), None);
        // Another version.
        assert_eq!(decode(&[0x02, 0x02, 0, 0, 0, 7]), None);
        assert_eq!(decode(&[0x00, 0x02, 0, 0, 0, 7]), None);
        // Kind 0, the reserved HTTP kinds 3–6, and anything above.
        for kind in [0u8, 3, 4, 5, 6, 7, 0xff] {
            assert_eq!(decode(&[0x01, kind, 0, 0, 0, 7]), None, "kind {kind}");
        }
        // Stream 0.
        assert_eq!(decode(&[0x01, 0x01, 0, 0, 0, 0]), None);
        // A payload over the cap.
        let mut oversized = vec![0x01, 0x02, 0, 0, 0, 7];
        oversized.resize(HEADER_LEN + MAX_PAYLOAD + 1, 0);
        assert_eq!(decode(&oversized), None);
    }

    #[test]
    fn decodes_a_header_with_an_empty_payload() {
        assert_eq!(
            decode(&[0x01, 0x01, 0, 0, 0, 9]),
            Some(Frame {
                kind: FrameKind::WsText,
                stream_id: 9,
                payload: vec![],
            })
        );
    }

    #[test]
    fn ping_is_the_relay_auto_response_key() {
        assert_eq!(ToRelay::Ping.to_json(), r#"{"t":"ping"}"#);
    }

    #[test]
    fn serializes_companion_control_messages() {
        assert_eq!(
            ToRelay::Opened {
                sid: 1,
                protocol: Some("obswebsocket.json".into())
            }
            .to_json(),
            r#"{"t":"opened","sid":1,"protocol":"obswebsocket.json"}"#
        );
        assert_eq!(
            ToRelay::Opened {
                sid: 2,
                protocol: None
            }
            .to_json(),
            r#"{"t":"opened","sid":2,"protocol":null}"#
        );
        assert_eq!(
            ToRelay::Close {
                sid: 3,
                code: 4403,
                reason: "no".into()
            }
            .to_json(),
            r#"{"t":"close","sid":3,"code":4403,"reason":"no"}"#
        );
        assert_eq!(
            ToRelay::Refresh {
                credential: "wfxr1.k1.a.b".into()
            }
            .to_json(),
            r#"{"t":"refresh","credential":"wfxr1.k1.a.b"}"#
        );
    }

    #[test]
    fn parses_relay_control_messages() {
        assert_eq!(
            FromRelay::parse(
                r#"{"t":"open","sid":1,"module":"woofx3_obs","endpoint":"obs","protocols":["obswebsocket.json"]}"#
            ),
            Some(FromRelay::Open {
                sid: 1,
                module: "woofx3_obs".into(),
                endpoint: "obs".into(),
                protocols: vec!["obswebsocket.json".into()],
            })
        );
        assert_eq!(
            FromRelay::parse(r#"{"t":"close","sid":4,"code":1000,"reason":""}"#),
            Some(FromRelay::Close {
                sid: 4,
                code: 1000,
                reason: String::new(),
            })
        );
        assert_eq!(FromRelay::parse(r#"{"t":"pong"}"#), Some(FromRelay::Pong));
    }

    #[test]
    fn rejects_unknown_or_malformed_control_messages() {
        assert_eq!(FromRelay::parse(r#"{"t":"teleport"}"#), None);
        assert_eq!(FromRelay::parse(r#"{"t":"open","sid":1}"#), None);
        assert_eq!(
            FromRelay::parse(r#"{"t":"open","sid":-1,"module":"m","endpoint":"e","protocols":[]}"#),
            None
        );
        assert_eq!(FromRelay::parse("not json"), None);
    }

    #[test]
    fn an_address_in_open_is_dropped() {
        let parsed = FromRelay::parse(
            r#"{"t":"open","sid":1,"module":"m","endpoint":"e","protocols":[],"host":"192.168.1.1","port":80}"#,
        );
        assert_eq!(
            parsed,
            Some(FromRelay::Open {
                sid: 1,
                module: "m".into(),
                endpoint: "e".into(),
                protocols: vec![],
            })
        );
    }
}
