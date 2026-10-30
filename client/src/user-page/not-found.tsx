import { PageShell } from "./page-shell";
import { REGISTER_URL } from "./urls";

/**
 * Shown when there is no page to show. The words are the same whether no
 * engine has the name or its page is not published, so a visitor cannot tell
 * which. Only a name that can still be claimed adds the invitation.
 */
export function NotFoundPage({ invite }: { invite: boolean }) {
  return (
    <PageShell accent="violet">
      <main className="px-4 pt-24 sm:px-6 sm:pt-32">
        <div className="mx-auto max-w-xl">
          <div className="flex items-stretch">
            <span className="w-2.5 shrink-0 bg-accent" aria-hidden="true" />
            <p className="bg-ink px-4 py-1.5 text-lg font-extrabold tabular-nums text-paper">404</p>
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight sm:text-5xl">There's no page here</h1>
          <p className="mt-4 text-lg text-muted">Check the address, or ask the streamer for their link.</p>
          {invite && (
            <div className="mt-10 rounded-2xl border border-line bg-surface p-6">
              <h2 className="text-xl font-bold tracking-tight">This name is free</h2>
              <p className="mt-2 text-muted">Sign up for woofx3 to make it your stream's page.</p>
              <a
                href={REGISTER_URL}
                className="mt-5 inline-block rounded-lg bg-accent px-5 py-2.5 font-semibold text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Claim this page
              </a>
            </div>
          )}
        </div>
      </main>
    </PageShell>
  );
}
