import { describe, expect, test } from "bun:test";
import { localAdminAccess } from "./local-admin-access";

describe("localAdminAccess", () => {
  test("lets the person running the engine edit its storage", () => {
    expect(localAdminAccess.useStorage()).toEqual({ canEdit: true, loaded: true, managed: false });
  });

  test("offers backups without group members", () => {
    const access = localAdminAccess.useBackup();
    expect(access).toMatchObject({ canExport: true, canImport: true, supportsMembers: false, canExportMembers: false });
  });
});
