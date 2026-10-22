//! The part of capnweb's HTTP batch protocol the host speaks to the engine's
//! `/api`: a batch of calls on the main stub, or on the result of an earlier
//! call, and one pulled result.
//!
//! A batch is newline-separated JSON messages. `["push", expression]`
//! assigns the next import id (from 1) to the expression's result, and
//! `["pull", id]` asks for that result, which comes back as
//! `["resolve", id, value]` or `["reject", id, ["error", name, message]]`.
//! A call is `["pipeline", target, [method], [args...]]`, where target 0 is
//! the main stub (the engine's gateway). In values, an array literal is
//! escaped by wrapping it in a second array; every other array is a special
//! form. The golden strings in the tests were captured from capnweb 0.4.0,
//! the version the engine serves.

use serde_json::{json, Value};

/// The main stub a session starts with: the engine's `ApiGateway`.
pub const MAIN_STUB: u64 = 0;

/// One call in a batch.
pub struct Call<'a> {
    /// [`MAIN_STUB`], or the import id of an earlier call in the same batch.
    pub target: u64,
    pub method: &'a str,
    pub args: Vec<Value>,
}

/// The request body for `calls`, pulling the last call's result. The calls
/// get import ids 1, 2, ... in order, so the pulled id is `calls.len()`.
pub fn batch_request(calls: &[Call<'_>]) -> String {
    assert!(!calls.is_empty(), "a batch needs at least one call");
    let mut lines: Vec<String> = calls
        .iter()
        .enumerate()
        .map(|(index, call)| {
            assert!(
                call.target <= index as u64,
                "call {} targets import {}, which does not exist yet",
                index + 1,
                call.target
            );
            let args: Vec<Value> = call.args.iter().map(escape).collect();
            json!(["push", ["pipeline", call.target, [call.method], args]]).to_string()
        })
        .collect();
    lines.push(json!(["pull", calls.len()]).to_string());
    lines.join("\n")
}

/// How the pulled call ended.
#[derive(Debug, Clone, PartialEq)]
pub enum BatchReply {
    /// The value as capnweb wrote it. [`decode_value`] reads it, and only a
    /// caller that uses the value needs to.
    Resolved(Value),
    /// The engine threw. `name` is the error's name (`RegistrationRefused`,
    /// or `Error`), `message` its message.
    Rejected { name: String, message: String },
    /// The engine ended the whole session (`["abort", error]`).
    Aborted { name: String, message: String },
}

/// What a reply that is not a capnweb batch reply looked like.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnreadableReply(pub &'static str);

/// Reads the answer to `pulled` from a batch response body. Messages about
/// other ids are skipped; an abort ends the reading, since no answer
/// follows it.
pub fn batch_reply(body: &str, pulled: u64) -> Result<BatchReply, UnreadableReply> {
    for line in body.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let message: Value =
            serde_json::from_str(line).map_err(|_| UnreadableReply("a message is not JSON"))?;
        let Some(parts) = message.as_array() else {
            return Err(UnreadableReply("a message is not an array"));
        };
        if parts.first().and_then(Value::as_str) == Some("abort") {
            let (name, message) = error_parts(parts.get(1))?;
            return Ok(BatchReply::Aborted { name, message });
        }
        let (Some(kind), Some(id)) = (
            parts.first().and_then(Value::as_str),
            parts.get(1).and_then(Value::as_u64),
        ) else {
            continue;
        };
        if id != pulled {
            continue;
        }
        let payload = parts
            .get(2)
            .ok_or(UnreadableReply("a result has no value"))?;
        return match kind {
            "resolve" => Ok(BatchReply::Resolved(payload.clone())),
            "reject" => {
                let (name, message) = error_parts(Some(payload))?;
                Ok(BatchReply::Rejected { name, message })
            }
            _ => Err(UnreadableReply(
                "the result is neither resolved nor rejected",
            )),
        };
    }
    Err(UnreadableReply("the reply has no result for the call"))
}

/// The name and message of an `["error", name, message, stack?]` value.
fn error_parts(value: Option<&Value>) -> Result<(String, String), UnreadableReply> {
    let parts = value
        .and_then(Value::as_array)
        .ok_or(UnreadableReply("an error is not an error expression"))?;
    match parts.as_slice() {
        [tag, Value::String(name), Value::String(message), ..] if tag == "error" => {
            Ok((name.clone(), message.clone()))
        }
        _ => Err(UnreadableReply("an error is not an error expression")),
    }
}

