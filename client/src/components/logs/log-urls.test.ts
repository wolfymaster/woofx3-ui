import { describe, expect, test } from "bun:test";
import { EMPTY_LOG_FILTER, logExportUrl, logStreamUrl } from "./log-urls";

const grant = { origin: "https://engine.example.com", token: "a.b", expiresAt: "2030-01-01T00:00:00.000Z" };

describe("log urls", () => {
  test("an empty filter carries only the token", () => {
    expect(logStreamUrl(grant, EMPTY_LOG_FILTER, null)).toBe("https://engine.example.com/logs/stream?token=a.b");
  });

  test("a filter becomes comma lists and an encoded search", () => {
    const url = new URL(logStreamUrl(grant, { levels: ["warn", "error"], services: ["api"], text: "a&b c" }, null));
    expect(url.searchParams.get("levels")).toBe("warn,error");
    expect(url.searchParams.get("services")).toBe("api");
    expect(url.searchParams.get("text")).toBe("a&b c");
  });

  test("a resume point is sent so a fresh connection continues where the last stopped", () => {
    const url = new URL(logStreamUrl(grant, EMPTY_LOG_FILTER, "api_1.log:42"));
    expect(url.searchParams.get("lastEventId")).toBe("api_1.log:42");
  });

  test("the export address names the export route", () => {
    expect(logExportUrl(grant)).toBe("https://engine.example.com/logs/export?token=a.b");
  });
});
