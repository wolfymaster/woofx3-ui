import { PackageSearch, Store, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

// What the storefront shows when it has nothing to show.
//
// The marketplace is a separate service, so "it is not answering" is a state a
// streamer will meet, and it is the first impression for anyone whose first
// visit lands on it. These are designed states for that reason: the service's
// own error text is kept, but behind a disclosure, because a stack trace in a
// red panel reads as a broken product rather than as a service that is down.

export function StorefrontError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <WifiOff className="h-6 w-6" />
      </span>
      <div className="space-y-1">
        <p className="text-base font-semibold">The marketplace isn't answering</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Nothing is wrong with your instance — the store is a separate service. Try again in a moment.
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Try again
      </Button>
      <details className="max-w-lg text-left">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Technical details
        </summary>
        <p className="mt-2 break-words rounded-md bg-muted/60 p-2 font-mono text-[11px] text-muted-foreground">
          {message}
        </p>
      </details>
    </div>
  );
}

/** No results for a search or filter. */
export function StorefrontNoResults({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <PackageSearch className="h-6 w-6" />
      </span>
      <div className="space-y-1">
        <p className="text-base font-semibold">{query === "" ? "Nothing here yet" : `Nothing matches "${query}"`}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Try a creator's name, a type like "theme" or "emotes", or fewer words.
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onClear}>
        Browse everything
      </Button>
    </div>
  );
}

/** The catalog came back, and it is genuinely empty. */
export function StorefrontEmptyCatalog() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Store className="h-6 w-6" />
      </span>
      <div className="space-y-1">
        <p className="text-base font-semibold">The store is being stocked</p>
        <p className="max-w-md text-sm text-muted-foreground">
          No listings are published to your instance yet. Modules, themes, emotes, overlays and alerts all land here.
        </p>
      </div>
    </div>
  );
}
