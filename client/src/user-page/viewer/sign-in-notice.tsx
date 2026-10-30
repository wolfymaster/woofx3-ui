import { type SignInFailure, signInFailureMessage } from "./sign-in";

/** Why the last sign-in did not finish, above the page's sections until dismissed. */
export function SignInNotice({ failure, onDismiss }: { failure: SignInFailure; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="mx-auto mb-6 flex max-w-2xl items-start gap-4 rounded-xl border-l-4 border-accent bg-surface px-4 py-3 shadow-sm"
    >
      <p className="flex-1">{signInFailureMessage(failure)}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="text-sm font-semibold text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Dismiss
      </button>
    </div>
  );
}
