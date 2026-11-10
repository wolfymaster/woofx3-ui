import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The desktop app's CSP is `script-src 'self'`, so Monaco has to come from the
// bundle. Only `@/lib/monaco` may reach the editor package: it points the
// loader at the bundled `monaco-editor`, where any other import of
// `@monaco-editor/react` would fall back to the loader's CDN script.

const CLIENT_SRC = join(import.meta.dir, "..");
const SHARED_MODULE = join("lib", "monaco.ts");
const EDITOR_PAGES = [join("components", "modules", "module-file-viewer.tsx"), join("pages", "module-install.tsx")];

/** `monaco-editor` matches both the npm packages and a CDN path such as `npm/monaco-editor@x/min/vs`. */
const MONACO_REFERENCE = /monaco-editor/;

function sourceFiles(): string[] {
  return readdirSync(CLIENT_SRC, { recursive: true, encoding: "utf8" }).filter(
    (path) => /\.(ts|tsx)$/.test(path) && !path.includes(".test.")
  );
}

describe("Monaco loading", () => {
  test("only the shared module references the editor packages or a CDN copy", () => {
    const offenders = sourceFiles().filter(
      (path) => path !== SHARED_MODULE && MONACO_REFERENCE.test(readFileSync(join(CLIENT_SRC, path), "utf8"))
    );
    expect(offenders).toEqual([]);
  });

  test("the shared module hands the loader the bundled editor", () => {
    const source = readFileSync(join(CLIENT_SRC, SHARED_MODULE), "utf8");
    expect(source).toContain('import * as monaco from "monaco-editor"');
    expect(source).toContain("loader.config({ monaco })");
  });

  test.each(EDITOR_PAGES)("%s takes the editor from the shared module", (path) => {
    expect(readFileSync(join(CLIENT_SRC, path), "utf8")).toContain('from "@/lib/monaco"');
  });
});
