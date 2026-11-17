import { describe, expect, test } from "bun:test";
import { validateExternalEngineUrl } from "./externalEngineUrl";

describe("validateExternalEngineUrl", () => {
  test.each([
    ["https://engine.example.com", "https://engine.example.com"],
    ["  https://engine.example.com:8443/api  ", "https://engine.example.com:8443/api"],
    ["https://8.8.8.8", "https://8.8.8.8"],
    ["https://172.32.0.1", "https://172.32.0.1"],
  ])("accepts %s", (input, stored) => {
    expect(validateExternalEngineUrl(input)).toBe(stored);
  });

  test.each([
    ["", "not a url"],
    ["engine.example.com", "no scheme"],
    ["localhost:8080", "no scheme"],
    ["http://engine.example.com", "plain http"],
    ["ftp://engine.example.com", "other scheme"],
    ["https://user:pw@engine.example.com", "embedded credentials"],
    ["https://localhost", "localhost"],
    ["https://app.localhost", "localhost suffix"],
    ["https://nas.local", "mDNS name"],
    ["https://db.internal", "internal name"],
    ["https://intranet", "single-label host"],
    ["https://127.0.0.1", "loopback"],
    ["https://0.0.0.0", "unspecified"],
    ["https://2130706433", "loopback as one integer"],
    ["https://0x7f.1", "loopback in hex"],
    ["https://10.1.2.3", "10/8"],
    ["https://172.16.0.1", "172.16/12"],
    ["https://172.31.255.255", "172.16/12 upper edge"],
    ["https://192.168.1.1", "192.168/16"],
    ["https://169.254.169.254", "link-local metadata address"],
    ["https://100.64.0.1", "carrier-grade NAT"],
    ["https://[::1]", "IPv6 loopback"],
    ["https://[fd00::1]", "IPv6 unique local"],
    ["https://[fe80::1]", "IPv6 link-local"],
    ["https://[::ffff:127.0.0.1]", "IPv4-mapped loopback"],
  ])("refuses %s (%s)", (input) => {
    expect(() => validateExternalEngineUrl(input)).toThrow();
    try {
      validateExternalEngineUrl(input);
    } catch (error) {
      expect(error).toMatchObject({ data: { code: "invalid_url" } });
    }
  });
});
