import { AlertCircle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { TwitchGlyph } from "@/components/twitch/twitch-glyph";
import { Button } from "@/components/ui/button";
import { describePermissions } from "@/lib/module-permissions";

/** Where the Twitch module's permissions stand, as setup reads them before asking for consent. */
export type TwitchPermissionsLoad =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "ready"; permissions: string[] };

interface TwitchConnectCardProps {
  load: TwitchPermissionsLoad;
  onRetry: () => void;
  /** What went wrong with the last attempt, shown under the permissions. */
  failure: string | null;
  busy: boolean;
  onConnect: () => void;
  /** Below the button, such as the code a device login waits on. */
  children?: ReactNode;
}

/**
 * Setup's Twitch card: what connecting lets woofx3 do on the channel, and the
 * button that connects. Connecting is the consent to the permissions listed,
 * so the button waits for them.
 */
export function TwitchConnectCard({ load, onRetry, failure, busy, onConnect, children }: TwitchConnectCardProps) {
  return (
    <>
      <p className="text-sm text-muted-foreground">This is where your alerts come from.</p>

      <div className="rounded-lg border p-4 space-y-3" data-testid="card-connect-twitch">
        <div className="flex items-center gap-2 font-medium">
          <TwitchGlyph className="h-5 w-5" />
          Twitch
        </div>

        {load.state === "loading" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Getting things ready…
          </p>
        )}

        {load.state === "failed" && (
          <div className="space-y-2">
            <p className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              We can't reach Twitch setup right now.
            </p>
            <Button variant="secondary" size="sm" onClick={onRetry} data-testid="button-retry-platforms">
              Try again
            </Button>
          </div>
        )}

        {load.state === "ready" && (
          <div className="text-sm">
            <p className="font-medium">What woofx3 can do on your channel:</p>
            <ul className="list-disc pl-5 text-muted-foreground" data-testid="list-twitch-permissions">
              <li>Read your chat and stream events, so alerts can play</li>
              {describePermissions(load.permissions).map((permission) => (
                <li key={permission.id} className={permission.known ? undefined : "text-amber-500"}>
                  {permission.description}
                </li>
              ))}
            </ul>
          </div>
        )}

        {failure && <p className="text-sm text-destructive">{failure}</p>}

        <Button
          className="w-full"
          disabled={busy || load.state !== "ready"}
          onClick={onConnect}
          data-testid="button-connect-twitch"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Connect Twitch
        </Button>
        {children}
      </div>

      <p className="text-xs text-muted-foreground">More platforms are on the way.</p>
      <p className="text-xs text-muted-foreground">Connecting means you approve what's listed.</p>
    </>
  );
}
