import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OPS_CALLERS } from "./callers";
import { buildOpsOpenApi, OPS_ROUTES, type OpsRouteSpec, validateOpsRoutes } from "./contract";
import { OPS_OPENAPI_PATH, opsOpenApiText } from "./openapi";

const ROUTES = OPS_ROUTES as readonly OpsRouteSpec[];
const response = { response: ROUTES[0]?.response } as Pick<OpsRouteSpec, "response">;
const route = (overrides: Partial<OpsRouteSpec>): OpsRouteSpec => ({
  name: "a.b",
  method: "GET",
  path: "/api/ops/a",
  summary: "",
  ...response,
  ...overrides,
});

/** Routes no caller's scope names, on purpose. */
const ROUTES_IN_NO_SCOPE: readonly string[] = [];

describe("the published document", () => {
  test("openapi/ops.json is what the contract generates", () => {
    const committed = readFileSync(new URL(`../../../${OPS_OPENAPI_PATH}`, import.meta.url), "utf8");
    expect(
      committed === opsOpenApiText(buildOpsOpenApi()),
      `${OPS_OPENAPI_PATH} is stale: run \`bun run ops:openapi\` and commit the result`
    ).toBe(true);
  });

  test("has one operation per route, named by the route", () => {
    const document = buildOpsOpenApi() as { paths: Record<string, Record<string, { operationId: string }>> };
    const operations = Object.values(document.paths).flatMap((methods) => Object.values(methods));
    expect(operations.map((operation) => operation.operationId).sort()).toEqual(ROUTES.map((spec) => spec.name).sort());
  });

  test("never renders a nullable named schema as allOf", () => {
    expect(JSON.stringify(buildOpsOpenApi())).not.toContain("allOf");
  });

  test("is written with sorted keys and a trailing newline", () => {
    expect(opsOpenApiText({ b: 1, a: { d: 1, c: 2 } })).toBe(
      '{\n  "a": {\n    "c": 2,\n    "d": 1\n  },\n  "b": 1\n}\n'
    );
  });
});

describe("engines.act", () => {
  test("answers one of the three action results", () => {
    const act = ROUTES.find((spec) => spec.name === "engines.act");
    for (const result of [{ outcome: "started" }, { retried: "upgrade" }, { deprovisioning: true }]) {
      expect(act?.response.safeParse(result).success).toBe(true);
    }
    expect(act?.response.safeParse({ outcome: "exploded" }).success).toBe(false);
  });
});

describe("the route table", () => {
  test("is consistent", () => {
    expect(() => validateOpsRoutes(ROUTES)).not.toThrow();
  });

  test("refuses a broken table", () => {
    const broken: [string, OpsRouteSpec[]][] = [
      ["a repeated name", [route({}), route({ path: "/api/ops/b" })]],
      ["a repeated method and path", [route({}), route({ name: "c.d" })]],
      ["a path outside the prefix", [route({ path: "/elsewhere" })]],
      ["an unnamed parameter", [route({ path: "/api/ops/a/{}" })]],
      ["a repeated parameter", [route({ path: "/api/ops/{id}/{id}" })]],
      ["a schema for a parameter the path lacks", [route({ params: { nope: response.response } })]],
      ["no response schema", [route({ response: undefined as never })]],
    ];
    for (const [name, table] of broken) {
      expect({ name, throws: throws(() => validateOpsRoutes(table)) }).toEqual({ name, throws: true });
    }
  });
});

function throws(run: () => void): boolean {
  try {
    run();
    return false;
  } catch {
    return true;
  }
}

describe("caller scopes", () => {
  const names = new Set(ROUTES.map((spec) => spec.name));

  test("name only real routes", () => {
    for (const caller of OPS_CALLERS) {
      for (const scope of caller.scopes) {
        expect({ caller: caller.name, scope, real: names.has(scope) }).toEqual({
          caller: caller.name,
          scope,
          real: true,
        });
      }
    }
  });

  test("cover every route, unless it is deliberately in none", () => {
    const scoped = new Set(OPS_CALLERS.flatMap((caller) => [...caller.scopes]));
    const unscoped = [...names].filter((name) => !scoped.has(name));
    expect(unscoped.sort()).toEqual([...ROUTES_IN_NO_SCOPE].sort());
  });
});
