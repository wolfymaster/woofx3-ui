import { describe, expect, test } from "bun:test";
import tauriConfig from "../../../companion/src-tauri/tauri.conf.json";

// Scene and alert previews frame a page the engine serves. The engine's address
// differs per deployment and the CSP is fixed at build time, so the app has to
// allow frames from any origin a gateway can reach: a hosted engine over HTTPS
// or the bundled engine on loopback. Remote frames hold no capability, so
// allowing them doesn't give them the app's commands.
const ENGINE_FRAME_SOURCES = ["https:", "http://127.0.0.1:*", "http://localhost:*"];

describe("the desktop app's CSP", () => {
  test.each([
    ["production", tauriConfig.app.security.csp],
    ["dev", tauriConfig.app.security.devCsp],
  ])("%s lets previews frame the engine", (_name, csp) => {
    expect(csp["frame-src"].split(" ")).toEqual(expect.arrayContaining(ENGINE_FRAME_SOURCES));
  });

  test.each([
    ["production", tauriConfig.app.security.csp],
    ["dev", tauriConfig.app.security.devCsp],
  ])("%s keeps scripts to the bundle", (_name, csp) => {
    expect(csp["script-src"]).not.toContain("https:");
  });
});
