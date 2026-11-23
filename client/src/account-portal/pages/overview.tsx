import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { Redirect, useSearch } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { parseCheckoutReturn } from "@/lib/checkout-return";
import { useOptionalOrganization } from "../organization-context";
import { PLANS_PATH } from "../portal-pages";
import { RenameDialog } from "../rename-dialog";
import { EngineList } from "./engine-list";
import { OrganizationDashboard } from "./organization-dashboard";

/**
 * The portal's home: a person's launchable engines in the personal scope, an organization's dashboard in its own. The payment provider returns checkouts here, so one that
 * lands on an organization's billing owner goes on to the Plans page, which reports how it ended.
 */
export default function OverviewPage() {
  const organization = useOptionalOrganization()?.organization ?? null;
  const rename = useMutation(api.organizations.rename);
  const search = useSearch();
  if (organization?.can.manageBilling && parseCheckoutReturn(search).kind !== "none") {
    return <Redirect to={`${PLANS_PATH}?${search}`} replace />;
  }
  return (
    <>
      <PageHeader
        title={organization?.name ?? "Overview"}
        description={organization === null ? "Every woofx3 you can open." : "How this account stands."}
        actions={
          organization?.can.renameOrganization ? (
            <RenameDialog
              title="Rename account"
              current={organization.name}
              onRename={(name) => rename({ accountId: organization.accountId, name })}
              testId="button-rename-organization"
            />
          ) : null
        }
      />
      {organization === null ? <EngineList /> : <OrganizationDashboard organization={organization} />}
    </>
  );
}
