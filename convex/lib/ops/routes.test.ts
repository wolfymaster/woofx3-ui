import { describe, expect, it } from "bun:test";
import { matchOpsRoute } from "./routes";

describe("matchOpsRoute", () => {
  it("names each read route", () => {
    expect(matchOpsRoute("GET", "/api/ops/users")).toEqual({ method: "GET", name: "users.list" });
    expect(matchOpsRoute("GET", "/api/ops/users/abc123")).toEqual({
      method: "GET",
      name: "users.get",
      userId: "abc123",
    });
    expect(matchOpsRoute("GET", "/api/ops/accounts/")).toEqual({ method: "GET", name: "accounts.list" });
    expect(matchOpsRoute("GET", "/api/ops/accounts/k1")).toEqual({
      method: "GET",
      name: "accounts.get",
      accountId: "k1",
    });
    expect(matchOpsRoute("GET", "/api/ops/engines")).toEqual({ method: "GET", name: "engines.list" });
    expect(matchOpsRoute("GET", "/api/ops/engines/by-maintenance-id/0a1b2c3d-4e5f")).toEqual({
      method: "GET",
      name: "engines.byMaintenanceId",
      engineId: "0a1b2c3d-4e5f",
    });
    expect(matchOpsRoute("GET", "/api/ops/instances/i1/health")).toEqual({
      method: "GET",
      name: "instances.health",
      instanceId: "i1",
    });
    expect(matchOpsRoute("GET", "/api/ops/audit")).toEqual({ method: "GET", name: "audit.list" });
    expect(matchOpsRoute("GET", "/api/ops/plans")).toEqual({ method: "GET", name: "plans.list" });
    expect(matchOpsRoute("GET", "/api/ops/notifications")).toEqual({ method: "GET", name: "notifications.list" });
  });

  it("names each notification write", () => {
    expect(matchOpsRoute("POST", "/api/ops/notifications")).toEqual({ method: "POST", name: "notifications.create" });
    expect(matchOpsRoute("POST", "/api/ops/notifications/n1/delete")).toEqual({
      method: "POST",
      name: "notifications.delete",
      notificationId: "n1",
    });
    expect(matchOpsRoute("GET", "/api/ops/notifications/n1/delete")).toBeNull();
    expect(matchOpsRoute("POST", "/api/ops/notifications/n1")).toBeNull();
  });

  it("names each engine action", () => {
    for (const action of ["upgrade", "retry", "delete"]) {
      expect(matchOpsRoute("POST", `/api/ops/engines/i1/${action}`)).toEqual({
        method: "POST",
        name: "engines.act",
        instanceId: "i1",
        action,
      });
    }
    expect(matchOpsRoute("POST", "/api/ops/engines/i1/deprovision")).toBeNull();
    expect(matchOpsRoute("GET", "/api/ops/engines/i1/upgrade")).toBeNull();
  });

  it("serves nothing else", () => {
    expect(matchOpsRoute("POST", "/api/ops/users")).toBeNull();
    expect(matchOpsRoute("GET", "/api/ops/")).toBeNull();
    expect(matchOpsRoute("GET", "/api/ops/users/a/b")).toBeNull();
    expect(matchOpsRoute("GET", "/api/ops/users/..%2f")).toBeNull();
    expect(matchOpsRoute("GET", "/api/opsx/users")).toBeNull();
  });
});
