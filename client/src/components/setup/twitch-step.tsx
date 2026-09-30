import type { Id } from "@convex/_generated/dataModel";
import type { SetupStatus } from "@convex/setup";
import { CheckCircle2, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTwitchConnect } from "@/hooks/use-twitch-connect";
import { setupStepPath } from "@/lib/setup-steps";

interface TwitchStepProps {
  instanceId: Id<"instances">;
  status: SetupStatus;
  onContinue: () => void;
}

/**
 * Setup's required Twitch connection. It is separate from signing in with
 * Twitch: this grants the scopes the engine uses on the channel, and only an
 * owner or admin may grant them. It needs only the instance record, so it
 * works while the engine is still being built; the engine receives the
 * token when it registers.
 */
export function TwitchStep({ instanceId, status, onContinue }: TwitchStepProps) {
  const { connect, starting, error } = useTwitchConnect();

  if (status.twitchUsername !== null) {
    return (
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-sm" data-testid="text-twitch-connected">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          Connected as <span className="font-medium">@{status.twitchUsername}</span>
        </p>
        <Button className="w-full" onClick={onContinue} data-testid="button-twitch-continue">
          Continue
        </Button>
      </div>
    );
  }

  if (!status.canManageSetup) {
    return <AskAdminToConnectTwitch />;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        woofx3 reads your chat and stream events and acts on your channel, such as changing your title or timing out a
        chatter when a workflow asks it to. Twitch asks you to approve that next.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        className="w-full"
        onClick={() => void connect(instanceId, setupStepPath("twitch"))}
        disabled={starting}
        data-testid="button-connect-twitch"
      >
        {starting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Connect Twitch
      </Button>
    </div>
  );
}

/**
 * What a member who is not an owner or admin sees while the instance has no
 * Twitch connection: they cannot connect it themselves, so there is nothing
 * to send them to.
 */
export function AskAdminToConnectTwitch() {
  return (
    <div className="rounded-md border p-4 flex gap-3" data-testid="text-twitch-ask-admin">
      <Users className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
      <div className="space-y-1 text-sm">
        <p className="font-medium">Ask an owner or admin to connect Twitch</p>
        <p className="text-muted-foreground">
          woofx3 needs this account&apos;s Twitch channel connected before it can be used, and only an owner or admin
          can connect it. This page updates once they have.
        </p>
      </div>
    </div>
  );
}
