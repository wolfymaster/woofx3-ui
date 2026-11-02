import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { slugFormatError } from "@shared/engine-slug";
import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RenameEngineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: Id<"instances">;
  currentName: string;
  /** The address shown today, null when the engine has none yet. */
  address: string | null;
}

export function RenameEngineDialog({ open, onOpenChange, instanceId, currentName, address }: RenameEngineDialogProps) {
  const rename = useAction(api.provisioning.renameManagedEngine);
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(currentName);
      setError(null);
    }
  }, [open, currentName]);

  const next = name.trim().toLowerCase();
  const formatError = slugFormatError(next);
  const domain = address ? new URL(address).host.replace(/^[^.]+/, "") : "";

  async function handleRename() {
    setBusy(true);
    setError(null);
    try {
      const result = await rename({ instanceId, slug: next });
      if (result.ok) {
        onOpenChange(false);
      } else {
        setError(result.reason);
      }
    } catch {
      setError("Something went wrong and your name wasn't changed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change your name</DialogTitle>
          <DialogDescription>
            This changes your public page and your address. Your overlays and alerts keep working, nothing restarts, and
            it's fine to do while you're live.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="engine-new-name">New name</Label>
          <Input
            id="engine-new-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            data-testid="input-engine-new-name"
          />
          {next !== "" && next !== currentName && !formatError && domain && (
            <p className="text-xs text-muted-foreground">
              Your address becomes {next}
              {domain}
            </p>
          )}
          {formatError && <p className="text-xs text-destructive">{formatError}</p>}
          {error && (
            <p className="text-xs text-destructive" data-testid="text-rename-engine-error">
              {error}
            </p>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Old links to {currentName} keep working and lead to the same place, so anyone who has them can still find you.
          The old name stays yours and nobody else can take it. You can change your name once every 30 days.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleRename()}
            disabled={busy || next === "" || next === currentName || formatError !== null}
            data-testid="button-confirm-rename-engine"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Change name
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
