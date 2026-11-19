import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { OrganizationInvitation } from "@convex/invitations";
import type { OrgMember } from "@convex/organizations";
import { useMutation, useQuery } from "convex/react";
import { ChevronDown, Plus, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { ConfirmDialog } from "@/billing/confirm-dialog";
import { formatDay, formatSeats } from "@/billing/format";
import { PageHeader } from "@/components/layout/page-header";
import { EmailVisibilityToggle, hasMemberEmails, MemberEmail } from "@/components/team/member-emails";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConvexUser } from "@/hooks/use-convex-auth";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { toast } from "@/hooks/use-toast";
import { actionErrorMessage } from "@/lib/action-error";
import { useOrganization } from "../organization-context";
import { ACCOUNT_PORTAL_PATH } from "../portal-pages";

export const TEAM_PATH = `${ACCOUNT_PORTAL_PATH}/team`;

type ChangeableRole = "admin" | "member";

const OTHER_ROLE: Record<ChangeableRole, ChangeableRole> = { admin: "member", member: "admin" };

async function run(action: () => Promise<unknown>, success: string) {
  try {
    await action();
    toast({ title: success });
  } catch (error) {
    toast({ title: "Failed", description: actionErrorMessage(error), variant: "destructive" });
  }
}

/** One engine a person is on, with its role; an organization member's access can be changed or taken away. */
function EngineAccess({
  member,
  engine,
  editable,
}: {
  member: OrgMember;
  engine: OrgMember["engines"][number];
  editable: boolean;
}) {
  const setRole = useMutation(api.engineMembers.setRole);
  const removeFromEngine = useMutation(api.engineMembers.remove);
  const label = (
    <>
      {engine.name}
      <span className="text-muted-foreground capitalize"> · {engine.role}</span>
    </>
  );
  if (!editable) {
    return (
      <Badge
        variant="secondary"
        className="font-normal"
        data-testid={`engine-access-${member.userId}-${engine.instanceId}`}
      >
        {label}
      </Badge>
    );
  }
  const other = OTHER_ROLE[engine.role as ChangeableRole];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 gap-1 font-normal"
          data-testid={`engine-access-${member.userId}-${engine.instanceId}`}
        >
          {label}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onClick={() =>
            run(
              () => setRole({ instanceId: engine.instanceId, targetUserId: member.userId, role: other }),
              "Role updated"
            )
          }
        >
          Make {other} on {engine.name}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() =>
            run(
              () => removeFromEngine({ instanceId: engine.instanceId, targetUserId: member.userId }),
              `Removed from ${engine.name}`
            )
          }
        >
          Remove from {engine.name}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AddToEngine({
  member,
  engines,
}: {
  member: OrgMember;
  engines: Array<{ instanceId: Id<"instances">; name: string }>;
}) {
  const addToEngine = useMutation(api.engineMembers.add);
  if (engines.length === 0) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1" data-testid={`button-add-engine-${member.userId}`}>
          <Plus className="h-3 w-3" />
          Add to engine
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {engines.map((engine) => (
          <DropdownMenuItem
            key={engine.instanceId}
            onClick={() =>
              run(
                () => addToEngine({ instanceId: engine.instanceId, targetUserId: member.userId, role: "member" }),
                `Added to ${engine.name}`
              )
            }
          >
            {engine.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MemberRow({ member, emailsShown, isMe }: { member: OrgMember; emailsShown: boolean; isMe: boolean }) {
  const { organization } = useOrganization();
  const updateRole = useMutation(api.accountMembers.updateMemberRole);
  const removeMember = useMutation(api.accountMembers.removeMember);
  // The owner's role never changes here, and nobody changes their own, so no one locks themselves out.
  const changeable = member.role !== "owner" && !isMe;
  // An organization admin has every engine as an admin, so only a plain member's access is picked engine by engine.
  const engineAccessChangeable = member.role === "member";
  const missing = organization.engines.filter(
    (engine) => !member.engines.some((on) => on.instanceId === engine.instanceId)
  );

  return (
    <li
      className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
      data-testid={`row-org-member-${member.userId}`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <Avatar>
          <AvatarImage src={member.image ?? undefined} />
          <AvatarFallback className="text-xs">{member.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 space-y-2">
          <div>
            <p className="font-medium truncate">{member.name}</p>
            <MemberEmail email={member.email} shown={emailsShown} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {member.engines.length === 0 ? <span className="text-sm text-muted-foreground">No engines</span> : null}
            {member.engines.map((engine) => (
              <EngineAccess key={engine.instanceId} member={member} engine={engine} editable={engineAccessChangeable} />
            ))}
            {engineAccessChangeable ? <AddToEngine member={member} engines={missing} /> : null}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {changeable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1 capitalize"
                data-testid={`select-org-role-${member.userId}`}
              >
                {member.role}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  run(
                    () =>
                      updateRole({
                        accountId: organization.accountId,
                        targetUserId: member.userId,
                        role: OTHER_ROLE[member.role as ChangeableRole],
                      }),
                    "Role updated"
                  )
                }
              >
                Make organization {OTHER_ROLE[member.role as ChangeableRole]}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Badge variant="outline" className="capitalize">
            {member.role}
          </Badge>
        )}
        {changeable ? (
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
  );
}

function invitationTarget(invitation: OrganizationInvitation): string {
  return invitation.platformDisplayName ?? invitation.platformLogin ?? invitation.email ?? "Invitation";
}

function PendingInvitations({ invitations }: { invitations: OrganizationInvitation[] }) {
  const revoke = useMutation(api.invitations.revoke);
  if (invitations.length === 0) {
    return null;
  }
  return (
    <Card data-testid="card-pending-invitations">
      <CardHeader>
        <CardTitle>Pending invitations</CardTitle>
        <CardDescription>They join the organization with access to the engine they were invited to.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {invitations.map((invitation) => (
            <li
              key={invitation._id}
              className="flex items-center justify-between gap-3 py-3"
              data-testid={`row-invitation-${invitation._id}`}
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{invitationTarget(invitation)}</p>
                <p className="text-sm text-muted-foreground capitalize">
                  {invitation.engineName} · {invitation.engineRole} · expires {formatDay(invitation.expiresAt)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => run(() => revoke({ invitationId: invitation._id }), "Invitation revoked")}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Everyone in the organization with the engines they can open and their role on each. Access is granted per engine:
 * an invitation names an engine, and accepting it makes the person a member of the organization with that engine only.
 */
export default function TeamPage() {
  const { organization } = useOrganization();
  const { user } = useConvexUser();
  const meId = user && "_id" in user ? (user as { _id: Id<"users"> })._id : null;
  const members = useQuery(api.organizations.members, { accountId: organization.accountId });
  const now = useMinuteClock();
  const invitations = useQuery(api.invitations.listForOrganization, { accountId: organization.accountId, now });
  const [emailsShown, setEmailsShown] = useState(false);
  const { seats } = organization;

  return (
    <>
      <PageHeader
        title="Team"
        description="Who can open which engine, and what they can do on it."
        actions={
          <div className="flex items-center gap-2">
            {members && hasMemberEmails(members) ? (
              <EmailVisibilityToggle shown={emailsShown} onShownChange={setEmailsShown} />
            ) : null}
            {organization.engines.length > 0 ? (
              <Button asChild data-testid="button-invite-member">
                <Link href={`${TEAM_PATH}/invite`}>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Invite to an engine
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Owners and admins have every engine. Members have the engines listed beside them.
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
                  <MemberRow
                    key={member.userId}
                    member={member}
                    emailsShown={emailsShown}
                    isMe={member.userId === meId}
                  />
                ))}
              </ul>
            )}
            {seats ? (
              <p className="text-right text-sm text-muted-foreground" data-testid="text-seats">
                {formatSeats(seats)}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <PendingInvitations invitations={invitations ?? []} />
      </div>
    </>
  );
}
