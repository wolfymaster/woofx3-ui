import { PageShell } from "./page-shell";

/** The page's outline while its content loads, in the default accent's place of a banner. */
export function PageSkeleton() {
  const block = "bg-line motion-safe:animate-pulse";
  return (
    <PageShell accent="slate">
      <div aria-busy="true">
        <p className="sr-only">Loading page</p>
        <div className={`aspect-[2/1] sm:aspect-[3/1] sm:rounded-b-3xl ${block}`} />
        <div className="-mt-10 px-4 sm:-mt-14 sm:px-6">
          <div className="h-14 w-64 max-w-full bg-ink/20 sm:h-[4.5rem] sm:w-96" />
        </div>
        <div className="mx-auto mt-10 flex max-w-2xl flex-col gap-6 px-4 sm:px-6">
          <div className={`h-40 rounded-2xl ${block}`} />
          <div className={`h-28 rounded-2xl ${block}`} />
        </div>
      </div>
    </PageShell>
  );
}
