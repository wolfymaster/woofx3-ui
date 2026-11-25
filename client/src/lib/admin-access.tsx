import { createContext, type ReactNode, useContext } from "react";

// What the signed-in viewer may do on the engine's admin pages in one mode of
// the app. The hosted app derives it from the viewer's role on the instance in
// Convex; local mode has no account, and whoever runs the engine owns it. Each
// app root mounts its source.

export interface StorageAccess {
  /** False while the role loads, which keeps the form read-only rather than flashing editable. */
  canEdit: boolean;
  /** Whether the role has loaded, so the read-only notice is not shown for a role still on its way. */
  loaded: boolean;
  /** A managed engine has no storage settings of its own. */
  managed: boolean;
}

export interface BackupAccess {
  engineName: string;
  canExport: boolean;
  canImport: boolean;
  /** Whether the engine's backups carry group members at all; local mode has none to carry. */
  supportsMembers: boolean;
  canExportMembers: boolean;
}

export interface AdminAccessSource {
  useStorage: () => StorageAccess;
  /** Undefined while loading; null when there is no engine the viewer may back up. */
  useBackup: () => BackupAccess | null | undefined;
}

const AdminAccessContext = createContext<AdminAccessSource | null>(null);

export function AdminAccessProvider({ source, children }: { source: AdminAccessSource; children: ReactNode }) {
  return <AdminAccessContext.Provider value={source}>{children}</AdminAccessContext.Provider>;
}

function useAdminAccessSource(): AdminAccessSource {
  const source = useContext(AdminAccessContext);
  if (source === null) {
    throw new Error("The admin pages need an AdminAccessProvider above them");
  }
  return source;
}

export function useStorageAccess(): StorageAccess {
  return useAdminAccessSource().useStorage();
}

export function useBackupAccess(): BackupAccess | null | undefined {
  return useAdminAccessSource().useBackup();
}
