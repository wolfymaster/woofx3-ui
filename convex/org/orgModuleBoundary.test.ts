import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// The org module owns who is in an org (`accountMembers`) and what its billing
// projection says (`orgBilling`). Everything outside `convex/org/` goes
// through `org/membership.ts`, `org/billing.ts` and `org/context.ts`, so a
// rule about either table has one place to live. This test holds that: no
// other file queries or inserts into them, except the files below.

const CONVEX_DIR = join(import.meta.dir, "..");
const ORG_DIR = import.meta.dir;
const DIRECT_ACCESS = /\.(?:query|insert)\(\s*["'](accountMembers|orgBilling)["']/g;

/**
 * Files that still touch the tables directly, each with why it cannot go
 * through the module yet. Every entry must still need its exception: the test
 * fails when one no longer touches the table, so the list only shrinks.
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  // A migration repairs rows that break the module's invariants (stray owner
  // rows, missing memberships), so it must read and write them raw rather
  // than through helpers that assume the invariants hold.
  "migrations/organizations.ts": ["accountMembers"],
  // The operator read model for the backoffice: capped reads (MEMBER_CAP)
  // shaped into the ops API's DTOs. They move when the ops reads are rebuilt
  // on the org module's read helpers.
  "ops/reads.ts": ["accountMembers"],
  // The plane's projection push is the one writer of the row; org/billing.ts
  // is its one reader. The write stays with the idempotency and audit it is
  // part of.
  "ops/billingProjection.ts": ["orgBilling"],
};

/** Test files and their fixtures seed rows directly, as tests of any table do. */
function isTestSupport(file: string): boolean {
  return /\.(?:test|testing|fixtures)\.tsx?$/.test(file);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "_generated" || path === ORG_DIR ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !isTestSupport(entry.name) ? [path] : [];
  });
}

function directAccess(): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const file of sourceFiles(CONVEX_DIR)) {
    const tables = [...readFileSync(file, "utf8").matchAll(DIRECT_ACCESS)].map((match) => match[1] as string);
    if (tables.length > 0) {
      found[relative(CONVEX_DIR, file)] = [...new Set(tables)].sort();
    }
  }
  return found;
}

describe("org module boundary", () => {
  test("only the org module and the allowed files touch accountMembers and orgBilling", () => {
    expect(directAccess()).toEqual(ALLOWED);
  });

  test("the scan sees a direct access", () => {
    expect([...'ctx.db\n  .query(\n    "accountMembers")'.matchAll(DIRECT_ACCESS)].map((m) => m[1])).toEqual([
      "accountMembers",
    ]);
    expect([...'ctx.db.insert("orgBilling", row)'.matchAll(DIRECT_ACCESS)].map((m) => m[1])).toEqual(["orgBilling"]);
  });
});
