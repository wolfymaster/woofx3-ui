import { describe, expect, test } from "bun:test";
import { create } from "react-test-renderer";
import { type PaymentRow, PaymentsTable } from "./payments-table";

const row = (id: string, url: string | null): PaymentRow => ({
  id,
  dateMs: Date.parse("2026-11-01T12:00:00Z"),
  amountCents: 25_000,
  status: "paid",
  url,
});

function render(rows: PaymentRow[], linkColumn?: string): string {
  return JSON.stringify(create(<PaymentsTable rows={rows} linkColumn={linkColumn} />).toJSON());
}

describe("PaymentsTable", () => {
  test("is not a table that can scroll sideways", () => {
    const shown = render([row("a", null)]);
    expect(shown).not.toContain('"type":"table"');
    expect(shown).toContain("flex-col");
  });

  test("hides the link column when no payment has anything to open", () => {
    expect(render([row("a", null), row("b", null)], "Receipt")).not.toContain("Receipt");
  });

  test("shows the link column and its heading when a payment has a link", () => {
    const shown = render([row("a", null), row("b", "https://r.example/1")], "Receipt");
    expect(shown).toContain("Receipt");
    expect(shown).toContain("https://r.example/1");
  });

  test("says so when there are no rows", () => {
    expect(JSON.stringify(create(<PaymentsTable rows={[]} empty="No payments yet." />).toJSON())).toContain(
      "No payments yet."
    );
  });
});

describe("PaymentsTable links", () => {
  test("renders no link for a URL that is not https", () => {
    const shown = render([row("a", "https://r.example/1"), row("b", "javascript:alert(1)")], "Receipt");
    expect(shown).toContain("https://r.example/1");
    expect(shown).not.toContain("javascript:");
  });
});
