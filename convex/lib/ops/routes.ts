import { z } from "zod";
import { OPS_PATH_PREFIX, OPS_ROUTES, type OpsRoute, type OpsRouteSpec } from "./contract";

export { OPS_PATH_PREFIX };
export type { EngineAction, OpsRoute } from "./contract";

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const ID_SEGMENT_SCHEMA = z.string().regex(SEGMENT);

interface CompiledRoute {
  spec: OpsRouteSpec;
  /** Each path segment: a literal to equal, or the name of the parameter it carries. */
  segments: readonly ({ literal: string } | { param: string })[];
}

const COMPILED: readonly CompiledRoute[] = (OPS_ROUTES as readonly OpsRouteSpec[]).map((spec) => {
  return {
    spec,
    segments: spec.path
      .slice(OPS_PATH_PREFIX.length)
      .split("/")
      .map((segment) => {
        const param = /^\{(\w+)\}$/.exec(segment)?.[1];
        return param === undefined ? { literal: segment } : { param };
      }),
  };
});

/** The route a request names, or null for one the API does not serve. */
export function matchOpsRoute(method: string, pathname: string): OpsRoute | null {
  if (!pathname.startsWith(OPS_PATH_PREFIX)) {
    return null;
  }
  const requested = pathname.slice(OPS_PATH_PREFIX.length).replace(/\/$/, "").split("/");
  if (!requested.every((segment) => SEGMENT.test(segment))) {
    return null;
  }
  for (const { spec, segments } of COMPILED) {
    if (spec.method !== method || segments.length !== requested.length) {
      continue;
    }
    const params: Record<string, string> = {};
    const matches = segments.every((expected, index) => {
      const actual = requested[index] ?? "";
      if ("literal" in expected) {
        return expected.literal === actual;
      }
      if (!(spec.params?.[expected.param] ?? ID_SEGMENT_SCHEMA).safeParse(actual).success) {
        return false;
      }
      params[expected.param] = actual;
      return true;
    });
    if (matches) {
      return { method: spec.method, name: spec.name, ...params } as OpsRoute;
    }
  }
  return null;
}
