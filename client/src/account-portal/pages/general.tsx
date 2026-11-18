import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrganization } from "../organization-context";
import { RenameDialog } from "../rename-dialog";

/** The organization's own details. Only the owner may rename it. */
export default function GeneralPage() {
  const { organization } = useOrganization();
  const rename = useMutation(api.organizations.rename);
  return (
    <>
      <PageHeader title="General" description="This organization's details." />
      <Card>
        <CardHeader>
          <CardTitle>Name</CardTitle>
          <CardDescription>How this organization is listed to you and the people you invite.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <span className="font-medium" data-testid="text-organization-name">
            {organization.name}
          </span>
          {organization.can.renameOrganization ? (
            <RenameDialog
              title="Rename organization"
              current={organization.name}
              onRename={(name) => rename({ accountId: organization.accountId, name })}
              testId="button-rename-organization"
            />
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
