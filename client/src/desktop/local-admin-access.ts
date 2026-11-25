import type { AdminAccessSource } from "@/lib/admin-access";

/** The name backup files carry, since local mode's engine has no account-given name. */
const LOCAL_ENGINE_NAME = "woofx3";

/** Whoever runs the local engine owns it: everything is allowed, and there are no members to back up. */
export const localAdminAccess: AdminAccessSource = {
  useStorage: () => ({ canEdit: true, loaded: true, managed: false }),
  useBackup: () => ({
    engineName: LOCAL_ENGINE_NAME,
    canExport: true,
    canImport: true,
    supportsMembers: false,
    canExportMembers: false,
  }),
};