/// A plain JSON value as a capnweb expression.
fn escape(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(vec![Value::Array(items.iter().map(escape).collect())]),
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), escape(value)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// A capnweb value as plain JSON. Special forms (stubs, dates, bigints,
/// undefined) are refused, so only a value the host reads is decoded.
pub fn decode_value(value: &Value) -> Result<Value, UnreadableReply> {
    match value {
        Value::Array(outer) => match outer.as_slice() {
            [Value::Array(items)] => Ok(Value::Array(
                items.iter().map(decode_value).collect::<Result<_, _>>()?,
            )),
            _ => Err(UnreadableReply(
                "the value holds a form this host does not read",
            )),
        },
        Value::Object(fields) => Ok(Value::Object(
            fields
                .iter()
                .map(|(key, value)| Ok((key.clone(), decode_value(value)?)))
                .collect::<Result<_, UnreadableReply>>()?,
        )),
        other => Ok(other.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batch_request_matches_capnweb() {
        let cases: Vec<(&str, Vec<Call<'_>>, &str)> = vec![
            (
                "one call on the gateway",
                vec![Call {
                    target: MAIN_STUB,
                    method: "registerClient",
                    args: vec![json!("woofx3-desktop"), json!({ "registrationToken": "tok" })],
                }],
                "[\"push\",[\"pipeline\",0,[\"registerClient\"],[\"woofx3-desktop\",{\"registrationToken\":\"tok\"}]]]\n[\"pull\",1]",
            ),
            (
                "a call on an earlier call's result",
                vec![
                    Call {
                        target: MAIN_STUB,
                        method: "authenticate",
                        args: vec![json!("id"), json!("s3cret")],
                    },
                    Call {
                        target: 1,
                        method: "getEngineInfo",
                        args: vec![],
                    },
                ],
                "[\"push\",[\"pipeline\",0,[\"authenticate\"],[\"id\",\"s3cret\"]]]\n[\"push\",[\"pipeline\",1,[\"getEngineInfo\"],[]]]\n[\"pull\",2]",
            ),
            (
                "an array argument is escaped",
                vec![Call {
                    target: MAIN_STUB,
                    method: "m",
                    args: vec![json!({ "list": [1, [2]] })],
                }],
                "[\"push\",[\"pipeline\",0,[\"m\"],[{\"list\":[[1,[[2]]]]}]]]\n[\"pull\",1]",
            ),
        ];
        for (case, calls, expected) in cases {
            assert_eq!(batch_request(&calls), expected, "{case}");
        }
    }

    #[test]
    #[should_panic(expected = "does not exist yet")]
    fn test_batch_request_refuses_a_call_on_a_later_import() {
        batch_request(&[Call {
            target: 1,
            method: "m",
            args: vec![],
        }]);
    }

    #[test]
    fn test_batch_reply_reads_capnweb_replies() {
        let cases: Vec<(&str, &str, u64, BatchReply)> = vec![
            (
                "resolved",
                "[\"resolve\",1,{\"clientId\":\"id-1\",\"clientSecret\":\"s3cret\"}]",
                1,
                BatchReply::Resolved(json!({ "clientId": "id-1", "clientSecret": "s3cret" })),
            ),
            (
                "the value as written, escaped array and all",
                "[\"resolve\",2,{\"version\":\"dev\",\"list\":[[1,2]]}]",
                2,
                BatchReply::Resolved(json!({ "version": "dev", "list": [[1, 2]] })),
            ),
            (
                "a special form is left for the caller",
                "[\"resolve\",2,{\"hosting\":[\"undefined\"]}]",
                2,
                BatchReply::Resolved(json!({ "hosting": ["undefined"] })),
            ),
            (
                "an aborted session",
                "[\"abort\",[\"error\",\"Error\",\"the session broke\"]]",
                2,
                BatchReply::Aborted {
                    name: "Error".to_string(),
                    message: "the session broke".to_string(),
                },
            ),
            (
                "a refused registration",
                "[\"reject\",1,[\"error\",\"RegistrationRefused\",\"bad token\"]]",
                1,
                BatchReply::Rejected {
                    name: "RegistrationRefused".to_string(),
                    message: "bad token".to_string(),
                },
            ),
            (
                "a rejection with a stack",
                "[\"reject\",2,[\"error\",\"Error\",\"Invalid client credentials\",\"at x\"]]",
                2,
                BatchReply::Rejected {
                    name: "Error".to_string(),
                    message: "Invalid client credentials".to_string(),
                },
            ),
            (
                "other ids and blank lines are skipped",
                "[\"resolve\",1,\"first\"]\n\n[\"resolve\",2,\"second\"]\r\n",
                2,
                BatchReply::Resolved(json!("second")),
            ),
        ];
        for (case, body, pulled, expected) in cases {
            assert_eq!(batch_reply(body, pulled), Ok(expected), "{case}");
        }
    }

    #[test]
    fn test_batch_reply_refuses_what_is_not_a_reply() {
        let cases = [
            ("empty", "", 1),
            ("an HTML error page", "<html>502</html>", 1),
            ("not an array", "{\"resolve\":1}", 1),
            ("no result for the call", "[\"resolve\",1,\"x\"]", 2),
            ("no value", "[\"resolve\",1]", 1),
            ("unknown kind", "[\"abort\",1,\"x\"]", 1),
            (
                "rejection that is not an error",
                "[\"reject\",1,\"boom\"]",
                1,
            ),
            (
                "rejection without a name",
                "[\"reject\",1,[\"error\",null,\"boom\"]]",
                1,
            ),
            (
                "rejection without a message",
                "[\"reject\",1,[\"error\",\"Error\"]]",
                1,
            ),
            ("abort that is not an error", "[\"abort\",\"boom\"]", 1),
        ];
        for (case, body, pulled) in cases {
            assert!(batch_reply(body, pulled).is_err(), "{case}");
        }
    }

    #[test]
    fn test_decode_value_reads_plain_values_and_refuses_special_forms() {
        let plain = [
            (json!({ "list": [[1, [[2]]]] }), json!({ "list": [1, [2]] })),
            (json!("text"), json!("text")),
            (json!({ "n": 1, "ok": true }), json!({ "n": 1, "ok": true })),
        ];
        for (written, read) in plain {
            assert_eq!(decode_value(&written), Ok(read));
        }
        for special in [
            json!(["export", -1]),
            json!({ "at": ["date", 1] }),
            json!(["undefined"]),
        ] {
            assert!(decode_value(&special).is_err(), "{special}");
        }
    }
}
