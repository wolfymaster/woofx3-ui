/** The ops API's routes, under OPS_PATH_PREFIX. Ids are Convex ids or maintenance engine ids, never paths. */

export const OPS_PATH_PREFIX = "/api/ops/";

export type OpsRoute =
  | { method: "GET"; name: "users.list" }
  | { method: "GET"; name: "users.get"; userId: string }
  | { method: "GET"; name: "accounts.list" }
  | { method: "GET"; name: "accounts.get"; accountId: string }
  | { method: "GET"; name: "engines.list" }
  | { method: "GET"; name: "engines.capabilities" }
  | { method: "GET"; name: "engines.byMaintenanceId"; engineId: string }
  | { method: "GET"; name: "instances.health"; instanceId: string }
  | { method: "GET"; name: "audit.list" }
  | { method: "GET"; name: "plans.list" }
  | { method: "GET"; name: "notifications.list" }
  | { method: "POST"; name: "engines.act"; instanceId: string; action: EngineAction }
  | { method: "POST"; name: "notifications.create" }
  | { method: "POST"; name: "notifications.delete"; notificationId: string };

/** What an operator can do to a customer's managed engine, exactly as the customer could. */
export type EngineAction = "upgrade" | "retry" | "delete";

const ENGINE_ACTIONS: ReadonlySet<string> = new Set<EngineAction>(["upgrade", "retry", "delete"]);

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/** The route a request names, or null for one the API does not serve. */
export function matchOpsRoute(method: string, pathname: string): OpsRoute | null {
  if (!pathname.startsWith(OPS_PATH_PREFIX)) {
    return null;
  }
  const segments = pathname.slice(OPS_PATH_PREFIX.length).replace(/\/$/, "").split("/");
  if (!segments.every((segment) => SEGMENT.test(segment))) {
    return null;
  }
  const [first, second, third] = segments;
  if (method === "POST") {
    if (segments.length === 3 && first === "engines" && second && third && ENGINE_ACTIONS.has(third)) {
      return { method, name: "engines.act", instanceId: second, action: third as EngineAction };
    }
    if (segments.length === 1 && first === "notifications") {
      return { method, name: "notifications.create" };
    }
    if (segments.length === 3 && first === "notifications" && second && third === "delete") {
      return { method, name: "notifications.delete", notificationId: second };
    }
    return null;
  }
  if (method !== "GET") {
    return null;
  }
  switch (segments.length) {
    case 1:
      if (first === "users") {
        return { method, name: "users.list" };
      }
      if (first === "accounts") {
        return { method, name: "accounts.list" };
      }
      if (first === "engines") {
        return { method, name: "engines.list" };
      }
      if (first === "audit") {
        return { method, name: "audit.list" };
      }
      if (first === "plans") {
        return { method, name: "plans.list" };
      }
      if (first === "notifications") {
        return { method, name: "notifications.list" };
      }
      return null;
    case 2:
      if (first === "engines" && second === "capabilities") {
        return { method, name: "engines.capabilities" };
      }
      if (first === "users" && second) {
        return { method, name: "users.get", userId: second };
      }
      if (first === "accounts" && second) {
        return { method, name: "accounts.get", accountId: second };
      }
      return null;
    case 3:
      if (first === "engines" && second === "by-maintenance-id" && third) {
        return { method, name: "engines.byMaintenanceId", engineId: third };
      }
      if (first === "instances" && second && third === "health") {
        return { method, name: "instances.health", instanceId: second };
      }
      return null;
    default:
      return null;
  }
}
