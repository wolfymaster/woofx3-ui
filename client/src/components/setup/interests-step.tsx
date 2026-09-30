import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { availableInterests } from "@convex/lib/setupInterests";
import type { SetupStatus } from "@convex/setup";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface InterestsStepProps {
  instanceId: Id<"instances">;
  status: SetupStatus;
  onContinue: () => void;
}

/**
 * Asks what the streamer wants woofx3 to do. Each answer installs starter
 * packs with their default wording once the engine is ready, and shapes the
 * first dashboard. Only answers the chosen platforms can deliver are offered.
 */
export function InterestsStep({ instanceId, status, onContinue }: InterestsStepProps) {
  const chooseInterests = useMutation(api.setup.chooseInterests);
  const interests = availableInterests(status.platforms.map((platform) => platform.marketplaceModuleId));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(status.interests));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(interestIds: string[]) {
    setError(null);
    setSaving(true);
    try {
      await chooseInterests({ instanceId, interestIds });
      onContinue();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function toggle(id: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) {
      next.add(id);
    } else {
      next.delete(id);
    }
    setSelected(next);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pick what you&apos;d like set up. Each one installs ready-made workflows or commands you can change later on the
        Starter packs page.
      </p>

      <ul className="divide-y rounded-lg border" data-testid="list-setup-interests">
        {interests.map((interest) => {
          const checkboxId = `setup-interest-${interest.id}`;
          return (
            <li key={interest.id} className="flex gap-3 p-4">
              <Checkbox
                id={checkboxId}
                checked={selected.has(interest.id)}
                onCheckedChange={(value) => toggle(interest.id, value === true)}
                className="mt-0.5"
                data-testid={`checkbox-${checkboxId}`}
              />
              <label htmlFor={checkboxId} className="flex-1 cursor-pointer space-y-0.5">
                <span className="block font-medium">{interest.label}</span>
                <span className="block text-sm text-muted-foreground">{interest.description}</span>
              </label>
            </li>
          );
        })}
      </ul>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => void save([])}
          disabled={saving}
          data-testid="button-interests-skip"
        >
          Skip
        </Button>
        <Button
          className="flex-1"
          onClick={() => void save([...selected])}
          disabled={saving}
          data-testid="button-interests-continue"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Continue
        </Button>
      </div>
    </div>
  );
}
