import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import {
  ChevronRight,
  Copy,
  FileText,
  FolderOpen,
  FolderPlus,
  Grid3X3,
  Image,
  List,
  Loader2,
  MoreHorizontal,
  Music,
  Pencil,
  Search,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
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
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toggle } from "@/components/ui/toggle";
import { useInstance } from "@/hooks/use-instance";
import { useResourceUpload } from "@/hooks/use-resource-upload";
import { type Resource, useResources } from "@/hooks/use-resources";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// Assets are engine-backed: this page proxies to the engine's resource API
// through convex/resources.ts. Bytes go straight from the browser to storage
// via a grant, never through Convex.

const KIND_ICONS: Record<string, React.ReactNode> = {
  image: <Image className="h-5 w-5" />,
  video: <Video className="h-5 w-5" />,
  audio: <Music className="h-5 w-5" />,
  folder: <FolderOpen className="h-5 w-5" />,
  other: <FileText className="h-5 w-5" />,
};

const FILTERABLE_KINDS = ["image", "video", "audio", "other"];
const PAGE_SIZE = 60;

// Stable keys for the loading grid — index keys are fine for a fixed list but
// biome flags them, and a named constant reads better than a suppression.
const SKELETON_KEYS = Array.from({ length: 12 }, (_, i) => `skeleton-${i}`);

function kindIcon(resource: Resource): React.ReactNode {
  if (resource.isFolder) {
    return KIND_ICONS.folder;
  }
  return KIND_ICONS[resource.kind] ?? KIND_ICONS.other;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** One breadcrumb hop. The engine lists a folder's direct children only, so the
 *  trail is accumulated as the user descends rather than fetched. */
interface Crumb {
  id: string | null;
  name: string;
}

interface ResourceCardProps {
  resource: Resource;
  selected: boolean;
  onSelect: (id: string, selected: boolean) => void;
  onOpen: (resource: Resource) => void;
  onRename: (resource: Resource) => void;
  onDelete: (resource: Resource) => void;
}

function ResourceCard({ resource, selected, onSelect, onOpen, onRename, onDelete }: ResourceCardProps) {
  // A thumbnail is generated asynchronously and never exists for audio, so its
  // absence is normal rather than an error — fall back to the kind icon.
  const preview = resource.thumbnailUrl ?? (resource.kind === "image" ? resource.url : null);
  const isPending = !resource.isFolder && resource.status === "pending";

  return (
    <Card
      className={cn(
        "group relative hover-elevate cursor-pointer overflow-visible transition-all",
        selected && "ring-2 ring-primary"
      )}
      onClick={() => onOpen(resource)}
      data-testid={`card-resource-${resource.id}`}
    >
      <button
        type="button"
        className="absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select ${resource.name}`}
      >
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onSelect(resource.id, !!checked)}
          data-testid={`checkbox-resource-${resource.id}`}
        />
      </button>

      <CardContent className="p-0">
        <div className="aspect-square bg-muted/50 flex items-center justify-center overflow-hidden">
          {preview ? (
            <img src={preview} alt={resource.name} className="w-full h-full object-cover" />
          ) : (
            <div className="text-muted-foreground">{kindIcon(resource)}</div>
          )}
        </div>
        <div className="p-3">
          <p
            className="text-sm font-medium truncate"
            title={resource.name}
            data-testid={`text-resource-name-${resource.id}`}
          >
            {resource.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {resource.isFolder ? "Folder" : isPending ? "Uploading…" : formatFileSize(resource.size)}
          </p>
        </div>
      </CardContent>

      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            {resource.url && (
              <DropdownMenuItem onClick={() => navigator.clipboard.writeText(resource.url as string)}>
                <Copy className="h-4 w-4 mr-2" />
                Copy URL
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onRename(resource)}>
              <Pencil className="h-4 w-4 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(resource)}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  );
}

function ResourceCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-0">
        <Skeleton className="aspect-square w-full" />
        <div className="p-3">
          <Skeleton className="h-4 w-3/4 mb-1" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </CardContent>
    </Card>
  );
}

interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: Id<"instances">;
  parentId: string | null;
  onUploaded: () => void;
}

