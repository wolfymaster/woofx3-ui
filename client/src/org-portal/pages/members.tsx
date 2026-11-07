import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { OrgMember } from "@convex/organizations";
import { useMutation, useQuery } from "convex/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConvexUser } from "@/hooks/use-convex-auth";
import { toast } from "@/hooks/use-toast";
import { actionErrorMessage } from "@/lib/action-error";
import { useOrganization } from "../organization-context";

type ChangeableRole = "admin" | "member";

export default function MembersPage() {
  const { organization } = useOrganization();
  const { user } = useConvexUser();
  const meId = user && "_id" in user ? (user as { _id: Id<"users"> })._id : null;
  const members = useQuery(api.organizations.members, { accountId: organization.accountId });
  const updateRole = useMutation(api.accountMembers.updateMemberRole);
  const removeMember = useMutation(api.accountMembers.removeMember);
  const { seats } = organization;

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
          <p className="text-sm text-muted-foreground">Your role in this organization doesn&apos;t include Members.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Organization role</TableHead>
                <TableHead>Engines</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.userId} data-testid={`row-org-member-${member.userId}`}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={member.image ?? undefined} />
                        <AvatarFallback className="text-xs">{member.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{member.name}</p>
                        <p className="text-sm text-muted-foreground">{member.email ?? "—"}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
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
                      <span className="capitalize">{member.role}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {member.engines.length === 0
                      ? "No engines"
                      : member.engines.map((engine) => `${engine.name} (${engine.role})`).join(", ")}
                  </TableCell>
                  <TableCell>
                    {changeable(member) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => {
                          if (!window.confirm(`Remove ${member.name} from ${organization.name} and all its engines?`)) {
                            return;
                          }
                          void run(
                            () => removeMember({ accountId: organization.accountId, targetUserId: member.userId }),
                            "Member removed"
                          );
                        }}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
          <span>Invite people from an engine&apos;s Team page.</span>
          {seats ? (
            <span data-testid="text-seats">
              {seats.limit === null ? `${seats.used} seats used` : `${seats.used} of ${seats.limit} seats used`}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
