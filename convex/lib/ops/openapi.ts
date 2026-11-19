/** Where the generated document lives, relative to the repository root. */
export const OPS_OPENAPI_PATH = "openapi/ops.json";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, sortKeys(child)])
    );
  }
  return value;
}

/** The document as written to disk: keys sorted, so a regeneration changes only what the contract changed. */
export function opsOpenApiText(document: Record<string, unknown>): string {
  return `${JSON.stringify(sortKeys(document), null, 2)}\n`;
}
