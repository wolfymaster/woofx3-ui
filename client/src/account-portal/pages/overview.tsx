import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { PageHeader } from "@/components/layout/page-header";
import { useOptionalOrganization } from "../organization-context";
import { RenameDialog } from "../rename-dialog";
import { EngineList } from "./engine-list";
import { OrganizationPlan } from "./plan-card";

/** The portal's home: the organizations the person is in, their engines, and the plan behind them. */
export default function OverviewPage() {
  const selection = useOptionalOrganization();
  const organization = selection?.organization ?? null;
  const rename = useMutation(api.organizations.rename);
  return (
    <>
      <PageHeader
        title={organization?.name ?? "Overview"}
        description={
          organization === null
            ? "Every engine you can open, and your own sponsorships."
            : "Your organization, its engines and its plan."
        }
        actions={
          organization?.can.renameOrganization ? (
            <RenameDialog
              title="Rename organization"
              current={organization.name}
              onRename={(name) => rename({ accountId: organization.accountId, name })}
              testId="button-rename-organization"
            />
          ) : null
        }
      />
      <div className="space-y-8">
        <EngineList />
        {organization?.can.manageBilling ? <OrganizationPlan /> : null}
      </div>
    </>
  );
}
