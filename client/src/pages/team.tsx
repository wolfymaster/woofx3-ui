import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { TeamMemberDto } from "@convex/lib/teamAccess";
import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight, Crown, Mail, MoreHorizontal, Search, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConvexUser } from "@/hooks/use-convex-auth";
import { useInstance } from "@/hooks/use-instance";
import { toast } from "@/hooks/use-toast";
import { useBillingUi } from "@/lib/feature-source";
import { cn } from "@/lib/utils";

const roleColors: Record<string, string> = {
  owner: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  admin: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  member: "bg-green-500/10 text-green-600 dark:text-green-400",
};

const roleIcons: Record<string, React.ReactNode> = {
  owner: <Crown className="h-3 w-3 mr-1" />,
  admin: <Shield className="h-3 w-3 mr-1" />,
  member: <Users className="h-3 w-3 mr-1" />,
};

const ORG_PORTAL_PATH = "/org";

/** Engine roles follow the org role for its owner and admins, so only a plain org member's can change here. */
function engineRoleIsChangeable(member: TeamMemberDto): boolean {
  return member.orgRole !== "owner" && member.orgRole !== "admin";
}

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge variant="outline" className={cn("capitalize", roleColors[role])}>
      {roleIcons[role]}
      {role}
    </Badge>
  );
}

export default function Team() {
  const { instance } = useInstance();
  const { user } = useConvexUser();
  const { visible: hostedWebApp } = useBillingUi();
  const meId = user && "_id" in user ? (user as { _id: Id<"users"> })._id : null;
  const instanceId = instance?._id;

  const teamData = useQuery(api.engineMembers.listForEngine, instanceId ? { instanceId } : "skip");
  const inviteData = useQuery(api.invitations.listForEngine, instanceId ? { instanceId } : "skip");

  const revokeInvite = useMutation(api.invitations.revoke);
  const removeMember = useMutation(api.engineMembers.remove);
  const setMemberRole = useMutation(api.engineMembers.setRole);

  const [searchQuery, setSearchQuery] = useState("");

  const members = teamData?.members ?? [];
  const canManage = teamData?.canManage ?? false;
  const pendingInvites = inviteData?.invitations ?? [];

  const filteredMembers = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return members.filter((m) => m.name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q));
  }, [members, searchQuery]);

  if (!instance || !instanceId) {
    return (
      <div className="p-6 lg:p-8 max-w-[1200px] mx-auto">
        <PageHeader title="Team" description="Select an engine to see who can use it." />
        <p className="text-sm text-muted-foreground mt-4">No engine available yet.</p>
      </div>
    );
  }

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toast({ title: success });
    } catch (e: unknown) {
      toast({
        title: "Failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  const manageOrganization =
    hostedWebApp && teamData?.canManageOrganization ? (
      <Button variant="outline" asChild data-testid="link-manage-organization">
        <Link href={ORG_PORTAL_PATH}>
          Manage organization
          <ArrowUpRight className="h-4 w-4 ml-2" />
        </Link>
      </Button>
    ) : null;

  return (
    <div className="p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader
        title="Team"
        description={`People who can open ${instance.name}, and what they can do on it.`}
        actions={manageOrganization}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                Members
                <Badge variant="secondary">{members.length + pendingInvites.length}</Badge>
              </CardTitle>
              <CardDescription data-testid="text-team-engine">Everyone with access to {instance.name}.</CardDescription>
            </div>
            {canManage ? (
              <Button asChild data-testid="button-invite-member">
                <Link href="/team/invite">
                  <UserPlus className="h-4 w-4 mr-2" />
                  Invite Member
                </Link>
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search members..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-members"
              />
            </div>
          </div>

          {teamData === undefined ? (
            <div className="text-center py-8 text-muted-foreground">Loading members...</div>
          ) : teamData === null ? (
            <div className="text-center py-8 text-muted-foreground">You don&apos;t have access to this engine.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  {canManage ? <TableHead className="w-10" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvites.map((inv) => (
                  <TableRow key={inv._id} data-testid={`row-invite-${inv._id}`}>
                    <TableCell>
                      <PendingInviteIdentity invite={inv} />
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={inv.engineRole ?? inv.role} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        invited
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => run(() => revokeInvite({ invitationId: inv._id }), "Invitation revoked")}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
                {filteredMembers.map((member) => {
                  const isSelf = meId !== null && member.userId === meId;
                  return (
                    <TableRow key={member.userId} className="hover-elevate" data-testid={`row-member-${member.userId}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarImage src={member.image ?? undefined} />
                            <AvatarFallback className="text-xs">
                              {member.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">
                              {member.name}
                              {isSelf ? " (you)" : ""}
                            </p>
                            <p className="text-sm text-muted-foreground">{member.email ?? "—"}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <RoleBadge role={member.engineRole} />
                          {engineRoleIsChangeable(member) ? null : (
                            <span className="text-xs text-muted-foreground">Organization {member.orgRole}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          active
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {member.createdAt === null ? "—" : new Date(member.createdAt).toLocaleDateString()}
                      </TableCell>
                      {canManage ? (
                        <TableCell>
                          {!isSelf && engineRoleIsChangeable(member) ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" aria-label={`Manage ${member.name}`}>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() =>
                                    run(
                                      () => setMemberRole({ instanceId, targetUserId: member.userId, role: "admin" }),
                                      "Role updated"
                                    )
                                  }
                                >
                                  Make admin
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    run(
                                      () => setMemberRole({ instanceId, targetUserId: member.userId, role: "member" }),
                                      "Role updated"
                                    )
                                  }
                                >
                                  Make member
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => {
                                    if (!window.confirm(`Remove ${member.name} from ${instance.name}?`)) {
                                      return;
                                    }
                                    void run(
                                      () => removeMember({ instanceId, targetUserId: member.userId }),
                                      "Member removed"
                                    );
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Remove from engine
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface PendingInvite {
  email?: string;
  platform?: "twitch";
  platformLogin?: string;
  platformDisplayName?: string;
  platformProfileImageUrl?: string;
}

/** Who a pending invite is for: the Twitch face and name it was created with, or the email. */
function PendingInviteIdentity({ invite }: { invite: PendingInvite }) {
  if (invite.platform === "twitch") {
    const name = invite.platformDisplayName ?? invite.platformLogin ?? "Twitch user";
    return (
      <div className="flex items-center gap-3">
        <Avatar>
          <AvatarImage src={invite.platformProfileImageUrl} alt="" />
          <AvatarFallback className="text-xs">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div>
          <p className="font-medium">{name}</p>
          <p className="text-sm text-muted-foreground">
            {invite.platformLogin ? `twitch.tv/${invite.platformLogin} · ` : ""}Invitation pending
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarFallback className="text-xs">
          <Mail className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <div>
        <p className="font-medium">{invite.email}</p>
        <p className="text-sm text-muted-foreground">Invitation pending</p>
      </div>
    </div>
  );
}
