import { Layers } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { SceneCanvasEditor } from "@/components/scenes/scene-canvas-editor";
import { ScenesSidebar } from "@/components/scenes/scenes-sidebar";
import { useInstance } from "@/hooks/use-instance";

export default function Scenes() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/scenes/:id");
  const { instance } = useInstance();
  const engineSceneId = params?.id ?? null;

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <ScenesSidebar selectedEngineSceneId={engineSceneId} onSelect={(id) => navigate(`/scenes/${id}`)} />

      <div className="flex-1 overflow-hidden">
        {instance && engineSceneId ? (
          <SceneCanvasEditor key={engineSceneId} instanceId={instance._id} engineSceneId={engineSceneId} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
            <Layers className="h-12 w-12 mb-3 opacity-40" />
            <p className="text-sm">Select a scene from the sidebar, or create a new one.</p>
          </div>
        )}
      </div>
    </div>
  );
}
