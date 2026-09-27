import { api } from "@convex/_generated/api";
import type { TwitchInviteCandidate } from "@convex/invitations";
import { useAction } from "convex/react";
import { ArrowLeft, Copy, Link as LinkIcon, Loader2, Mail, Search, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { TwitchUserCard } from "@/components/twitch/twitch-user-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useInstance } from "@/hooks/use-instance";
import { toast } from "@/hooks/use-toast";

type InviteMethod = "twitch" | "email";
type InviteRole = "admin" | "member";

type TwitchLookup =
  | { state: "idle" }
  | { state: "looking" }
  | { state: "not-found" }
  | { state: "failed"; message: string }
  | { state: "found"; candidate: TwitchInviteCandidate };

const TEAM_PATH = "/team";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function inviteUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/auth/accept-invite?token=${encodeURIComponent(token)}`;
}

/**
 * Invites one person to the account's team, by Twitch username or by email.
 * A Twitch invite is only created after the inviter has seen who the name
 * belongs to, so a typo cannot hand access to a stranger.
 */
export default function TeamInvite() {
  const { instance } = useInstance();
  const accountId = instance?.accountId;

  const lookupTwitchUser = useAction(api.invitations.lookupTwitchUser);
  const createInvite = useAction(api.invitations.create);

  const [method, setMethod] = useState<InviteMethod>("twitch");
  const [role, setRole] = useState<InviteRole>("member");
  const [login, setLogin] = useState("");
  const [lookup, setLookup] = useState<TwitchLookup>({ state: "idle" });
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  function startOver() {
    setLogin("");
    setLookup({ state: "idle" });
    setEmail("");
    setRole("member");
    setLink(null);
  }

  async function runLookup() {
    if (!accountId || login.trim() === "") {
      return;
    }
    setLookup({ state: "looking" });
    try {
      const candidate = await lookupTwitchUser({ accountId, login });
      setLookup(candidate ? { state: "found", candidate } : { state: "not-found" });
    } catch (err) {
      setLookup({ state: "failed", message: errorMessage(err) });
    }
  }

  async function submit(target: { kind: "twitch"; twitchUserId: string } | { kind: "email"; email: string }) {
    if (!accountId) {
      return;
    }
    setSubmitting(true);
    try {
      const { token } = await createInvite({ accountId, role, target });
      setLink(inviteUrl(token));
      toast({ title: "Invitation created", description: "Share the link with your teammate." });
    } catch (err) {
      toast({ title: "Could not invite", description: errorMessage(err), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    if (!link) {
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Copied", description: "Invite link copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }

  const backLink = (
    <Button variant="ghost" size="sm" asChild>
      <Link href={TEAM_PATH}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to team
      </Link>
    </Button>
  );

  if (!accountId) {
    return (
      <div className="p-6 lg:p-8 max-w-2xl mx-auto">
        <PageHeader title="Invite a team member" actions={backLink} />
        <p className="text-sm text-muted-foreground">No instance available yet.</p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto">
      <PageHeader
        title="Invite a team member"
        description="You'll get a link to share. It only works for the person you invite."
        actions={backLink}
      />

      {link ? (
        <Card>
          <CardHeader>
            <CardTitle>Invitation created</CardTitle>
            <CardDescription>Send this link to your teammate. It expires in 14 days.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input readOnly value={link} className="font-mono text-xs" data-testid="input-invite-link" />
              <Button type="button" size="icon" variant="outline" onClick={copyLink} aria-label="Copy invite link">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <LinkIcon className="h-3 w-3" />
              {method === "twitch"
                ? "They open it and sign in with the Twitch account you picked."
                : "They open it while signed in with the email you entered."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={startOver} data-testid="button-invite-another">
                Invite someone else
              </Button>
              <Button asChild>
                <Link href={TEAM_PATH}>Done</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-2">
              <Label>Invite by</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={method}
                onValueChange={(next) => {
                  if (next) {
                    setMethod(next as InviteMethod);
                  }
                }}
                className="justify-start"
                aria-label="Invite by"
              >
                <ToggleGroupItem value="twitch" data-testid="toggle-invite-twitch">
                  Twitch username
                </ToggleGroupItem>
                <ToggleGroupItem value="email" data-testid="toggle-invite-email">
                  Email
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {method === "twitch" ? (
              <div className="space-y-4">
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runLookup();
                  }}
                >
                  <Label htmlFor="invite-twitch-login">Twitch username</Label>
                  <div className="flex gap-2">
                    <Input
                      id="invite-twitch-login"
                      placeholder="their_twitch_name"
                      autoComplete="off"
                      value={login}
                      onChange={(e) => {
                        setLogin(e.target.value);
                        setLookup({ state: "idle" });
                      }}
                      data-testid="input-invite-twitch-login"
                    />
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={login.trim() === "" || lookup.state === "looking"}
                      data-testid="button-invite-lookup"
                    >
                      {lookup.state === "looking" ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4 mr-2" />
                      )}
                      Look up
                    </Button>
                  </div>
                </form>

                {lookup.state === "not-found" ? (
                  <p className="text-sm text-destructive" data-testid="text-invite-not-found">
                    No Twitch user by that name.
                  </p>
                ) : null}
                {lookup.state === "failed" ? <p className="text-sm text-destructive">{lookup.message}</p> : null}

                {lookup.state === "found" ? (
                  <TwitchUserCard user={lookup.candidate} data-testid="card-invite-candidate">
                    {lookup.candidate.refusal ? (
                      <p className="text-sm text-muted-foreground">{lookup.candidate.refusal}.</p>
                    ) : (
                      <div className="space-y-3">
                        <RoleField role={role} onChange={setRole} />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={submitting}
                            onClick={() => void submit({ kind: "twitch", twitchUserId: lookup.candidate.twitchUserId })}
                            data-testid="button-confirm-invite"
                          >
                            <UserPlus className="h-4 w-4 mr-2" />
                            Invite {lookup.candidate.displayName}
                          </Button>
                          <Button variant="outline" onClick={() => setLookup({ state: "idle" })}>
                            Not them
                          </Button>
                        </div>
                      </div>
                    )}
                  </TwitchUserCard>
                ) : null}
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email.trim() !== "") {
                    void submit({ kind: "email", email: email.trim() });
                  }
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="invite-email">Email address</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="colleague@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    data-testid="input-invite-email"
                  />
                  <p className="text-xs text-muted-foreground">They must sign in with this same email.</p>
                </div>
                <RoleField role={role} onChange={setRole} />
                <Button type="submit" disabled={email.trim() === "" || submitting} data-testid="button-send-invite">
                  <Mail className="h-4 w-4 mr-2" />
                  Create invite
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RoleField({ role, onChange }: { role: InviteRole; onChange: (role: InviteRole) => void }) {
  return (
    <div className="space-y-2">
      <Label>Role</Label>
      <Select value={role} onValueChange={(next) => onChange(next as InviteRole)}>
        <SelectTrigger data-testid="select-invite-role">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="admin">Admin</SelectItem>
          <SelectItem value="member">Member</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {role === "admin"
          ? "Can manage team settings and members."
          : "Can use workflows, assets, and engine features for this account."}
      </p>
    </div>
  );
}
