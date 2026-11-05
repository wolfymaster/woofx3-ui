import { describe, expect, test } from "bun:test";
import { touchesDesktop } from "./desktop-commits.mjs";

describe("touchesDesktop", () => {
  const cases = [
    { name: "the companion", files: ["companion/src-tauri/src/lib.rs"], expected: true },
    { name: "the bundled engine pin", files: ["companion/bundled-engine.json"], expected: true },
    { name: "the dashboard", files: ["client/src/pages/dashboard.tsx"], expected: true },
    { name: "shared code", files: ["shared/twitch-pins.ts"], expected: true },
    { name: "a root build file", files: ["vite.config.ts"], expected: true },
    { name: "the dependencies", files: ["package.json", "bun.lockb"], expected: true },
    { name: "Convex alone", files: ["convex/http.ts", "convex/lib/engineEvents/dispatch.ts"], expected: false },
    { name: "docs and CI alone", files: ["docs/ops/woofx3-releases.md", ".github/workflows/ci.yml"], expected: false },
    { name: "the changelog alone", files: ["companion/CHANGELOG.md"], expected: false },
    { name: "Convex and the dashboard", files: ["convex/http.ts", "client/src/App.tsx"], expected: true },
    { name: "a file named like a directory", files: ["clientele.ts"], expected: false },
    { name: "a root file in a subdirectory", files: ["docs/package.json"], expected: false },
    { name: "nothing", files: [], expected: false },
  ];

  for (const { name, files, expected } of cases) {
    test(name, () => {
      expect(touchesDesktop(files)).toBe(expected);
    });
  }
});
