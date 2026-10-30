import { imageUrl } from "../urls";
import { usePageViewer } from "./page-viewer";
import { SignInButton } from "./sign-in-button";

/** The top-right corner of a page: sign in, or who is signed in and a way out. */
export function ViewerActions({ onSignOut }: { onSignOut: () => void }) {
  const { session, canSignIn, signIn } = usePageViewer();
  switch (session.status) {
    case "signed_out":
      return canSignIn ? <SignInButton label="Sign in with Twitch" onClick={signIn} /> : null;
    case "signing_in":
      return (
        <output className="block rounded-full bg-surface px-3.5 py-2 text-sm font-semibold text-muted shadow-md">
          Signing you in…
        </output>
      );
    case "signed_in": {
      const avatar = session.profile?.avatarUrl ? imageUrl(session.profile.avatarUrl) : null;
      return (
        <div className="flex items-center gap-2 rounded-full bg-surface py-1 pl-1 pr-3 shadow-md">
          {avatar === null ? (
            <span className="h-8 w-8 rounded-full bg-accent" aria-hidden="true" />
          ) : (
            <img src={avatar} alt="" referrerPolicy="no-referrer" className="h-8 w-8 rounded-full object-cover" />
          )}
          <span className="max-w-[10rem] truncate text-sm font-semibold">
            {session.profile?.displayName ?? "Signed in"}
          </span>
          <button
            type="button"
            onClick={onSignOut}
            className="ml-1 text-sm text-muted underline decoration-line underline-offset-4 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Sign out
          </button>
        </div>
      );
    }
  }
}
