import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
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
        description={organization === null ? "Your woofx3 account." : "Your organization, its engines and its plan."}
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
        {selection !== null && selection.organizations.length > 1 ? (
          <nav aria-label="Your organizations" className="flex flex-wrap gap-2">
            {selection.organizations.map((org) => (
              <Button
                key={org.accountId}
                variant={org.accountId === organization?.accountId ? "secondary" : "outline"}
                aria-pressed={org.accountId === organization?.accountId}
                onClick={() => selection.select(org.accountId)}
                data-testid={`button-select-org-${org.accountId}`}
              >
                {org.name}
              </Button>
            ))}
          </nav>
        ) : null}
        <EngineList />
        {organization?.can.manageBilling ? <OrganizationPlan /> : null}
      </div>
    </>
  );
}
