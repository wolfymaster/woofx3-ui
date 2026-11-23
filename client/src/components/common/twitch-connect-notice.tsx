import { Link } from "wouter";
import { Button } from "@/components/ui/button";

interface TwitchConnectNoticeProps {
  /** What the user cannot do yet, completing "to ...": "pin messages". */
  to: string;
  /** True when Twitch is linked but lacks a permission or needs a new sign-in. */
  reconnect?: boolean;
}

/** The single "connect Twitch" prompt, so every widget words it and links to the same place. */
export function TwitchConnectNotice({ to, reconnect = false }: TwitchConnectNoticeProps) {
  const verb = reconnect ? "Reconnect" : "Connect";
  return (
    <div className="flex flex-col items-start gap-2 text-sm" data-testid="twitch-connect-notice">
      <p className="text-muted-foreground">
        {verb} Twitch to {to}.
      </p>
      <Button asChild size="sm" variant="outline">
        <Link href="/admin/integrations">{verb} Twitch</Link>
      </Button>
    </div>
  );
}
