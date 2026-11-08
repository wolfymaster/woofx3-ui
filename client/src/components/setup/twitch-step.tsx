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
        <p className="font-medium">Ask an owner or admin to connect Twitch</p>
        <p className="text-muted-foreground">
          woofx3 needs this organization&apos;s Twitch channel connected before it can be used, and only an owner or
          admin can connect it. This page updates once they have.
        </p>
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
        <p className="font-medium">Ask the organization owner to choose a username</p>
        <p className="text-muted-foreground">
          We couldn&apos;t pick one from the Twitch name, and only the organization&apos;s owner can choose it. This
          page updates once they have.
        </p>
      </div>
    </div>
  );
}
