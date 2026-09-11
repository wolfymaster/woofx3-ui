import { ChevronRight, FileText, FolderOpen, Image, Loader2, Music, Search, Upload, Video } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useInstance } from "@/hooks/use-instance";
import { useResourceUpload } from "@/hooks/use-resource-upload";
import { type Resource, useResources } from "@/hooks/use-resources";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// Asset picker for config fields that take a media value.
//
// Rebuilt on the engine-backed resource API. The previous version fetched
// `/api/assets` through @tanstack/react-query — a REST surface that has not
// existed since the Convex migration, which made every `type: "asset"` config
// field silently non-functional.

/** What a caller receives on select. Deliberately narrow: config values are
 *  persisted, so only the fields a consumer needs are handed over. */
export interface SelectedAsset {
  id: string;
  name: string;
  url: string;
  /** "image" | "video" | "audio" | "other" */
  type: string;
}

const KIND_ICONS: Record<string, React.ReactNode> = {
  image: <Image className="h-5 w-5" />,
  video: <Video className="h-5 w-5" />,
  audio: <Music className="h-5 w-5" />,
  folder: <FolderOpen className="h-5 w-5" />,
  other: <FileText className="h-5 w-5" />,
};

const SKELETON_KEYS = Array.from({ length: 8 }, (_, i) => `asset-skeleton-${i}`);

interface Crumb {
  id: string | null;
  name: string;
}

export interface AssetLibraryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: SelectedAsset) => void;
  /** Restrict to these resource kinds, e.g. ["image"]. Folders always show so
   *  the tree stays navigable. */
  filterTypes?: string[];
  title?: string;
  description?: string;
}

export function AssetLibraryModal({
  open,
  onOpenChange,
  onSelect,
  filterTypes,
  title = "Select an asset",
  description = "Choose a file from your library or upload a new one.",
}: AssetLibraryModalProps) {
  const { instance } = useInstance();
  const { toast } = useToast();

  const [trail, setTrail] = useState<Crumb[]>([{ id: null, name: "Assets" }]);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Resource | null>(null);
  const [tab, setTab] = useState("library");
  const inputRef = useRef<HTMLInputElement>(null);

  const currentFolderId = trail[trail.length - 1].id;
  const { upload, isUploading, progress } = useResourceUpload(instance?._id);

  const { resources, isLoading, error, refetch } = useResources(instance?._id, {
    folderId: currentFolderId,
    kind: filterTypes?.length === 1 ? filterTypes[0] : undefined,
    search: search || undefined,
    pageSize: 100,
  });

  // Folders are never filtered out — hiding them would strand assets in
  // subfolders behind a filter the user cannot see past.
  const visible = useMemo(() => {
    if (!filterTypes || filterTypes.length === 0) {
      return resources;
    }
    return resources.filter((r) => r.isFolder || filterTypes.includes(r.kind));
  }, [resources, filterTypes]);

  const openResource = useCallback((resource: Resource) => {
    if (resource.isFolder) {
      setTrail((prev) => [...prev, { id: resource.id, name: resource.name }]);
      setPicked(null);
      return;
    }
    // A pending resource has no bytes yet, so its URL would 404.
    if (resource.status === "ready") {
      setPicked(resource);
    }
  }, []);

  const confirm = () => {
    if (!picked?.url) {
      return;
    }
    onSelect({ id: picked.id, name: picked.name, url: picked.url, type: picked.kind });
    onOpenChange(false);
    setPicked(null);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    try {
      const uploaded = await upload(files, currentFolderId);
      refetch();
      setTab("library");
      // Selecting the upload is almost always what was wanted; a thumbnail may
      // not exist yet, but the asset itself is usable immediately.
      const first = uploaded[0];
      if (first) {
        setPicked(first);
      }
    } catch (err: unknown) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {!instance ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Select an instance to browse assets.</p>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="library" data-testid="tab-asset-library">
                Library
              </TabsTrigger>
              <TabsTrigger value="upload" data-testid="tab-asset-upload">
                Upload
              </TabsTrigger>
            </TabsList>

            <TabsContent value="library" className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search assets..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                    data-testid="input-asset-search"
                  />
                </div>
              </div>

              <nav className="flex items-center gap-1 text-xs flex-wrap" aria-label="Folder path">
                {trail.map((crumb, index) => (
                  <span key={crumb.id ?? "root"} className="flex items-center gap-1">
                    {index > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                    {index === trail.length - 1 ? (
                      <span className="font-medium">{crumb.name}</span>
                    ) : (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setTrail(trail.slice(0, index + 1));
                          setPicked(null);
                        }}
                      >
                        {crumb.name}
                      </button>
                    )}
                  </span>
                ))}
              </nav>

              <div className="max-h-[380px] overflow-y-auto">
                {error ? (
                  <div className="py-8 text-center">
                    <p className="text-sm text-destructive mb-2">{error}</p>
                    <Button variant="outline" size="sm" onClick={refetch}>
                      Try again
                    </Button>
                  </div>
                ) : isLoading && resources.length === 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {SKELETON_KEYS.map((key) => (
                      <Skeleton key={key} className="aspect-square w-full rounded-md" />
                    ))}
                  </div>
                ) : visible.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    {search ? "Nothing matches that search." : "This folder is empty."}
                  </p>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {visible.map((resource) => {
                      const preview = resource.thumbnailUrl ?? (resource.kind === "image" ? resource.url : null);
                      const isPicked = picked?.id === resource.id;
                      return (
                        <Card
                          key={resource.id}
                          className={cn(
                            "cursor-pointer hover-elevate overflow-hidden transition-all",
                            isPicked && "ring-2 ring-primary"
                          )}
                          onClick={() => openResource(resource)}
                          data-testid={`asset-option-${resource.id}`}
                        >
                          <CardContent className="p-0">
                            <div className="aspect-square bg-muted/50 flex items-center justify-center overflow-hidden">
                              {preview ? (
                                <img src={preview} alt={resource.name} className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-muted-foreground">
                                  {resource.isFolder
                                    ? KIND_ICONS.folder
                                    : (KIND_ICONS[resource.kind] ?? KIND_ICONS.other)}
                                </span>
                              )}
                            </div>
                            <div className="p-2">
                              <p className="text-xs font-medium truncate" title={resource.name}>
                                {resource.name}
                              </p>
                              {!resource.isFolder && resource.status !== "ready" && (
                                <Badge variant="outline" className="mt-1 text-[10px]">
                                  {resource.status}
                                </Badge>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="upload" className="mt-4">
              <button
                type="button"
                className={cn(
                  "w-full border-2 border-dashed border-border rounded-lg p-10 text-center",
                  isUploading && "opacity-60 pointer-events-none"
                )}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void handleFiles(e.dataTransfer.files);
                }}
                onClick={() => inputRef.current?.click()}
                data-testid="dropzone-asset-upload"
              >
                {isUploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{progress}</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                    <p className="text-sm">Drop a file here, or click to choose</p>
                    <p className="text-xs text-muted-foreground">Uploads into {trail[trail.length - 1].name}</p>
                  </div>
                )}
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => void handleFiles(e.target.files)}
                data-testid="input-asset-upload"
              />
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={!picked?.url} data-testid="button-confirm-asset">
            {picked ? `Select ${picked.name}` : "Select"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
