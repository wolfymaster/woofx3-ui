import { Users } from "lucide-react";

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
        <p className="font-medium">Ask the account owner to connect Twitch</p>
        <p className="text-muted-foreground">This page updates when they do.</p>
      </div>
    </div>
  );
}

/** For an admin on someone else's account: a username can only be chosen by the account's owner. */
export function AskOwnerToChooseUsername() {
  return (
    <div className="rounded-md border p-4 flex gap-3" data-testid="text-username-ask-owner">
      <Users className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
      <div className="space-y-1 text-sm">
        <p className="font-medium">Ask the account owner to pick a name</p>
        <p className="text-muted-foreground">This page updates once they do.</p>
      </div>
    </div>
  );
}
