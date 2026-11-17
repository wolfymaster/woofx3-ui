import { describe, expect, test } from "bun:test";
import { parseHttpsUrl } from "./httpsUrl";

describe("parseHttpsUrl", () => {
  test.each([["https://checkout.stripe.com/c/pay/cs_test_1#frag"], ["https://billing.stripe.com/p/session/x?a=b"]])(
    "accepts %s",
    (input) => {
      expect(parseHttpsUrl(input)).toEqual({ ok: true, url: input });
    }
  );

  test.each([
    ["javascript:alert(1)"],
    ["data:text/html,<script>1</script>"],
    ["//evil.example/x"],
    ["/relative/path"],
    ["http://checkout.stripe.com/x"],
    ["http://localhost:3000/x"],
    ["https://user:pw@checkout.stripe.com/x"],
    ["https://user@checkout.stripe.com/x"],
    ["ftp://example.com/x"],
    [""],
    ["not a url"],
    [null],
    [undefined],
    [42],
    [{ url: "https://a.example" }],
  ])("rejects %p", (input) => {
    expect(parseHttpsUrl(input).ok).toBe(false);
  });
});
