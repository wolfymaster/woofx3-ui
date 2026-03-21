import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import {
  Plus,
  Search,
  MoreHorizontal,
  Trash2,
  Copy,
  Edit3,
  Layers,
  Play,
  Loader2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { queryClient } from '@/lib/queryClient';
import type { Scene, PaginatedResponse, CreateSceneInput } from '@shared/api';

interface SceneCardProps {
  scene: Scene;
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
          style={{ backgroundColor: scene.backgroundColor !== 'transparent' ? scene.backgroundColor : undefined }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          <Layers className="h-12 w-12 text-muted-foreground/30" />
          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
            <Badge variant="secondary" className="text-xs">
              {scene.width}x{scene.height}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {scene.widgets.length} widgets
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
                <p className="text-sm text-muted-foreground truncate">
                  {scene.description}
                </p>
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
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newSceneName, setNewSceneName] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: scenesData, isLoading, error, refetch } = useQuery({
    queryKey: ['scenes'],
    queryFn: (): Promise<PaginatedResponse<Scene>> => Promise.resolve({ data: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0, hasNext: false, hasPrev: false } }),
  });

  const scenes = scenesData?.data || [];

  const createMutation = useMutation({
    mutationFn: (_data: CreateSceneInput): Promise<Scene> => Promise.reject(new Error('Not implemented')),
    onSuccess: (newScene) => {
      queryClient.invalidateQueries({ queryKey: ['scenes'] });
      setIsCreating(false);
      setNewSceneName('');
      navigate(`/scenes/${newScene.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (_id: string): Promise<boolean> => Promise.resolve(false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenes'] });
      setDeleteDialogOpen(false);
      setDeletingId(null);
    },
  });

  const filteredScenes = scenes.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleEdit = (id: string) => {
    navigate(`/scenes/${id}`);
  };

  const handleDuplicate = (id: string) => {
    const scene = scenes.find(s => s.id === id);
    if (scene) {
      createMutation.mutate({
        name: `${scene.name} (Copy)`,
        description: scene.description,
        accountId: scene.accountId,
        width: scene.width,
        height: scene.height,
        backgroundColor: scene.backgroundColor,
        widgets: scene.widgets.map(w => ({ ...w, id: `${w.id}-copy-${Date.now()}` })),
      });
    }
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (deletingId) {
      deleteMutation.mutate(deletingId);
    }
  };

  const handleCreate = () => {
    if (!newSceneName.trim()) return;
    
    createMutation.mutate({
      name: newSceneName,
      accountId: 'account-1',
      width: 1920,
      height: 1080,
      backgroundColor: 'transparent',
      widgets: [],
    });
  };

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Scene Editor"
        description="Create and customize HTML overlays for your stream."
        actions={
          <Dialog open={isCreating} onOpenChange={setIsCreating}>
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
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreating(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleCreate} 
                  disabled={!newSceneName.trim() || createMutation.isPending} 
                  data-testid="button-create-scene"
                >
                  {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
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

      {error ? (
        <ErrorState
          title="Failed to load scenes"
          message="An error occurred while fetching the scenes."
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SceneCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredScenes.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No scenes found"
          description={scenes.length === 0
            ? "Create your first scene to start building overlays."
            : "Try adjusting your search."
          }
          action={{
            label: 'Create Scene',
            onClick: () => setIsCreating(true),
          }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredScenes.map(scene => (
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
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
