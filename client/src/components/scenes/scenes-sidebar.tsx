import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { Layers, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInstance } from "@/hooks/use-instance";
import { cn } from "@/lib/utils";
import { CreateSceneDialog } from "./create-scene-dialog";

interface ScenesSidebarProps {
  selectedEngineSceneId: string | null;
  onSelect: (engineSceneId: string) => void;
}

export function ScenesSidebar({ selectedEngineSceneId, onSelect }: ScenesSidebarProps) {
  const { instance } = useInstance();
  const [searchQuery, setSearchQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const scenesRaw = useQuery(api.scenes.list, instance ? { instanceId: instance._id } : "skip");

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

      <CreateSceneDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={onSelect} />
    </div>
  );
}
