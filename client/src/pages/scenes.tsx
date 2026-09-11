import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { Layers, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { CreateSceneDialog } from "@/components/scenes/create-scene-dialog";
import { SceneCanvasEditor } from "@/components/scenes/scene-canvas-editor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";

type SceneRow = Doc<"scenes">;

const LIST_PATH = "/stream/scenes";
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

export default function Scenes() {
  const [, params] = useRoute("/stream/scenes/:id");
  const { instance, isLoading } = useInstance();
  const engineSceneId = params?.id ?? null;

  if (!engineSceneId) {
    return <SceneListScreen />;
  }

  if (!instance) {
    return (
      <div className="flex items-center justify-center h-full">
        {isLoading ? <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /> : null}
      </div>
    );
  }

  // The editor brings its own rail — the widget catalog for the selected scene.
  return <SceneCanvasEditor key={engineSceneId} instanceId={instance._id} engineSceneId={engineSceneId} />;
}

function SceneTableSkeleton() {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Scene</TableHead>
            <TableHead>Canvas</TableHead>
            <TableHead>Widgets</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-40" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-8" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-16" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function SceneListScreen() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { instance, isLoading: instanceLoading } = useInstance();

  const scenesRaw = useQuery(api.scenes.list, instance ? { instanceId: instance._id } : "skip");
  const deleteScene = useAction(api.sceneActions.deleteScene);

  const [searchQuery, setSearchQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SceneRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isLoading = instanceLoading || scenesRaw === undefined;
  const scenes = useMemo(() => (scenesRaw ?? []) as SceneRow[], [scenesRaw]);

  const visibleScenes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return scenes
      .filter((s) => !query || s.name.toLowerCase().includes(query) || !!s.description?.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [scenes, searchQuery]);

  const openScene = (scene: SceneRow) => {
    if (!scene.engineSceneId) {
      return;
    }
    navigate(`${LIST_PATH}/${scene.engineSceneId}`);
  };

  async function handleDelete() {
    if (!instance || !deleteTarget?.engineSceneId) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteScene({
        instanceId: instance._id as Id<"instances">,
        engineSceneId: deleteTarget.engineSceneId,
      });
      toast({ title: "Scene deleted" });
      setDeleteTarget(null);
    } catch (err) {
      toast({
        title: "Failed to delete scene",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader title="Scenes" description="Browser source overlays — pick one to lay out its widgets." />

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search scenes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-scenes"
            />
          </div>
          <Button onClick={() => setCreateOpen(true)} disabled={!instance} data-testid="button-new-scene">
            <Plus className="h-4 w-4 mr-2" />
            New Scene
          </Button>
        </div>

        {isLoading ? (
          <SceneTableSkeleton />
        ) : visibleScenes.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={scenes.length === 0 ? "No scenes yet" : "No scenes found"}
            description={
              scenes.length === 0 ? "Create a scene to start laying out overlay widgets." : "Try adjusting your search."
            }
            action={scenes.length === 0 ? { label: "Create New Scene", onClick: () => setCreateOpen(true) } : undefined}
          />
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scene</TableHead>
                  <TableHead>Canvas</TableHead>
                  <TableHead>Widgets</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleScenes.map((scene) => {
                  const isSyncing = !scene.engineSceneId;

                  return (
                    <TableRow
                      key={scene._id}
                      className={isSyncing ? undefined : "cursor-pointer"}
                      onClick={() => openScene(scene)}
                      data-testid={`row-scene-${scene._id}`}
                    >
                      <TableCell className="font-medium max-w-[420px]">
                        <span className="flex items-center gap-2">
                          <span className="truncate">{scene.name}</span>
                          {isSyncing && (
                            <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Syncing
                            </Badge>
                          )}
                        </span>
                        {scene.description && (
                          <span className="block truncate text-xs font-normal text-muted-foreground">
                            {scene.description}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {scene.width ?? DEFAULT_WIDTH}x{scene.height ?? DEFAULT_HEIGHT}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{(scene.widgets ?? []).length}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={isSyncing}
                            onClick={(e) => {
                              e.stopPropagation();
                              openScene(scene);
                            }}
                            title="Edit scene"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            disabled={isSyncing}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(scene);
                            }}
                            title="Delete scene"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      <CreateSceneDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(engineSceneId) => navigate(`${LIST_PATH}/${engineSceneId}`)}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Scene</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? Its widgets and browser source URL go with it, and
              this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
