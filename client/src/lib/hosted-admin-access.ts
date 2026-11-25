import { api } from "@convex/_generated/api";
// stylegate:ignore ANY-LAY-010 reason="roleSatisfies is the pure role ordering the client already imports from convex/lib (the storage form did before it moved here)"
import { roleSatisfies } from "@convex/lib/instanceRoles";
import { useQuery } from "convex/react";
import { useInstance } from "@/hooks/use-instance";
import type { AdminAccessSource } from "@/lib/admin-access";

/** The hosted app's answers, from the viewer's role on the current instance. */
export const hostedAdminAccess: AdminAccessSource = {
  useStorage: () => {
    const { instance } = useInstance();
    // Both storage settings change the engine for everyone on the instance, so the
    // server accepts them from an owner or admin only.
    const viewerRole = useQuery(api.instances.viewerRole, instance ? { instanceId: instance._id } : "skip");
    return {
      canEdit: roleSatisfies(viewerRole, "admin"),
      loaded: viewerRole !== undefined,
      managed: instance?.hosting === "managed",
    };
  },
  useBackup: () => {
    const { instance, isLoading } = useInstance();
    const access = useQuery(api.configBackup.access, instance ? { instanceId: instance._id } : "skip");
    if (isLoading || (instance && access === undefined)) {
      return undefined;
    }
    if (!instance || !access?.canExport) {
      return null;
    }
    return {
      engineName: instance.name,
      canExport: access.canExport,
      canImport: access.canImport,
      supportsMembers: true,
      canExportMembers: access.canExportMembers,
    };
  },
};
