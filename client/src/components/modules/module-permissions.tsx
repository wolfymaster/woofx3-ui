import { AlertTriangle, ShieldCheck } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { describePermissions } from "@/lib/module-permissions";

export function ModulePermissionList({ permissions }: { permissions: readonly string[] }) {
  return (
    <ul className="space-y-1.5">
      {describePermissions(permissions).map((permission) => (
        <li key={permission.id} className="flex items-start gap-2 text-sm">
          {permission.known ? (
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
          ) : (
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
          )}
          <span className={permission.known ? undefined : "text-amber-600 dark:text-amber-400"}>
            {permission.description}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What a module is allowed to do beyond the defaults, as its manifest declares.
 * `null` means the declaration could not be read, which is shown rather than
 * treated as "nothing", so an unreadable module never looks harmless.
 */
export function ModulePermissionsSection({ permissions }: { permissions: readonly string[] | null }) {
  return (
    <section className="rounded-md border p-3 space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">This module can:</h4>
      {permissions === null ? (
        <p className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          Could not read this module's permissions.
        </p>
      ) : permissions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing that needs your approval.</p>
      ) : (
        <ModulePermissionList permissions={permissions} />
      )}
    </section>
  );
}

export type PermissionApprovalMode = "install" | "update";

interface ApproveModulePermissionsDialogProps {
  open: boolean;
  mode: PermissionApprovalMode;
  moduleName: string;
  /** The permissions being approved: all of them for an install, only new ones for an update. */
  permissions: readonly string[];
  onApprove: () => void;
  onCancel: () => void;
}

/**
 * The confirmation step before installing or updating a module that asks for
 * permissions. It records the streamer's consent; the engine is what enforces
 * that the module can use only what it declared.
 */
export function ApproveModulePermissionsDialog({
  open,
  mode,
  moduleName,
  permissions,
  onApprove,
  onCancel,
}: ApproveModulePermissionsDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onCancel();
        }
      }}
    >
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {mode === "install" ? `Allow ${moduleName} to:` : `This update lets ${moduleName} also:`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {mode === "install"
              ? "The module can do these things whenever its workflows or functions run. You can remove the module later to take them away."
              : "The new version asks for permissions the installed version did not have. Update only if you trust it with them."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-md border p-3">
          <ModulePermissionList permissions={permissions} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onApprove}>
            {mode === "install" ? "Install and allow" : "Update and allow"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
