import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { Layers, Loader2, Plus, Search } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ScenesSidebarProps {
  selectedEngineSceneId: string | null;
  onSelect: (engineSceneId: string) => void;
}

export function ScenesSidebar({ selectedEngineSceneId, onSelect }: ScenesSidebarProps) {
  const { instance } = useInstance();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newSceneName, setNewSceneName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const scenesRaw = useQuery(api.scenes.list, instance ? { instanceId: instance._id } : "skip");
  const createScene = useAction(api.sceneActions.createScene);

  const scenes = (scenesRaw ?? [])
    .filter((s): s is typeof s & { engineSceneId: string } => typeof s.engineSceneId === "string")
    .map((s) => ({
      engineSceneId: s.engineSceneId,
      name: s.name,
      width: s.width ?? 1920,
      height: s.height ?? 1080,
      widgetCount: (s.widgets ?? []).length,
    }));

  const filtered = scenes.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const handleCreate = async () => {
    if (!newSceneName.trim() || !instance) {
      return;
    }
    setIsCreating(true);
    try {
      const { engineSceneId } = await createScene({
        instanceId: instance._id,
        name: newSceneName.trim(),
        layoutJson: JSON.stringify({ width: 1920, height: 1080, backgroundColor: "transparent" }),
      });
      setCreateOpen(false);
      setNewSceneName("");
      onSelect(engineSceneId);
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
    <div className="w-72 shrink-0 border-r bg-background flex flex-col">
      <div className="p-2 border-b">
        <Button
          className="w-full"
          disabled={!instance}
          onClick={() => setCreateOpen(true)}
          data-testid="button-new-scene"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Scene
        </Button>
      </div>

      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search scenes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 text-xs pl-7"
            data-testid="input-search-scenes"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {scenesRaw === undefined ? (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              {scenes.length === 0 ? "No scenes yet." : "No matches."}
            </div>
          ) : (
            filtered.map((scene) => {
              const isSelected = scene.engineSceneId === selectedEngineSceneId;
              return (
                <button
                  type="button"
                  key={scene.engineSceneId}
                  className={cn(
                    "w-full text-left group flex items-start gap-2 rounded-md px-2 py-2 cursor-pointer hover:bg-accent",
                    isSelected && "bg-accent"
                  )}
                  onClick={() => onSelect(scene.engineSceneId)}
                  data-testid={`scene-item-${scene.engineSceneId}`}
                >
                  <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                    <Layers className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium truncate block">{scene.name}</span>
                    <span className="text-[11px] text-muted-foreground truncate block">
                      {scene.width}x{scene.height} · {scene.widgetCount} widgets
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Scene</DialogTitle>
            <DialogDescription>Enter a name for your new scene. You can customize it after creation.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="scene-name">Scene Name</Label>
            <Input
              id="scene-name"
              value={newSceneName}
              onChange={(e) => setNewSceneName(e.target.value)}
              placeholder="e.g., Game Overlay"
              className="mt-2"
              data-testid="input-new-scene-name"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newSceneName.trim() || isCreating}
              data-testid="button-create-scene"
            >
              {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Scene
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