/**
 * Wraps the shared upload hook in a dialog. The grant → PUT → complete
 * sequence lives in useResourceUpload so this page and the asset picker
 * cannot drift apart.
 */
function UploadResourcesModal({ open, onOpenChange, instanceId, parentId, onUploaded }: UploadModalProps) {
  const { toast } = useToast();
  const { upload, isUploading, progress } = useResourceUpload(instanceId);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) {
        return;
      }
      try {
        await upload(files, parentId);
        onOpenChange(false);
      } catch (err: unknown) {
        toast({
          title: "Upload failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      } finally {
        // Even a partial batch changed the listing.
        onUploaded();
      }
    },
    [upload, parentId, onOpenChange, onUploaded, toast]
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !isUploading && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload assets</DialogTitle>
          <DialogDescription>
            Files upload straight to storage. Thumbnails for images and video are generated afterwards and appear once
            ready.
          </DialogDescription>
        </DialogHeader>

        <button
          type="button"
          className={cn(
            "w-full border-2 border-dashed rounded-lg p-8 text-center transition-colors",
            isDragging ? "border-primary bg-primary/5" : "border-border",
            isUploading && "opacity-60 pointer-events-none"
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            void handleFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          data-testid="dropzone-upload"
        >
          {isUploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{progress}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm">Drop files here, or click to choose</p>
            </div>
          )}
        </button>

        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
          data-testid="input-upload-files"
        />
      </DialogContent>
    </Dialog>
  );
}

