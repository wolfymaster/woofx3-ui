import { Layers, Plus } from "lucide-react";
import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { CreateSceneDialog } from "@/components/scenes/create-scene-dialog";
import { SceneCanvasEditor } from "@/components/scenes/scene-canvas-editor";
import { ScenesSidebar } from "@/components/scenes/scenes-sidebar";
import { Button } from "@/components/ui/button";
import { useInstance } from "@/hooks/use-instance";

export default function Scenes() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/scenes/:id");
  const { instance } = useInstance();
  const engineSceneId = params?.id ?? null;
  const [createOpen, setCreateOpen] = useState(false);

  const selectScene = (id: string) => navigate(`/scenes/${id}`);

  return (
    <div className="flex h-full overflow-hidden">
      <ScenesSidebar selectedEngineSceneId={engineSceneId} onSelect={selectScene} />

      <div className="flex-1 overflow-hidden">
        {instance && engineSceneId ? (
          <SceneCanvasEditor key={engineSceneId} instanceId={instance._id} engineSceneId={engineSceneId} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
            <Layers className="h-12 w-12 mb-3 opacity-40" />
            <p className="text-sm mb-4">Select a scene from the sidebar, or create a new one.</p>
            <Button
              onClick={() => setCreateOpen(true)}
              disabled={!instance}
              data-testid="button-create-new-scene-empty-state"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create New Scene
            </Button>
          </div>
        )}
      </div>

      <CreateSceneDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={selectScene} />
    </div>
  );
}
