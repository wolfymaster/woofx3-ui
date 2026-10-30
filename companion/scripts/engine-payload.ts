// What the desktop installer bundles: one engine release for Windows, pinned
// by tag and checksum in bundled-engine.json, unpacked into src-tauri/engine.

/** The pinned engine release. */
export interface EnginePin {
  /** The engine's release tag, such as `v0.51.0`. */
  version: string;
  /** Hex sha256 of the release's Windows zip. */
  sha256: string;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const TAG = /^v\d+\.\d+\.\d+$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function parseEnginePin(raw: unknown): Checked<EnginePin> {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "bundled-engine.json must be an object" };
  }
  const { version, sha256 } = raw as Record<string, unknown>;
  if (typeof version !== "string" || !TAG.test(version)) {
    return { ok: false, error: `version must be an engine release tag like v1.2.3, got ${JSON.stringify(version)}` };
  }
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) {
    return { ok: false, error: "sha256 must be 64 lowercase hex characters" };
  }
  return { ok: true, value: { version, sha256 } };
}

/** The release asset; its name must match the engine's release workflow. */
export function engineZipUrl(pin: EnginePin): string {
  const asset = `woofx3-${pin.version}-windows-amd64.zip`;
  return `https://github.com/wolfymaster/woofx3/releases/download/${pin.version}/${asset}`;
}

/**
 * The zip's entries relative to its single top-level directory, the layout
 * the shell expects under `engine/`. Refuses any other layout, and any path
 * that could land outside the target directory.
 */
export function unwrapRelease(entries: Record<string, Uint8Array>): Checked<Map<string, Uint8Array>> {
  const roots = new Set(Object.keys(entries).map((path) => path.split("/")[0]));
  if (roots.size !== 1) {
    return { ok: false, error: `expected one top-level directory, found ${[...roots].join(", ")}` };
  }
  const files = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(entries)) {
    const relative = path.split("/").slice(1).join("/");
    if (relative === "" || relative.endsWith("/")) {
      continue;
    }
    if (relative.split("/").some((part) => part === ".." || part === "") || /^[a-zA-Z]:|^\\/.test(relative)) {
      return { ok: false, error: `refusing unsafe path ${JSON.stringify(path)}` };
    }
    files.set(relative, bytes);
  }
  return { ok: true, value: files };
}

/**
 * What the shell relies on in a release: it runs `orchestrator.exe`, and
 * only the orchestrator's run-once `migrate` step brings the database up to
 * date, so a release without it would never become ready.
 */
export function payloadProblems(files: ReadonlyMap<string, Uint8Array>): string[] {
  const problems: string[] = [];
  if (!files.has("orchestrator.exe")) {
    problems.push("orchestrator.exe is missing");
  }
  const servicesJson = files.get("services.json");
  if (servicesJson === undefined) {
    problems.push("services.json is missing");
    return problems;
  }
  let services: unknown;
  try {
    services = (JSON.parse(new TextDecoder().decode(servicesJson)) as { services?: unknown }).services;
  } catch (error) {
    problems.push(`services.json is not JSON: ${error instanceof Error ? error.message : String(error)}`);
    return problems;
  }
  const migrate = Array.isArray(services)
    ? services.find((service) => service && typeof service === "object" && service.name === "migrate")
    : undefined;
  if (!migrate || migrate.run_once !== true) {
    problems.push("services.json has no run-once migrate step; the engine release is older than local mode needs");
  }
  return problems;
}