export default function Assets() {
  const { instance, isLoading: instanceLoading } = useInstance();
  const { toast } = useToast();

  const [trail, setTrail] = useState<Crumb[]>([{ id: null, name: "Assets" }]);
  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [renaming, setRenaming] = useState<Resource | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<Resource | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const currentFolderId = trail[trail.length - 1].id;

  const createFolder = useAction(api.resources.createFolder);
  const updateResource = useAction(api.resources.update);
  const removeResource = useAction(api.resources.remove);

  // The engine filters, searches and pages; nothing here narrows a local array,
  // so search reaches past the current page.
  const { resources, total, isLoading, error, refetch } = useResources(instance?._id, {
    folderId: currentFolderId,
    kind: kindFilter.length === 1 ? kindFilter[0] : undefined,
    search: searchQuery || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  // The engine takes one kind; more than one is narrowed here as a fallback so
  // the multi-select still behaves.
  const visible = useMemo(() => {
    if (kindFilter.length <= 1) {
      return resources;
    }
    return resources.filter((r) => r.isFolder || kindFilter.includes(r.kind));
  }, [resources, kindFilter]);

  const folders = useMemo(() => visible.filter((r) => r.isFolder), [visible]);
  const files = useMemo(() => visible.filter((r) => !r.isFolder), [visible]);

  const resetTo = useCallback((nextTrail: Crumb[]) => {
    setTrail(nextTrail);
    setSelected(new Set());
    setPage(1);
  }, []);

  const openResource = useCallback(
    (resource: Resource) => {
      if (resource.isFolder) {
        resetTo([...trail, { id: resource.id, name: resource.name }]);
        return;
      }
      if (resource.url) {
        window.open(resource.url, "_blank", "noopener,noreferrer");
      }
    },
    [trail, resetTo]
  );

  const toggleSelect = useCallback((id: string, isSelected: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (isSelected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
        refetch();
        return true;
      } catch (err: unknown) {
        toast({
          title: label,
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refetch, toast]
  );

  const handleCreateFolder = async () => {
    if (!instance || !folderName.trim()) {
      return;
    }
    const ok = await run("Couldn't create that folder", () =>
      createFolder({ instanceId: instance._id, name: folderName, parentId: currentFolderId })
    );
    if (ok) {
      setFolderName("");
      setNewFolderOpen(false);
    }
  };

  const handleRename = async () => {
    if (!instance || !renaming || !renameValue.trim()) {
      return;
    }
    const ok = await run("Couldn't rename that", () =>
      updateResource({ instanceId: instance._id, resourceId: renaming.id, name: renameValue })
    );
    if (ok) {
      setRenaming(null);
    }
  };

  const handleDelete = async () => {
    if (!instance || !deleting) {
      return;
    }
    const target = deleting;
    const ok = await run("Couldn't delete that", () =>
      removeResource({ instanceId: instance._id, resourceId: target.id })
    );
    if (ok) {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
      setDeleting(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!instance) {
      return;
    }
    const ids = Array.from(selected);
    // Sequential, not Promise.all: each call is its own single-use capnweb
    // session, and a burst of them is a good way to make the engine the
    // bottleneck for no gain.
    const ok = await run("Some items couldn't be deleted", async () => {
      for (const id of ids) {
        await removeResource({ instanceId: instance._id, resourceId: id });
      }
    });
    if (ok) {
      setSelected(new Set());
      setBulkDeleteOpen(false);
    }
  };

  const handleBulkMove = async (destinationId: string | null) => {
    if (!instance) {
      return;
    }
    const ids = Array.from(selected);
    const ok = await run("Some items couldn't be moved", async () => {
      for (const id of ids) {
        await updateResource({ instanceId: instance._id, resourceId: id, parentId: destinationId });
      }
    });
    if (ok) {
      setSelected(new Set());
    }
  };

  const toggleKind = (kind: string) =>
    setKindFilter((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showSkeletons = instanceLoading || (isLoading && resources.length === 0);

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Assets"
        description="Manage your stream media files and resources."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setNewFolderOpen(true)}
              disabled={!instance}
              data-testid="button-new-folder"
            >
              <FolderPlus className="h-4 w-4 mr-2" />
              New Folder
            </Button>
            <Button onClick={() => setUploadOpen(true)} disabled={!instance} data-testid="button-upload-assets">
              <Upload className="h-4 w-4 mr-2" />
              Upload
            </Button>
          </div>
        }
      />

      {/* Breadcrumbs: accumulated while descending, since the engine lists a
          folder's direct children and never its ancestry. */}
      <nav className="flex items-center gap-1 mb-4 text-sm flex-wrap" aria-label="Folder path">
        {trail.map((crumb, index) => {
          const isLast = index === trail.length - 1;
          return (
            <span key={crumb.id ?? "root"} className="flex items-center gap-1">
              {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              {isLast ? (
                <span className="font-medium" data-testid={`crumb-current`}>
                  {crumb.name}
                </span>
              ) : (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => resetTo(trail.slice(0, index + 1))}
                  data-testid={`crumb-${crumb.id ?? "root"}`}
                >
                  {crumb.name}
                </button>
              )}
            </span>
          );
        })}
      </nav>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search assets..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="pl-9"
              data-testid="input-search-assets"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="button-filter-kind">
                Type
                {kindFilter.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {kindFilter.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Filter by type</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {FILTERABLE_KINDS.map((kind) => (
                <DropdownMenuCheckboxItem
                  key={kind}
                  checked={kindFilter.includes(kind)}
                  onCheckedChange={() => {
                    toggleKind(kind);
                    setPage(1);
                  }}
                  className="capitalize"
                >
                  {kind}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-1">
          <Toggle pressed={viewMode === "grid"} onPressedChange={() => setViewMode("grid")} aria-label="Grid view">
            <Grid3X3 className="h-4 w-4" />
          </Toggle>
          <Toggle pressed={viewMode === "list"} onPressedChange={() => setViewMode("list")} aria-label="List view">
            <List className="h-4 w-4" />
          </Toggle>
        </div>
      </div>

      {selected.size > 0 && (
        <Card className="mb-4 p-3 flex items-center gap-3 flex-wrap" data-testid="bar-bulk-actions">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex items-center gap-2 ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy} data-testid="button-bulk-move">
                  <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                  Move to…
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Move into</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {trail.length > 1 && (
                  <DropdownMenuItem onClick={() => void handleBulkMove(trail[trail.length - 2].id)}>
                    ../ {trail[trail.length - 2].name}
                  </DropdownMenuItem>
                )}
                {folders.length === 0 && trail.length === 1 ? (
                  <DropdownMenuItem disabled>No folders here</DropdownMenuItem>
                ) : (
                  folders
                    .filter((f) => !selected.has(f.id))
                    .map((folder) => (
                      <DropdownMenuItem key={folder.id} onClick={() => void handleBulkMove(folder.id)}>
                        <FolderOpen className="h-4 w-4 mr-2" />
                        {folder.name}
                      </DropdownMenuItem>
                    ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setBulkDeleteOpen(true)}
              disabled={busy}
              data-testid="button-bulk-delete"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </Card>
      )}

      {error ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-destructive mb-3">{error}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </Card>
      ) : showSkeletons ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {SKELETON_KEYS.map((key) => (
            <ResourceCardSkeleton key={key} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card className="p-12 text-center">
          <FolderOpen className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">
            {searchQuery || kindFilter.length > 0 ? "Nothing matches those filters." : "This folder is empty."}
          </p>
        </Card>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {[...folders, ...files].map((resource) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              selected={selected.has(resource.id)}
              onSelect={toggleSelect}
              onOpen={openResource}
              onRename={(r) => {
                setRenaming(r);
                setRenameValue(r.name);
              }}
              onDelete={setDeleting}
            />
          ))}
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...folders, ...files].map((resource) => (
                <TableRow key={resource.id} className="hover-elevate">
                  <TableCell>
                    <Checkbox
                      checked={selected.has(resource.id)}
                      onCheckedChange={(checked) => toggleSelect(resource.id, !!checked)}
                    />
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="flex items-center gap-3 text-left"
                      onClick={() => openResource(resource)}
                    >
                      <span className="h-8 w-8 rounded bg-muted flex items-center justify-center text-muted-foreground">
                        {kindIcon(resource)}
                      </span>
                      <span className="font-medium">{resource.name}</span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {resource.isFolder ? "folder" : resource.kind}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {resource.isFolder ? "—" : formatFileSize(resource.size)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(resource.createdAt)}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {resource.url && (
                          <DropdownMenuItem onClick={() => navigator.clipboard.writeText(resource.url as string)}>
                            <Copy className="h-4 w-4 mr-2" />
                            Copy URL
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => {
                            setRenaming(resource);
                            setRenameValue(resource.name);
                          }}
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleting(resource)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}

      {instance && (
        <UploadResourcesModal
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          instanceId={instance._id}
          parentId={currentFolderId}
          onUploaded={refetch}
        />
      )}

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>Created inside {trail[trail.length - 1].name}.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="folder-name">Name</Label>
            <Input
              id="folder-name"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreateFolder();
                }
              }}
              data-testid="input-folder-name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreateFolder()} disabled={busy || !folderName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
            <DialogDescription>{renaming?.isFolder ? "Rename this folder." : "Rename this file."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="rename-value">Name</Label>
            <Input
              id="rename-value"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleRename();
                }
              }}
              data-testid="input-rename-value"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button onClick={() => void handleRename()} disabled={busy || !renameValue.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.isFolder ? "folder" : "asset"}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.isFolder
                ? `"${deleting?.name}" and everything inside it will be deleted. This cannot be undone.`
                : `"${deleting?.name}" will be permanently deleted. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} items</AlertDialogTitle>
            <AlertDialogDescription>
              Selected files and folders will be permanently deleted, along with anything inside those folders. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleBulkDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
