import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { USERNAME_PREFIX } from "@shared/engine-slug";
import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { SlugStatus, slugSubmittable, useSlugAvailability } from "@/components/onboarding/slug-availability";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ManagedEngineStepProps {
  instanceId: Id<"instances">;
}

/**
 * The connect screen's last resort, when no username could be derived from the
 * Twitch login. The username is also the engine's subdomain, so it is checked
 * against the maintenance API while the user types. Asking for the engine moves
 * setup on by itself, through its status.
 */
export function ManagedEngineStep({ instanceId }: ManagedEngineStepProps) {
  const startManagedEngine = useAction(api.provisioning.startManagedEngine);

  const [slug, setSlug] = useState("");
  const check = useSlugAvailability(slug);
  const [creating, setCreating] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const error = submitError ?? check.checkError;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setCreating(true);
    try {
      await startManagedEngine({ instanceId, slug });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  const canCreate = slugSubmittable(slug, check) && !creating;

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

        <SlugStatus slug={slug} check={check} />

        <p className="text-xs text-muted-foreground mt-1">
          Your username is your address on woofx3. You can change it later, once every 30 days.
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
