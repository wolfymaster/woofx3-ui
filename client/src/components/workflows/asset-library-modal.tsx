import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Search,
  Filter,
  Grid3X3,
  List,
  Upload,
  Image,
  Video,
  Music,
  FileText,
  Check,
  X,
  Loader2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Toggle } from '@/components/ui/toggle';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { queryClient, apiRequest } from '@/lib/queryClient';
import type { Asset, PaginatedResponse } from '@/types';

const typeIcons: Record<string, React.ReactNode> = {
  image: <Image className="h-5 w-5" />,
  video: <Video className="h-5 w-5" />,
  audio: <Music className="h-5 w-5" />,
  font: <FileText className="h-5 w-5" />,
  other: <FileText className="h-5 w-5" />,
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getFileType(file: File): string {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.includes('font')) return 'font';
  return 'other';
}

interface AssetCardProps {
  asset: Asset;
  selected: boolean;
  onSelect: (asset: Asset) => void;
}

function AssetCard({ asset, selected, onSelect }: AssetCardProps) {
  const Icon = typeIcons[asset.type];

  return (
    <Card
      className={cn(
        'group relative hover-elevate cursor-pointer overflow-visible transition-all',
        selected && 'ring-2 ring-primary'
      )}
      onClick={() => onSelect(asset)}
      data-testid={`card-asset-select-${asset.id}`}
    >
      {selected && (
        <div className="absolute top-2 left-2 z-10 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
          <Check className="h-3 w-3 text-primary-foreground" />
        </div>
      )}
      <CardContent className="p-0">
        <div className="aspect-square bg-muted/50 flex items-center justify-center">
          {asset.type === 'image' ? (
            <div className="w-full h-full bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
              <Image className="h-12 w-12 text-muted-foreground/50" />
            </div>
          ) : (
            <div className="text-muted-foreground">{Icon}</div>
          )}
        </div>
        <div className="p-3">
          <p className="text-sm font-medium truncate" title={asset.name}>
            {asset.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatFileSize(asset.size)}
          </p>
        </div>
      </CardContent>
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

interface UploadZoneProps {
  onUpload: (files: FileList) => void;
  isUploading: boolean;
  uploadProgress: number;
  acceptTypes?: string;
  uploadError?: string | null;
}

function UploadZone({ onUpload, isUploading, uploadProgress, acceptTypes, uploadError }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      onUpload(e.dataTransfer.files);
    }
  }, [onUpload]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files);
    }
  }, [onUpload]);

  if (isUploading) {
    return (
      <div className="border-2 border-dashed rounded-lg p-8 text-center border-primary/50 bg-primary/5">
        <Loader2 className="h-10 w-10 mx-auto mb-4 text-primary animate-spin" />
        <p className="text-sm font-medium mb-2">Uploading...</p>
        <Progress value={uploadProgress} className="h-2 max-w-xs mx-auto" />
        <p className="text-xs text-muted-foreground mt-2">{uploadProgress}%</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
        isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid="zone-upload-modal"
    >
      <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
      <p className="text-sm font-medium mb-1">Drag and drop files here</p>
      <p className="text-xs text-muted-foreground mb-4">or click the button below to browse</p>
      {uploadError && (
        <p className="text-xs text-destructive mb-4">{uploadError}</p>
      )}
      <label>
        <input
          type="file"
          className="hidden"
          onChange={handleFileSelect}
          accept={acceptTypes}
        />
        <Button variant="outline" size="sm" asChild>
          <span>
            <Upload className="h-4 w-4 mr-2" />
            Browse Files
          </span>
        </Button>
      </label>
    </div>
  );
}

interface AssetLibraryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: Asset) => void;
  filterTypes?: string[];
  title?: string;
  description?: string;
}

