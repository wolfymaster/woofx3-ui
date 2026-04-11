import { useState, useMemo, useCallback, useRef } from 'react';
import { useQuery, useMutation, useAction } from 'convex/react';
import {
  Search,
  Filter,
  Grid3X3,
  List,
  Upload,
  FolderPlus,
  MoreHorizontal,
  Image,
  Video,
  Music,
  FileText,
  Trash2,
  Download,
  Copy,
  FolderOpen,
  SortAsc,
  SortDesc,
  Loader2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Toggle } from '@/components/ui/toggle';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { cn } from '@/lib/utils';
import { api } from '@convex/_generated/api';
import { useInstance } from '@/hooks/use-instance';
import type { Id } from '@convex/_generated/dataModel';

type AssetUploadIntent = {
  uploadUrl: string;
  method: 'PUT' | 'POST';
  headers?: Record<string, string>;
  fileKey: string;
  provider: 'convex' | 'r2' | 'local';
  requiresResponseKey: boolean;
};

type ConvexAsset = {
  _id: Id<'assets'>;
  name: string;
  type: 'image' | 'audio' | 'video';
  mimeType: string;
  size: number;
  url: string | null;
  createdAt: number;
  instanceId: Id<'instances'>;
  storageId: Id<'_storage'>;
  createdBy: Id<'users'>;
};

