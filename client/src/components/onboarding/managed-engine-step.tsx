import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { slugFormatError, USERNAME_PREFIX, usernameAddress } from "@shared/engine-slug";
import { useAction } from "convex/react";
import { Check, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ManagedEngineStepProps {
  instanceId: Id<"instances">;
}

/** Availability is asked for after the typing stops, not on every keystroke. */
const CHECK_DEBOUNCE_MS = 400;

type Availability =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available" }
  | { state: "unavailable"; reason: string };

/**
 * The connect screen's last resort, when no username could be derived from the
 * Twitch login. The username is also the engine's subdomain, so it is checked
 * against the maintenance API while the user types. Asking for the engine moves
 * setup on by itself, through its status.
 */
export function ManagedEngineStep({ instanceId }: ManagedEngineStepProps) {
  const checkSlug = useAction(api.provisioning.checkSlug);
  const startManagedEngine = useAction(api.provisioning.startManagedEngine);

  const [slug, setSlug] = useState("");
  const [availability, setAvailability] = useState<Availability>({ state: "idle" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatError = slugFormatError(slug);

  useEffect(() => {
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
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }, CHECK_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, formatError, checkSlug]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await startManagedEngine({ instanceId, slug });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  const canCreate = slug.length > 0 && !formatError && availability.state !== "unavailable" && !creating;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="engine-slug">Pick your woofx3 name</Label>
        <div className="mt-1 flex items-center gap-1">
          <span className="text-sm text-muted-foreground font-mono shrink-0">{USERNAME_PREFIX}</span>
          <Input
            id="engine-slug"
            value={slug}
            onChange={(event) => setSlug(event.target.value.trim().toLowerCase())}
            placeholder="yourname"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            required
            data-testid="input-engine-slug"
          />
        </div>

        <div className="mt-1 min-h-5 text-xs" data-testid="text-slug-status">
          {formatError ? (
            <span className="text-destructive">{formatError}</span>
          ) : availability.state === "checking" ? (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Checking…
            </span>
          ) : availability.state === "available" ? (
            <span className="text-green-500 inline-flex items-center gap-1">
              <Check className="h-3 w-3" />
              {usernameAddress(slug)} is yours
            </span>
          ) : availability.state === "unavailable" ? (
            <span className="text-destructive inline-flex items-center gap-1">
              <X className="h-3 w-3" />
              {availability.reason}
            </span>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground mt-1">
          Your username is your address on woofx3. It cannot be changed later.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={!canCreate} data-testid="button-create-engine">
        {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        {creating ? "Saving…" : "Use this name"}
      </Button>
    </form>
  );
}
