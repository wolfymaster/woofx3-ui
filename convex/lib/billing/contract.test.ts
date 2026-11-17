import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { BILLING_TYPES_SCRIPT, generateBillingTypes } from "../../../scripts/billing/generate";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

test("the pinned spec copy is the one contract.json names", () => {
  const { specSha256 } = JSON.parse(read("contract.json")) as { specSha256: string };
  const actual = createHash("sha256").update(read("openapi.billing.json")).digest("hex");
  expect(
    actual,
    "openapi.billing.json changed: update contract.json (sourceCommit, specSha256) and run `" +
      BILLING_TYPES_SCRIPT +
      "` in the same change"
  ).toBe(specSha256);
});

test("schema.generated.ts is what the pinned spec generates", async () => {
  expect(
    read("schema.generated.ts") === (await generateBillingTypes()),
    `schema.generated.ts is stale: run \`${BILLING_TYPES_SCRIPT}\` and commit the result`
  ).toBe(true);
});
