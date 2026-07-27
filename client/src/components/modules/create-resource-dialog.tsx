import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface CreateResourceDialogKind {
  kind: string;
  name: string;
}

interface CreateResourceDialogProps {
  kind: CreateResourceDialogKind;
  onClose: () => void;
  onCreate: (resourceInstanceId: string, displayName: string) => Promise<void>;
}

export function CreateResourceDialog({ kind, onClose, onCreate }: CreateResourceDialogProps) {
  const [resourceInstanceId, setResourceInstanceId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!resourceInstanceId.trim() || !displayName.trim()) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await onCreate(resourceInstanceId.trim(), displayName.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create resource.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New {kind.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="new-resource-id">ID</Label>
            <Input
              id="new-resource-id"
              placeholder="e.g. death_count"
              value={resourceInstanceId}
              onChange={(e) => setResourceInstanceId(e.target.value)}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Stable identifier used in workflows and actions. Cannot be changed.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-resource-name">Display Name</Label>
            <Input
              id="new-resource-name"
              placeholder="e.g. Death Count"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!resourceInstanceId.trim() || !displayName.trim() || creating} onClick={() => void handleCreate()}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
