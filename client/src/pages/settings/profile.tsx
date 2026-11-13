import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConvexUser } from "@/hooks/use-convex-auth";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { actionErrorMessage } from "@/lib/action-error";
import { NEW_ENGINE_ONBOARDING_PATH } from "@/lib/onboarding-route";
import { PASSWORD_MIN_LENGTH } from "@/lib/register-error";

/** Radix Select cannot hold an empty value, so "no default" is this. */
const NO_DEFAULT = "none";

const PASSWORD_REFUSALS = {
  no_password: "Your account has no password to change.",
  wrong_password: "That isn't your current password.",
  weak_password: `Use a password with at least ${PASSWORD_MIN_LENGTH} characters.`,
  too_many_attempts: "Too many wrong passwords. Try again in an hour.",
} as const;

function useSave() {
  const { toast } = useToast();
  return async (title: string, run: () => Promise<unknown>) => {
    try {
      await run();
      toast({ title });
    } catch (e) {
      toast({
        title: "Couldn't save",
        description: actionErrorMessage(e),
        variant: "destructive",
      });
    }
  };
}

function DisplayNameCard({ name, fromTwitch }: { name: string; fromTwitch: boolean }) {
  const updateProfile = useMutation(api.users.updateProfile);
  const save = useSave();
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  const trimmed = draft.trim();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Display name</CardTitle>
        <CardDescription>
          {fromTwitch ? "Your name comes from Twitch, so it can't be changed here." : "How you appear to your team."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            await save("Display name saved", () => updateProfile({ name: trimmed }));
            setSaving(false);
          }}
        >
          <Input
            aria-label="Display name"
            value={draft}
            disabled={fromTwitch}
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 min-w-[200px]"
            data-testid="input-display-name"
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={fromTwitch || saving || !trimmed || trimmed === name}
            data-testid="button-save-display-name"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save name"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const changePassword = useAction(api.users.changePassword);
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasPassword) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>You sign in with Twitch, so there is no password to change.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Choose a new password for signing in with your email.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 max-w-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError(null);
            try {
              const result = await changePassword({ currentPassword: current, newPassword: next });
              if (result.ok) {
                setCurrent("");
                setNext("");
                toast({ title: "Password changed" });
              } else {
                setError(PASSWORD_REFUSALS[result.reason]);
              }
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value);
                setError(null);
              }}
              data-testid="input-current-password"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              value={next}
              onChange={(e) => {
                setNext(e.target.value);
                setError(null);
              }}
              data-testid="input-new-password"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" variant="secondary" disabled={saving || !current || !next} className="w-fit">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DefaultEngineCard() {
  const { instances } = useInstance();
  const settings = useQuery(api.userSettings.getMine);
  const setDefaultEngine = useMutation(api.userSettings.setDefaultEngine);
  const save = useSave();
  const engines = instances.filter((candidate) => candidate !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default engine</CardTitle>
        <CardDescription>The engine that opens when you sign in.</CardDescription>
      </CardHeader>
      <CardContent>
        <Select
          value={settings?.defaultInstanceId ?? NO_DEFAULT}
          disabled={settings === undefined}
          onValueChange={(value) =>
            save("Default engine saved", () =>
              setDefaultEngine({ instanceId: value === NO_DEFAULT ? null : (value as Id<"instances">) })
            )
          }
        >
          <SelectTrigger className="max-w-sm" aria-label="Default engine" data-testid="select-default-engine">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_DEFAULT}>The one I used last</SelectItem>
            {engines.map((engine) => (
              <SelectItem key={engine._id} value={engine._id}>
                {engine.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}

/** For someone who only uses engines they were invited to; anyone with an engine of their own never sees it. */
function SetUpOwnEngineCard() {
  const { instances, isLoading } = useInstance();
  if (isLoading || instances.some((engine) => engine.ownedByMe)) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up your own engine</CardTitle>
        <CardDescription>
          You're using an engine someone invited you to. Stream yourself? Get your own, with your own overlay, alerts
          and commands.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild data-testid="button-setup-own-engine">
          <Link href={NEW_ENGINE_ONBOARDING_PATH}>Set up your own engine</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function ProfileSettings() {
  const { user } = useConvexUser();
  const methods = useQuery(api.users.signInMethods);

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      <PageHeader title="Your settings" description="Your name, password and the engine you open on sign-in." />
      {user && methods ? (
        <div className="space-y-4">
          <DisplayNameCard name={user.name ?? ""} fromTwitch={methods.twitch} />
          <PasswordCard hasPassword={methods.password} />
          <DefaultEngineCard />
          <SetUpOwnEngineCard />
        </div>
      ) : (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}
