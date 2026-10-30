import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";
import { engineZipUrl, parseEnginePin, payloadProblems, unwrapRelease } from "./engine-payload";

// Downloads the pinned engine release, checks it, and unpacks it where the
// desktop installer's bundle resources expect it. Run before
// `tauri build --features bundled-engine`.

const COMPANION_DIR = join(import.meta.dir, "..");
const PIN_FILE = join(COMPANION_DIR, "bundled-engine.json");
const TARGET_DIR = join(COMPANION_DIR, "src-tauri", "engine");
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

function fail(message: string): never {
  console.error(`fetch-engine: ${message}`);
  process.exit(1);
}

const pin = parseEnginePin(await Bun.file(PIN_FILE).json());
if (!pin.ok) {
  fail(pin.error);
}

const url = engineZipUrl(pin.value);
console.log(`fetch-engine: downloading ${url}`);
const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
if (!response.ok) {
  fail(`download failed with HTTP ${response.status}`);
}
const zip = new Uint8Array(await response.arrayBuffer());

const digest = new Bun.CryptoHasher("sha256").update(zip).digest("hex");
if (digest !== pin.value.sha256) {
  fail(`sha256 mismatch: bundled-engine.json pins ${pin.value.sha256}, the download is ${digest}`);
}

const files = unwrapRelease(unzipSync(zip));
if (!files.ok) {
  fail(files.error);
}
const problems = payloadProblems(files.value);
if (problems.length > 0) {
  fail(`engine ${pin.value.version} cannot be bundled:\n  ${problems.join("\n  ")}`);
}

await rm(TARGET_DIR, { recursive: true, force: true });
for (const [path, bytes] of files.value) {
  const target = join(TARGET_DIR, path);
  await Bun.write(target, bytes, { createPath: true });
}
console.log(
  `fetch-engine: unpacked ${files.value.size} files of engine ${pin.value.version} into ${dirname(TARGET_DIR)}/engine`
);
