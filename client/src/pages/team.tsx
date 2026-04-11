import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Search,
  MoreHorizontal,
  Users,
  UserPlus,
  Shield,
  Crown,
  Mail,
  Trash2,
  Building2,
  Link as LinkIcon,
  Copy,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/utils";
import { useInstance } from "@/hooks/use-instance";
import { useConvexUser } from "@/hooks/use-convex-auth";
import { toast } from "@/hooks/use-toast";

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

export default function Team() {
  const { instance } = useInstance();
  const { user } = useConvexUser();
  const meId = user && "_id" in user ? (user as { _id: Id<"users"> })._id : null;

  const accountId = instance?.accountId;

  const teamData = useQuery(
    api.accountMembers.listForAccount,
    accountId ? { accountId } : "skip",
  );
  const accounts = useQuery(api.accounts.listAccessibleForUser);
  const inviteData = useQuery(api.invitations.listForAccount, accountId ? { accountId } : "skip");

  const createInvite = useMutation(api.invitations.create);
  const revokeInvite = useMutation(api.invitations.revoke);
  const removeMember = useMutation(api.accountMembers.removeMember);
  const updateMemberRole = useMutation(api.accountMembers.updateMemberRole);

  const [searchQuery, setSearchQuery] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  const members = teamData?.members ?? [];
  const canManage = teamData?.canManage ?? false;
  const pendingInvites = inviteData?.invitations ?? [];

  const filteredMembers = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q),
    );
  }, [members, searchQuery]);

  async function handleInvite() {
    if (!accountId || !inviteEmail.trim()) {
      return;
    }
    setInviteSubmitting(true);
    setInviteLink(null);
    try {
      const { token } = await createInvite({
        accountId,
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const url = `${origin}/auth/accept-invite?token=${encodeURIComponent(token)}`;
      setInviteLink(url);
      toast({ title: "Invitation created", description: "Share the link with your teammate." });
    } catch (e: unknown) {
      toast({
        title: "Could not invite",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setInviteSubmitting(false);
    }
  }

  function closeInviteDialog(open: boolean) {
    setIsInviting(open);
    if (!open) {
      setInviteEmail("");
      setInviteRole("member");
      setInviteLink(null);
    }
  }

  async function copyInviteLink() {
    if (!inviteLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast({ title: "Copied", description: "Invite link copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }

  if (!instance) {
    return (
      <div className="p-6 lg:p-8 max-w-[1200px] mx-auto">
        <PageHeader title="Team" description="Select an instance to manage team members." />
        <p className="text-sm text-muted-foreground mt-4">No instance available yet.</p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader
        title="Team"
        description="Members and accounts for the workspace tied to your selected instance."
      />

      <Tabs defaultValue="members" className="space-y-6">
        <TabsList>
          <TabsTrigger value="members" data-testid="tab-members">
            <Users className="h-4 w-4 mr-2" />
            Members
            <Badge variant="secondary" className="ml-2">
              {members.length + pendingInvites.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="accounts" data-testid="tab-accounts">
            <Building2 className="h-4 w-4 mr-2" />
            Accounts
            <Badge variant="secondary" className="ml-2">
              {accounts?.length ?? 0}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle>Team Members</CardTitle>
                  <CardDescription>
                    {teamData?.account.name ?? "Workspace"} — people with access to this account.
                  </CardDescription>
                </div>
                {canManage ? (
                  <Dialog open={isInviting} onOpenChange={closeInviteDialog}>
                    <DialogTrigger asChild>
                      <Button data-testid="button-invite-member">
                        <UserPlus className="h-4 w-4 mr-2" />
                        Invite Member
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Invite Team Member</DialogTitle>
                        <DialogDescription>
                          They must sign in with the same email you enter. We&apos;ll give you a link to share.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="invite-email">Email Address</Label>
                          <Input
                            id="invite-email"
                            type="email"
                            placeholder="colleague@example.com"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            data-testid="input-invite-email"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Role</Label>
                          <Select
                            value={inviteRole}
                            onValueChange={(v) => setInviteRole(v as "admin" | "member")}
                          >
                            <SelectTrigger data-testid="select-invite-role">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="member">Member</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            {inviteRole === "admin" && "Can manage team settings and members."}
                            {inviteRole === "member" && "Can use workflows, assets, and engine features for this account."}
                          </p>
                        </div>
                        {inviteLink ? (
                          <div className="space-y-2">
                            <Label>Invite link</Label>
                            <div className="flex gap-2">
                              <Input readOnly value={inviteLink} className="font-mono text-xs" />
                              <Button type="button" size="icon" variant="outline" onClick={copyInviteLink}>
                                <Copy className="h-4 w-4" />
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <LinkIcon className="h-3 w-3" />
                              Recipient opens this link while signed in with the invited email.
                            </p>
                          </div>
                        ) : null}
                      </div>
                      <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => closeInviteDialog(false)}>
                          {inviteLink ? "Done" : "Cancel"}
                        </Button>
                        {!inviteLink ? (
                          <Button
                            onClick={handleInvite}
                            disabled={!inviteEmail.trim() || inviteSubmitting}
                            data-testid="button-send-invite"
                          >
                            <Mail className="h-4 w-4 mr-2" />
                            Create invite
                          </Button>
                        ) : null}
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
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
                <div className="text-center py-8 text-muted-foreground">You don&apos;t have access to this account.</div>
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
                          <div>
                            <p className="font-medium">{inv.email}</p>
                            <p className="text-sm text-muted-foreground">Invitation pending</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("capitalize", roleColors[inv.role])}>
                            {roleIcons[inv.role]}
                            {inv.role}
                          </Badge>
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
                              onClick={async () => {
                                try {
                                  await revokeInvite({ invitationId: inv._id });
                                  toast({ title: "Invitation revoked" });
                                } catch (e: unknown) {
                                  toast({
                                    title: "Failed",
                                    description: e instanceof Error ? e.message : "Unknown error",
                                    variant: "destructive",
                                  });
                                }
                              }}
                            >
                              Revoke
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                    {filteredMembers.map((member) => {
                      const isSelf = meId !== null && member.userId === meId;
                      const ownerId = teamData?.account.ownerId;
                      const isAccountOwnerRow = ownerId !== undefined && member.userId === ownerId;

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
                            <Badge variant="outline" className={cn("capitalize", roleColors[member.role])}>
                              {roleIcons[member.role]}
                              {member.role}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="capitalize">
                              active
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(member.createdAt).toLocaleDateString()}
                          </TableCell>
                          {canManage ? (
                            <TableCell>
                              {!isSelf && !isAccountOwnerRow ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon">
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        try {
                                          await updateMemberRole({
                                            accountId: accountId!,
                                            targetUserId: member.userId,
                                            role: "admin",
                                          });
                                          toast({ title: "Role updated" });
                                        } catch (e: unknown) {
                                          toast({
                                            title: "Failed",
                                            description: e instanceof Error ? e.message : "Unknown error",
                                            variant: "destructive",
                                          });
                                        }
                                      }}
                                    >
                                      Make admin
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        try {
                                          await updateMemberRole({
                                            accountId: accountId!,
                                            targetUserId: member.userId,
                                            role: "member",
                                          });
                                          toast({ title: "Role updated" });
                                        } catch (e: unknown) {
                                          toast({
                                            title: "Failed",
                                            description: e instanceof Error ? e.message : "Unknown error",
                                            variant: "destructive",
                                          });
                                        }
                                      }}
                                    >
                                      Make member
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={async () => {
                                        if (!window.confirm("Remove this member from the account?")) {
                                          return;
                                        }
                                        try {
                                          await removeMember({
                                            accountId: accountId!,
                                            targetUserId: member.userId,
                                          });
                                          toast({ title: "Member removed" });
                                        } catch (e: unknown) {
                                          toast({
                                            title: "Failed",
                                            description: e instanceof Error ? e.message : "Unknown error",
                                            variant: "destructive",
                                          });
                                        }
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Remove
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
        </TabsContent>

        <TabsContent value="accounts">
          <div className="mb-6">
            <h2 className="text-lg font-semibold">Accounts</h2>
            <p className="text-muted-foreground">
              Your workspace and accounts others have shared with you. You can&apos;t add another owned account here yet.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {accounts === undefined ? (
              <div className="col-span-full text-center py-8 text-muted-foreground">Loading accounts...</div>
            ) : (
              accounts.map((account) => (
                <Card key={account._id} className="hover-elevate" data-testid={`card-account-${account._id}`}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-12 w-12">
                          <AvatarFallback className="bg-primary/10 text-primary">
                            {account.name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <h3 className="font-semibold">{account.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {account.isOwner ? "Your workspace" : "Shared with you"}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>Created {new Date(account.createdAt).toLocaleDateString()}</span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