export function AssetLibraryModal({
  open,
  onOpenChange,
  onSelect,
  filterTypes,
  title = 'Select Asset',
  description = 'Choose an existing asset or upload a new one.',
}: AssetLibraryModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [typeFilter, setTypeFilter] = useState<string[]>(filterTypes || []);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'browse' | 'upload'>('browse');

  const resetState = useCallback(() => {
    setSelectedAsset(null);
    setSearchQuery('');
    setActiveTab('browse');
    setIsUploading(false);
    setUploadProgress(0);
    setUploadError(null);
    setTypeFilter(filterTypes || []);
  }, [filterTypes]);

  const { data: assetsData, isLoading } = useQuery<PaginatedResponse<Asset>>({
    queryKey: ['/api/assets'],
    enabled: open,
  });

  const assets = assetsData?.data || [];

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const assetData = {
        name: file.name,
        type: getFileType(file),
        mimeType: file.type,
        size: file.size,
        tags: [],
      };
      return apiRequest('POST', '/api/assets', assetData);
    },
    onSuccess: async (response) => {
      const newAsset = await response.json();
      queryClient.invalidateQueries({ queryKey: ['/api/assets'] });
      setSelectedAsset(newAsset);
      setActiveTab('browse');
      setIsUploading(false);
      setUploadProgress(100);
      setUploadError(null);
    },
    onError: (error) => {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadError(error instanceof Error ? error.message : 'Upload failed. Please try again.');
    },
  });

  const filteredAssets = useMemo(() => {
    let result = assets;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(a =>
        a.name.toLowerCase().includes(query) ||
        a.tags.some(t => t.toLowerCase().includes(query))
      );
    }

    if (typeFilter.length > 0) {
      result = result.filter(a => typeFilter.includes(a.type));
    }

    return result;
  }, [assets, searchQuery, typeFilter]);

  const handleUpload = useCallback((files: FileList) => {
    if (files.length === 0) return;
    setIsUploading(true);
    setUploadProgress(0);

    const interval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
        return prev + 10;
      });
    }, 100);

    const file = files[0];
    uploadMutation.mutate(file, {
      onSettled: () => {
        clearInterval(interval);
        setUploadProgress(100);
      },
    });
  }, [uploadMutation]);

  const toggleTypeFilter = useCallback((type: string) => {
    setTypeFilter(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  }, []);

  const handleConfirm = () => {
    if (selectedAsset) {
      onSelect(selectedAsset);
      onOpenChange(false);
      resetState();
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    resetState();
  };

  const allTypes = ['image', 'video', 'audio', 'font', 'other'];
  const acceptTypes = filterTypes?.map(t => {
    switch (t) {
      case 'image': return 'image/*';
      case 'video': return 'video/*';
      case 'audio': return 'audio/*';
      default: return '*/*';
    }
  }).join(',');

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'browse' | 'upload')} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="browse" data-testid="tab-browse">Browse Library</TabsTrigger>
            <TabsTrigger value="upload" data-testid="tab-upload">Upload New</TabsTrigger>
          </TabsList>

          <TabsContent value="browse" className="flex-1 flex flex-col min-h-0 mt-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search assets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-modal-assets"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" data-testid="button-filter-modal-assets">
                    <Filter className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>File Type</DropdownMenuLabel>
                  {allTypes.map(type => (
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
              <div className="flex items-center border rounded-md">
                <Toggle
                  pressed={viewMode === 'grid'}
                  onPressedChange={() => setViewMode('grid')}
                  size="sm"
                  className="rounded-r-none"
                >
                  <Grid3X3 className="h-4 w-4" />
                </Toggle>
                <Toggle
                  pressed={viewMode === 'list'}
                  onPressedChange={() => setViewMode('list')}
                  size="sm"
                  className="rounded-l-none"
                >
                  <List className="h-4 w-4" />
                </Toggle>
              </div>
            </div>

            <ScrollArea className="flex-1">
              {isLoading ? (
                <div className="grid grid-cols-4 gap-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <AssetCardSkeleton key={i} />
                  ))}
                </div>
              ) : filteredAssets.length === 0 ? (
                <div className="text-center py-12">
                  <Image className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-sm text-muted-foreground">
                    {assets.length === 0 ? 'No assets yet. Upload your first file!' : 'No matching assets found.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-3">
                  {filteredAssets.map(asset => (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      selected={selectedAsset?.id === asset.id}
                      onSelect={setSelectedAsset}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="upload" className="flex-1 flex flex-col mt-4">
            <UploadZone
              onUpload={handleUpload}
              isUploading={isUploading}
              uploadProgress={uploadProgress}
              acceptTypes={acceptTypes}
              uploadError={uploadError}
            />
            <p className="text-xs text-muted-foreground text-center mt-4">
              Supported formats: Images, Videos, Audio files, Fonts
            </p>
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} data-testid="button-cancel-asset">
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedAsset}
            data-testid="button-select-asset"
          >
            {selectedAsset ? `Select "${selectedAsset.name}"` : 'Select Asset'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
