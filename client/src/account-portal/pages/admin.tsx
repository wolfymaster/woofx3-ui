import { lazy } from "react";
import { Redirect, useParams } from "wouter";
import { AdminOnly } from "@/components/layout/admin-only";
import { ADMIN_ITEMS } from "@/components/layout/nav-config";
import { ACCOUNT_PORTAL_PATH } from "../portal-pages";

const ADMIN_SECTIONS: Record<string, React.LazyExoticComponent<() => React.ReactElement | null>> = {
  engine: lazy(() => import("@/pages/admin/engine")),
  integrations: lazy(() => import("@/pages/admin/integrations")),
  storage: lazy(() => import("@/pages/admin/storage")),
  backup: lazy(() => import("@/pages/admin/backup")),
  appearance: lazy(() => import("@/pages/admin/appearance")),
};

export function adminHref(section: string): string {
  return `${ACCOUNT_PORTAL_PATH}/admin/${section}`;
}

/** `/account/admin` opens the first section, like `/admin` does in the dashboard. */
export default function AdminPage() {
  return <Redirect to={adminHref(ADMIN_ITEMS[0].id)} replace />;
}

export function AdminSectionPage() {
  const { section } = useParams<{ section: string }>();
  const Section = ADMIN_SECTIONS[section];
  if (Section === undefined) {
    return <p className="text-muted-foreground">There&apos;s no such admin page.</p>;
  }
  return (
    <AdminOnly>
      <Section />
    </AdminOnly>
  );
}
