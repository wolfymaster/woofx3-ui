import { describe, expect, test } from "bun:test";
import { engineZipUrl, parseEnginePin, payloadProblems, unwrapRelease } from "./engine-payload";

const SHA = "a".repeat(64);
const bytes = (text: string) => new TextEncoder().encode(text);
const services = (list: unknown[]) => bytes(JSON.stringify({ services: list }));

describe("parseEnginePin", () => {
  test.each([
    [{ version: "v0.51.0", sha256: SHA }, null],
    [{ version: "0.51.0", sha256: SHA }, "release tag"],
    [{ version: "latest", sha256: SHA }, "release tag"],
    [{ version: "v0.51.0", sha256: "ABC" }, "64 lowercase hex"],
    [{ version: "v0.51.0", sha256: "A".repeat(64) }, "64 lowercase hex"],
    [null, "must be an object"],
  ])("%j", (raw, error) => {
    const pin = parseEnginePin(raw);
    if (error === null) {
      expect(pin).toEqual({ ok: true, value: raw as never });
    } else {
      expect(pin.ok ? "" : pin.error).toContain(error);
    }
  });
});

test("engineZipUrl names the Windows asset of the pinned release", () => {
  expect(engineZipUrl({ version: "v0.51.0", sha256: SHA })).toBe(
    "https://github.com/wolfymaster/woofx3/releases/download/v0.51.0/woofx3-v0.51.0-windows-amd64.zip"
  );
});

describe("unwrapRelease", () => {
  test("drops the top-level directory and the directory entries", () => {
    const files = unwrapRelease({
      "windows-amd64/": new Uint8Array(),
      "windows-amd64/orchestrator.exe": bytes("o"),
      "windows-amd64/public/": new Uint8Array(),
      "windows-amd64/public/index.html": bytes("i"),
    });
    expect(files.ok && [...files.value.keys()]).toEqual(["orchestrator.exe", "public/index.html"]);
  });

  test("refuses more than one top-level entry", () => {
    const files = unwrapRelease({ "a/x": bytes(""), "b/y": bytes("") });
    expect(files.ok ? "" : files.error).toContain("one top-level directory");
  });

  test.each(["root/../escape.exe", "root/a//b", "root/C:/windows.exe"])("refuses %s", (path) => {
    const files = unwrapRelease({ [path]: bytes("") });
    expect(files.ok ? "" : files.error).toContain("unsafe path");
  });
});

describe("payloadProblems", () => {
  const migrate = { name: "migrate", run_once: true };

  test("a release with the orchestrator and a run-once migrate step is fine", () => {
    const files = new Map([
      ["orchestrator.exe", bytes("")],
      ["services.json", services([{ name: "api" }, migrate])],
    ]);
    expect(payloadProblems(files)).toEqual([]);
  });

  test("a release whose migrate is only a tool is refused", () => {
    const files = new Map([
      ["orchestrator.exe", bytes("")],
      ["services.json", bytes(JSON.stringify({ services: [{ name: "api" }], tools: [{ name: "migrate" }] }))],
    ]);
    expect(payloadProblems(files)).toEqual([expect.stringContaining("no run-once migrate step")]);
  });

  test("names everything missing", () => {
    expect(payloadProblems(new Map())).toEqual(["orchestrator.exe is missing", "services.json is missing"]);
    expect(payloadProblems(new Map([["services.json", bytes("{")]]))).toEqual([
      "orchestrator.exe is missing",
      expect.stringContaining("services.json is not JSON"),
    ]);
  });
});
