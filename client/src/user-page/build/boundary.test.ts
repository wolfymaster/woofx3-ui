import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { userPageBoundaryViolation } from "./boundary";
import { DEFAULT_USER_PAGE_DEV_PORT, userPageDevPort } from "./dev-server";

const REPO = "/repo/woofx3-ui";

describe("userPageBoundaryViolation", () => {
  const cases: Array<{ id: string; allowed: boolean }> = [
    { id: join(REPO, "client/src/user-page/main.tsx"), allowed: true },
    { id: join(REPO, "client/src/user-page/index.html?html-proxy&index=0.css"), allowed: true },
    { id: join(REPO, "client/src/lib/resource-values.ts"), allowed: true },
    { id: join(REPO, "shared/user-pages/widgets.ts"), allowed: true },
    { id: join(REPO, "convex/_generated/api.js"), allowed: true },
    { id: join(REPO, "convex/lib/resourceKinds.ts"), allowed: true },
    { id: join(REPO, "node_modules/react-dom/client.js"), allowed: true },
    { id: join(REPO, "node_modules/convex/dist/esm/react/index.js"), allowed: true },
    { id: "\0vite/preload-helper.js", allowed: true },
    { id: join(REPO, "client/src/App.tsx"), allowed: false },
    { id: join(REPO, "client/src/lib/convexClient.ts"), allowed: false },
    { id: join(REPO, "client/src/engine/context.tsx"), allowed: false },
    { id: join(REPO, "client/src/lib/transport/index.ts"), allowed: false },
    { id: join(REPO, "client/src/components/layout/broadcast-shell.tsx"), allowed: false },
    { id: join(REPO, "client/src/lib/resource-values.test.ts"), allowed: false },
    { id: join(REPO, "client/src/user-pages-editor/editor.tsx"), allowed: false },
    { id: join(REPO, "convex/_generated/server.js"), allowed: false },
    { id: join(REPO, "convex/userPagesPublic.ts"), allowed: false },
    { id: join(REPO, "node_modules/@convex-dev/auth/dist/react/index.js"), allowed: false },
    { id: join(REPO, "node_modules/@tauri-apps/api/core.js"), allowed: false },
    { id: join(REPO, "node_modules/capnweb/dist/index.js"), allowed: false },
    { id: join(REPO, "node_modules/@tanstack/react-query/build/modern/index.js"), allowed: false },
    { id: "/repo/woofx3/shared/clients/typescript/api/index.ts", allowed: false },
    { id: "some-bare-id", allowed: false },
  ];

  for (const { id, allowed } of cases) {
    test(`${id.replace(REPO, "")} is ${allowed ? "allowed" : "refused"}`, () => {
      const violation = userPageBoundaryViolation(id, REPO);
      if (allowed) {
        expect(violation).toBeNull();
      } else {
        expect(violation).not.toBeNull();
      }
    });
  }

  test("a refused package is named by its package, scope included", () => {
    expect(userPageBoundaryViolation(join(REPO, "node_modules/@convex-dev/auth/dist/react/index.js"), REPO)).toBe(
      "the package @convex-dev/auth"
    );
  });
});

describe("userPageDevPort", () => {
  test("defaults when unset or blank", () => {
    expect(userPageDevPort({})).toBe(DEFAULT_USER_PAGE_DEV_PORT);
    expect(userPageDevPort({ WOOFX3_USER_PAGE_PORT: " " })).toBe(DEFAULT_USER_PAGE_DEV_PORT);
  });

  test("reads a port number", () => {
    expect(userPageDevPort({ WOOFX3_USER_PAGE_PORT: "22411" })).toBe(22411);
  });

  for (const value of ["abc", "0", "70000", "80.5"]) {
    test(`refuses "${value}"`, () => {
      expect(() => userPageDevPort({ WOOFX3_USER_PAGE_PORT: value })).toThrow("WOOFX3_USER_PAGE_PORT");
    });
  }
});
