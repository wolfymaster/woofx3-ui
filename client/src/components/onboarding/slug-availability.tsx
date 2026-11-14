import { api } from "@convex/_generated/api";
import { slugFormatError, usernameAddress } from "@shared/engine-slug";
import { useAction } from "convex/react";
import { Check, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

/** Availability is asked for after the typing stops, not on every keystroke. */
const CHECK_DEBOUNCE_MS = 400;

export type SlugAvailability =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available" }
  | { state: "unavailable"; reason: string };

export interface SlugCheck {
  availability: SlugAvailability;
  /** Why the slug's format can never be used, or null. */
  formatError: string | null;
  /** Why the availability check could not run, or null. */
  checkError: string | null;
}

/**
 * Asks the maintenance API whether `slug` can be used, while the user types.
 * A slug is also the engine's subdomain, so the answer is theirs to see before
 * they submit.
 */
export function useSlugAvailability(slug: string): SlugCheck {
  const checkSlug = useAction(api.provisioning.checkSlug);
  const [availability, setAvailability] = useState<SlugAvailability>({ state: "idle" });
  const [checkError, setCheckError] = useState<string | null>(null);
  const formatError = slugFormatError(slug);

  useEffect(() => {
    setCheckError(null);
    if (slug.length === 0 || formatError) {
      setAvailability({ state: "idle" });
      return;
    }
    setAvailability({ state: "checking" });

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await checkSlug({ slug });
        if (cancelled) {
          return;
        }
        setAvailability(
          result.available
            ? { state: "available" }
            : { state: "unavailable", reason: result.reason ?? "That name is taken" }
        );
      } catch (err) {
        if (!cancelled) {
          // A check that could not run must not present the name as unusable;
          // creating it is still allowed, and the server decides then.
          setAvailability({ state: "idle" });
          setCheckError(err instanceof Error ? err.message : String(err));
        }
      }
    }, CHECK_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, formatError, checkSlug]);

  return { availability, formatError, checkError };
}

/** The line under a slug field: its format problem, the check in flight, or the answer. */
export function SlugStatus({ slug, check }: { slug: string; check: SlugCheck }) {
  return (
    <div className="mt-1 min-h-5 text-xs" data-testid="text-slug-status">
      <SlugStatusText slug={slug} check={check} />
    </div>
  );
}

function SlugStatusText({ slug, check }: { slug: string; check: SlugCheck }) {
  const { availability, formatError } = check;
  if (formatError) {
    return <span className="text-destructive">{formatError}</span>;
  }
  switch (availability.state) {
    case "idle":
      return null;
    case "checking":
      return (
        <span className="text-muted-foreground inline-flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking…
        </span>
      );
    case "available":
      return (
        <span className="text-green-500 inline-flex items-center gap-1">
          <Check className="h-3 w-3" />
          {usernameAddress(slug)} is yours
        </span>
      );
    case "unavailable":
      return (
        <span className="text-destructive inline-flex items-center gap-1">
          <X className="h-3 w-3" />
          {availability.reason}
        </span>
      );
  }
}

/** Whether a slug is worth submitting: well formed and not known to be taken. */
export function slugSubmittable(slug: string, check: SlugCheck): boolean {
  return slug.length > 0 && !check.formatError && check.availability.state !== "unavailable";
}
