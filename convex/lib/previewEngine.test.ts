import { describe, expect, it } from "bun:test";
import { previewEngine, previewEngineRegistrationToken } from "./previewEngine";

const env = {
  PREVIEW_ENGINE_URL: "https://v0-3-1.woofx3.com",
  PREVIEW_ENGINE_VERSION: "v0.3.1",
  PREVIEW_ENGINE_REGISTRATION_TOKEN: "token-1",
};

describe("previewEngine", () => {
  it("is null outside a paired preview deployment", () => {
    expect(previewEngine({})).toBeNull();
  });

  it("reports where the paired engine is and which release it runs", () => {
    expect(previewEngine(env)).toEqual({ url: "https://v0-3-1.woofx3.com", version: "v0.3.1" });
  });
});

describe("previewEngineRegistrationToken", () => {
  it("is given for the paired engine however its URL is written", () => {
    expect(previewEngineRegistrationToken("https://v0-3-1.woofx3.com", env)).toBe("token-1");
    expect(previewEngineRegistrationToken(" https://v0-3-1.woofx3.com/api ", env)).toBe("token-1");
  });

  it("is never given for another engine", () => {
    expect(previewEngineRegistrationToken("https://evil.example.com", env)).toBeUndefined();
    expect(previewEngineRegistrationToken("v0-3-1.woofx3.com", env)).toBeUndefined();
    expect(previewEngineRegistrationToken("https://v0-3-1.woofx3.com", {})).toBeUndefined();
  });
});
