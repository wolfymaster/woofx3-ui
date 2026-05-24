import { useState } from "react";
import { useLocation } from "wouter";
import {
  Copy,
  Edit3,
  Layers,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/layout/page-header";

// Local display shape mapped from Convex doc
interface SceneDisplay {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  backgroundColor: string;
  widgetCount: number;
}

interface SceneCardProps {
  scene: SceneDisplay;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

function SceneCard({ scene, onEdit, onDuplicate, onDelete }: SceneCardProps) {
  return (
    <Card
      className="group hover-elevate cursor-pointer overflow-visible"
      onClick={() => onEdit(scene.id)}
      data-testid={`card-scene-${scene.id}`}
    >
      <CardContent className="p-0">
        <div
          className="aspect-video bg-muted/50 rounded-t-lg flex items-center justify-center relative overflow-hidden"
          style={{ backgroundColor: scene.backgroundColor !== "transparent" ? scene.backgroundColor : undefined }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          <Layers className="h-12 w-12 text-muted-foreground/30" />
          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
            <Badge variant="secondary" className="text-xs">
              {scene.width}x{scene.height}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {scene.widgetCount} widgets
            </Badge>
          </div>
        </div>
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold truncate" data-testid={`text-scene-name-${scene.id}`}>
                {scene.name}
              </h3>
              {scene.description && (
                <p className="text-sm text-muted-foreground truncate">{scene.description}</p>
              )}
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(scene.id)}>
                    <Edit3 className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDuplicate(scene.id)}>
                    <Copy className="h-4 w-4 mr-2" />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Play className="h-4 w-4 mr-2" />
                    Preview
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => onDelete(scene.id)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SceneCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-0">
        <Skeleton className="aspect-video w-full rounded-t-lg" />
        <div className="p-4">
          <Skeleton className="h-5 w-32 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function Scenes() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreatingDialog, setIsCreatingDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newSceneName, setNewSceneName] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const scenesRaw = useQuery(api.scenes.list);
  const isLoading = scenesRaw === undefined;

  const createScene = useMutation(api.scenes.create);
  const removeScene = useMutation(api.scenes.remove);
  const duplicateScene = useMutation(api.scenes.duplicate);

  const scenes: SceneDisplay[] = (scenesRaw ?? []).map((s) => ({
    id: s._id as string,
    name: s.name,
    description: s.description ?? "",
    width: s.width ?? 1920,
    height: s.height ?? 1080,
    backgroundColor: s.backgroundColor ?? "transparent",
    widgetCount: (s.widgets ?? []).length,
  }));

  const filteredScenes = scenes.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleEdit = (id: string) => {
    navigate(`/scenes/${id}`);
  };

  const handleDuplicate = (id: string) => {
    duplicateScene({ sceneId: id as Id<"scenes"> });
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (!deletingId) return;
    setIsDeleting(true);
    removeScene({ sceneId: deletingId as Id<"scenes"> })
      .then(() => {
        setDeleteDialogOpen(false);
        setDeletingId(null);
      })
      .finally(() => setIsDeleting(false));
  };

  const handleCreate = () => {
    if (!newSceneName.trim()) return;
    setIsCreating(true);
    createScene({
      name: newSceneName,
      backgroundColor: "transparent",
    })
      .then((newSceneId) => {
        setIsCreatingDialog(false);
        setNewSceneName("");
        navigate(`/scenes/${newSceneId}`);
      })
      .finally(() => setIsCreating(false));
  };

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Scene Editor"
        description="Create and customize HTML overlays for your stream."
        actions={
          <Dialog open={isCreatingDialog} onOpenChange={setIsCreatingDialog}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-scene">
                <Plus className="h-4 w-4 mr-2" />
                New Scene
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Scene</DialogTitle>
                <DialogDescription>
                  Enter a name for your new scene. You can customize it after creation.
                </DialogDescription>
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
                <Button variant="outline" onClick={() => setIsCreatingDialog(false)}>
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
        }
      />

      <div className="flex items-center gap-4 mb-6">
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
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
            <SceneCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredScenes.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No scenes found"
          description={
            scenes.length === 0
              ? "Create your first scene to start building overlays."
              : "Try adjusting your search."
          }
          action={{
            label: "Create Scene",
            onClick: () => setIsCreatingDialog(true),
          }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredScenes.map((scene) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              onEdit={handleEdit}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Scene</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this scene? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
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
