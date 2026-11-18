import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { OrgMember } from "@convex/organizations";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ConfirmDialog } from "@/billing/confirm-dialog";
import { formatSeats } from "@/billing/format";
import { PageHeader } from "@/components/layout/page-header";
import { EmailVisibilityToggle, hasMemberEmails, MemberEmail } from "@/components/team/member-emails";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConvexUser } from "@/hooks/use-convex-auth";
import { toast } from "@/hooks/use-toast";
import { actionErrorMessage } from "@/lib/action-error";
import { useOrganization } from "../organization-context";

type ChangeableRole = "admin" | "member";

/** The organization's members and their roles; the organization-level half of the portal's Team page. */
export function TeamMembers() {
  const { organization } = useOrganization();
  const { user } = useConvexUser();
  const meId = user && "_id" in user ? (user as { _id: Id<"users"> })._id : null;
  const members = useQuery(api.organizations.members, { accountId: organization.accountId });
  const updateRole = useMutation(api.accountMembers.updateMemberRole);
  const removeMember = useMutation(api.accountMembers.removeMember);
  const { seats } = organization;
  const [emailsShown, setEmailsShown] = useState(false);

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toast({ title: success });
    } catch (error) {
      toast({ title: "Failed", description: actionErrorMessage(error), variant: "destructive" });
    }
  }

  // The owner's role never changes here, and nobody changes their own, so no one locks themselves out.
  const changeable = (member: OrgMember) => member.role !== "owner" && member.userId !== meId;

  return (
    <>
      <PageHeader
        title="Team"
        description="Who's in this organization and what they can do."
        actions={
          members && hasMemberEmails(members) ? (
            <EmailVisibilityToggle shown={emailsShown} onShownChange={setEmailsShown} />
          ) : null
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Admins manage members and engines. Members use the engines they&apos;re invited to.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {members === undefined ? (
            <p className="text-sm text-muted-foreground">Loading members...</p>
          ) : members === null ? (
            <p className="text-sm text-muted-foreground">
              Your role in this organization doesn&apos;t include its member list.
            </p>
          ) : (
            <ul className="divide-y">
              {members.map((member) => (
                <li
                  key={member.userId}
                  className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  data-testid={`row-org-member-${member.userId}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar>
                      <AvatarImage src={member.image ?? undefined} />
                      <AvatarFallback className="text-xs">{member.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{member.name}</p>
                      <MemberEmail email={member.email} shown={emailsShown} />
                      <p className="text-sm text-muted-foreground">
                        {member.engines.length === 0
                          ? "No engines"
                          : member.engines.map((engine) => `${engine.name} (${engine.role})`).join(", ")}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {changeable(member) ? (
                      <Select
                        value={member.role}
                        onValueChange={(role) =>
                          run(
                            () =>
                              updateRole({
                                accountId: organization.accountId,
                                targetUserId: member.userId,
                                role: role as ChangeableRole,
                              }),
                            "Role updated"
                          )
                        }
                      >
                        <SelectTrigger className="w-32" data-testid={`select-org-role-${member.userId}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="member">Member</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="capitalize text-sm">{member.role}</span>
                    )}
                    {changeable(member) ? (
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" size="sm" className="text-destructive">
                            Remove
                          </Button>
                        }
                        title={`Remove ${member.name}?`}
                        description={`They lose access to ${organization.name} and all its engines.`}
                        confirmLabel="Remove"
                        destructive
                        testId={`button-remove-member-${member.userId}`}
                        onConfirm={() =>
                          run(
                            () => removeMember({ accountId: organization.accountId, targetUserId: member.userId }),
                            "Member removed"
                          )
                        }
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
            <span>Invite people from the Engine access view.</span>
            {seats ? <span data-testid="text-seats">{formatSeats(seats)}</span> : null}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
