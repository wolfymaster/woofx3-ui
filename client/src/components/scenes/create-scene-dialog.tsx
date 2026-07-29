import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { useState } from "react";
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
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";

interface CreateSceneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (engineSceneId: string) => void;
}

/** Shared "New Scene" dialog — used by both the sidebar's header button and the
 * empty-state prompt shown when no scene is selected, so scene creation always
 * goes through one path. */
export function CreateSceneDialog({ open, onOpenChange, onCreated }: CreateSceneDialogProps) {
  const { instance } = useInstance();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const createScene = useAction(api.sceneActions.createScene);

  const handleCreate = async () => {
    if (!name.trim() || !instance) {
      return;
    }
    setIsCreating(true);
    try {
      const { engineSceneId } = await createScene({
        instanceId: instance._id,
        name: name.trim(),
        layoutJson: JSON.stringify({ width: 1920, height: 1080, backgroundColor: "transparent" }),
      });
      onOpenChange(false);
      setName("");
      onCreated(engineSceneId);
    } catch (err) {
      toast({
        title: "Create failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Scene</DialogTitle>
          <DialogDescription>Enter a name for your new scene. You can customize it after creation.</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label htmlFor="scene-name">Scene Name</Label>
          <Input
            id="scene-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Game Overlay"
            className="mt-2"
            data-testid="input-new-scene-name"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || isCreating} data-testid="button-create-scene">
            {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Scene
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