const typeIcons: Record<string, React.ReactNode> = {
  image: <Image className="h-5 w-5" />,
  video: <Video className="h-5 w-5" />,
  audio: <Music className="h-5 w-5" />,
  other: <FileText className="h-5 w-5" />,
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface AssetCardProps {
  asset: ConvexAsset;
  selected: boolean;
  onSelect: (id: string, selected: boolean) => void;
  onDelete: (id: Id<'assets'>) => void;
}

function AssetCard({ asset, selected, onSelect, onDelete }: AssetCardProps) {
  const Icon = typeIcons[asset.type] ?? typeIcons.other;

  return (
    <Card
      className={cn(
        'group relative hover-elevate cursor-pointer overflow-visible transition-all',
        selected && 'ring-2 ring-primary'
      )}
      data-testid={`card-asset-${asset._id}`}
    >
      <div
        className="absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onSelect(asset._id, !!checked)}
          data-testid={`checkbox-asset-${asset._id}`}
        />
      </div>
      <CardContent className="p-0">
        <div className="aspect-square bg-muted/50 flex items-center justify-center">
          {asset.type === 'image' && asset.url ? (
            <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
          ) : (
            <div className="text-muted-foreground">{Icon}</div>
          )}
        </div>
        <div className="p-3">
          <p className="text-sm font-medium truncate" title={asset.name} data-testid={`text-asset-name-${asset._id}`}>
            {asset.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatFileSize(asset.size)}
          </p>
        </div>
      </CardContent>
      <div
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon" className="h-7 w-7">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {asset.url && (
              <DropdownMenuItem onClick={() => navigator.clipboard.writeText(asset.url!)}>
                <Copy className="h-4 w-4 mr-2" />
                Copy URL
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(asset._id)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  );
}

function AssetCardSkeleton() {
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

function UploadAssetsModal({
  open,
  onOpenChange,
  instanceId,
  generateUploadIntent,
  createAsset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: Id<'instances'>;
  generateUploadIntent: (args: {
    instanceId: Id<'instances'>;
    fileName: string;
    mimeType: string;
  }) => Promise<AssetUploadIntent>;
  createAsset: (args: {
    instanceId: Id<'instances'>;
    name: string;
    type: 'image' | 'audio' | 'video';
    fileKey: string;
    storageProvider: 'convex' | 'r2' | 'local';
    mimeType: string;
    size: number;
    folderId?: Id<'folders'>;
  }) => Promise<Id<'assets'>>;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState('');

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setIsUploading(true);
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setProgress(`Uploading ${file.name} (${i + 1}/${files.length})...`);

          const intent = await generateUploadIntent({
            instanceId,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
          });

          const headers = new Headers(intent.headers);
          if (file.type && !headers.has('Content-Type')) {
            headers.set('Content-Type', file.type);
          }

          const result = await fetch(intent.uploadUrl, {
            method: intent.method,
            headers,
            body: file,
          });

          if (!result.ok) {
            throw new Error(`Upload failed: ${result.statusText}`);
          }

          let fileKey = intent.fileKey;
          if (intent.requiresResponseKey) {
            const body = (await result.json()) as { storageId: string };
            fileKey = body.storageId;
          }

          const type = file.type.startsWith('image/')
            ? 'image'
            : file.type.startsWith('audio/')
            ? 'audio'
            : 'video';

          await createAsset({
            instanceId,
            name: file.name,
            type,
            fileKey,
            storageProvider: intent.provider,
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
          });
        }
        onOpenChange(false);
      } catch (err) {
        console.error('Upload failed:', err);
        alert('Upload failed. Please try again.');
      } finally {
        setIsUploading(false);
        setProgress('');
      }
    },
    [instanceId, generateUploadIntent, createAsset, onOpenChange],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Upload Assets</DialogTitle>
          <DialogDescription>
            Upload image, audio, or video files to your asset library.
          </DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            'border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
            isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50',
          )}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
          onDrop={handleDrop}
          data-testid="zone-upload-assets-modal"
        >
          <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
          <p className="text-sm font-medium mb-1">Drag and drop files here</p>
          <p className="text-xs text-muted-foreground mb-4">or click to browse</p>
          <label>
            <input
              type="file"
              className="hidden"
              accept="image/*,video/*,audio/*"
              multiple
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button variant="outline" size="sm" asChild>
              <span>
                <Upload className="h-4 w-4 mr-2" />
                Browse Files
              </span>
            </Button>
          </label>
        </div>

        {isUploading && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {progress}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Assets() {
  const { instance, isLoading: instanceLoading } = useInstance();
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<Id<'assets'> | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  const assetsRaw = useQuery(
    api.assets.list,
    instance ? { instanceId: instance._id } : 'skip'
  ) as ConvexAsset[] | undefined;

  const assets = assetsRaw ?? [];
  const isLoading = instanceLoading || assetsRaw === undefined;

  const removeAsset = useMutation(api.assets.remove);
  const generateUploadIntent = useAction(api.assets.generateUploadIntent);
  const createAsset = useMutation(api.assets.create);

  const filteredAssets = useMemo(() => {
    let result = assets;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((a) => a.name.toLowerCase().includes(query));
    }

    if (typeFilter.length > 0) {
      result = result.filter((a) => typeFilter.includes(a.type));
    }

    result = [...result].sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'date') {
        comparison = a.createdAt - b.createdAt;
      } else if (sortBy === 'size') {
        comparison = a.size - b.size;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [assets, searchQuery, typeFilter, sortBy, sortOrder]);

  const handleSelect = useCallback((id: string, selected: boolean) => {
    setSelectedAssets((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedAssets.size === filteredAssets.length) {
      setSelectedAssets(new Set());
    } else {
      setSelectedAssets(new Set(filteredAssets.map((a) => a._id)));
    }
  }, [filteredAssets, selectedAssets]);

  const handleDelete = useCallback((id: Id<'assets'>) => {
    setDeletingId(id);
    setDeleteDialogOpen(true);
  }, []);

  const [isDeleting, setIsDeleting] = useState(false);
  const confirmDelete = async () => {
    if (!deletingId) return;
    setIsDeleting(true);
    try {
      await removeAsset({ assetId: deletingId });
      setSelectedAssets((prev) => {
        const next = new Set(prev);
        next.delete(deletingId);
        return next;
      });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setDeletingId(null);
    }
  };

  const toggleTypeFilter = useCallback((type: string) => {
    setTypeFilter((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }, []);

  const totalSize = assets.reduce((sum, a) => sum + a.size, 0);
  const allTypes = ['image', 'video', 'audio'];

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Assets"
        description="Manage your stream media files and resources."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" data-testid="button-new-folder">
              <FolderPlus className="h-4 w-4 mr-2" />
              New Folder
            </Button>
            <Button onClick={() => setUploadModalOpen(true)} data-testid="button-upload-assets" disabled={!instance}>
              <Upload className="h-4 w-4 mr-2" />
              Upload
            </Button>
          </div>
        }
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search assets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-assets"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" data-testid="button-filter-assets">
                <Filter className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>File Type</DropdownMenuLabel>
              {allTypes.map((type) => (
                <DropdownMenuCheckboxItem
                  key={type}
                  checked={typeFilter.includes(type)}
                  onCheckedChange={() => toggleTypeFilter(type)}
                >
                  <span className="flex items-center gap-2 capitalize">
                    {typeIcons[type]}
                    {type}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="w-28" data-testid="select-sort-assets">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="date">Date</SelectItem>
              <SelectItem value="size">Size</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
            data-testid="button-sort-order"
          >
            {sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />}
          </Button>
          <div className="flex items-center border rounded-md">
            <Toggle
              pressed={viewMode === 'grid'}
              onPressedChange={() => setViewMode('grid')}
              size="sm"
              className="rounded-r-none"
              data-testid="button-view-grid"
            >
              <Grid3X3 className="h-4 w-4" />
            </Toggle>
            <Toggle
              pressed={viewMode === 'list'}
              onPressedChange={() => setViewMode('list')}
              size="sm"
              className="rounded-l-none"
              data-testid="button-view-list"
            >
              <List className="h-4 w-4" />
            </Toggle>
          </div>
        </div>
      </div>

      {selectedAssets.size > 0 && (
        <Card className="mb-4">
          <CardContent className="py-3 flex items-center justify-between">
            <span className="text-sm">
              <span className="font-medium">{selectedAssets.size}</span> items selected
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelectedAssets(new Set())}>
                Clear Selection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-muted-foreground">
          {isLoading ? (
            <Skeleton className="h-4 w-32" />
          ) : (
            <span>{filteredAssets.length} files · {formatFileSize(totalSize)} total</span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={handleSelectAll} disabled={isLoading}>
          {selectedAssets.size === filteredAssets.length ? 'Deselect All' : 'Select All'}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <AssetCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredAssets.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No assets found"
          description={
            assets.length === 0
              ? 'Upload your first file to get started.'
              : 'Try adjusting your search or filters.'
          }
          action={{
            label: 'Upload Files',
            onClick: () => setUploadModalOpen(true),
          }}
        />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filteredAssets.map((asset) => (
            <AssetCard
              key={asset._id}
              asset={asset}
              selected={selectedAssets.has(asset._id)}
              onSelect={handleSelect}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={selectedAssets.size === filteredAssets.length && filteredAssets.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAssets.map((asset) => (
                <TableRow key={asset._id} className="hover-elevate">
                  <TableCell>
                    <Checkbox
                      checked={selectedAssets.has(asset._id)}
                      onCheckedChange={(checked) => handleSelect(asset._id, !!checked)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-muted-foreground">
                        {typeIcons[asset.type] ?? typeIcons.other}
                      </div>
                      <span className="font-medium">{asset.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{asset.type}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatFileSize(asset.size)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(asset.createdAt)}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {asset.url && (
                          <DropdownMenuItem onClick={() => navigator.clipboard.writeText(asset.url!)}>
                            <Copy className="h-4 w-4 mr-2" />
                            Copy URL
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => handleDelete(asset._id)}
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

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Asset</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this asset? This action cannot be undone.
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

      {instance && (
        <UploadAssetsModal
          open={uploadModalOpen}
          onOpenChange={setUploadModalOpen}
          instanceId={instance._id}
          generateUploadIntent={generateUploadIntent}
          createAsset={createAsset}
        />
      )}
    </div>
  );
}
