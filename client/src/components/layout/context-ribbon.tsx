import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, 
  Upload, 
  Filter, 
  Grid, 
  List, 
  Search,
  Play,
  Pause,
  RotateCcw,
  Download,
  Copy,
  Trash2,
  FolderPlus,
  SortAsc,
  RefreshCw,
  Layers,
  Square,
  Circle,
  Type,
  Image,
  Move,
  Maximize,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Sparkles,
  Zap,
  GitBranch,
  Save,
  FileCode,
  Bug,
  Activity,
  Clock,
  BarChart3
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface RibbonAction {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost';
  disabled?: boolean;
}

interface RibbonGroup {
  id: string;
  label: string;
  actions: RibbonAction[];
}

function RibbonButton({ action }: { action: RibbonAction }) {
  const Icon = action.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={action.variant || 'ghost'}
          size="sm"
          className="h-8 px-2 gap-1.5"
          onClick={action.onClick}
          disabled={action.disabled}
          data-testid={`ribbon-action-${action.id}`}
        >
          <Icon className="h-4 w-4" />
          <span className="text-xs hidden lg:inline">{action.label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{action.label}</TooltipContent>
    </Tooltip>
  );
}

function RibbonGroupComponent({ group }: { group: RibbonGroup }) {
  return (
    <div className="flex items-center gap-1">
      {group.actions.map((action) => (
        <RibbonButton key={action.id} action={action} />
      ))}
    </div>
  );
}

function DashboardRibbon() {
  const [timeRange, setTimeRange] = useState('24h');
  
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-center gap-3 px-4 py-2 bg-card/50 border-b border-border"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Time Range</span>
        <ToggleGroup type="single" value={timeRange} onValueChange={(v) => v && setTimeRange(v)} size="sm">
          <ToggleGroupItem value="1h" className="text-xs h-7 px-2">1H</ToggleGroupItem>
          <ToggleGroupItem value="24h" className="text-xs h-7 px-2">24H</ToggleGroupItem>
          <ToggleGroupItem value="7d" className="text-xs h-7 px-2">7D</ToggleGroupItem>
          <ToggleGroupItem value="30d" className="text-xs h-7 px-2">30D</ToggleGroupItem>
        </ToggleGroup>
      </div>
      
      <Separator orientation="vertical" className="h-6" />
      
      <RibbonButton action={{ id: 'refresh', label: 'Refresh', icon: RefreshCw }} />
      <RibbonButton action={{ id: 'activity', label: 'Activity Log', icon: Activity }} />
      <RibbonButton action={{ id: 'analytics', label: 'Analytics', icon: BarChart3 }} />
    </motion.div>
  );
}

function ModulesRibbon() {
  const [viewMode, setViewMode] = useState('grid');
  
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-center gap-3 px-4 py-2 bg-card/50 border-b border-border"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">View</span>
        <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v)} size="sm">
          <ToggleGroupItem value="grid" className="h-7 px-2">
            <Grid className="h-3.5 w-3.5" />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" className="h-7 px-2">
            <List className="h-3.5 w-3.5" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      
      <Separator orientation="vertical" className="h-6" />
      
      <RibbonButton action={{ id: 'filter', label: 'Filter', icon: Filter }} />
      <RibbonButton action={{ id: 'sort', label: 'Sort', icon: SortAsc }} />
      <RibbonButton action={{ id: 'refresh', label: 'Refresh', icon: RefreshCw }} />
      
      <Separator orientation="vertical" className="h-6" />
      
      <RibbonButton action={{ id: 'install', label: 'Browse Store', icon: Sparkles, variant: 'secondary' }} />
    </motion.div>
  );
}

function WorkflowsRibbon() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-center gap-3 px-4 py-2 bg-card/50 border-b border-border"
    >
      <RibbonButton action={{ id: 'new', label: 'New Workflow', icon: Plus, variant: 'default' }} />
      
      <Separator orientation="vertical" className="h-6" />
      
      <RibbonButton action={{ id: 'run-all', label: 'Run All', icon: Play }} />
      <RibbonButton action={{ id: 'pause-all', label: 'Pause All', icon: Pause }} />
      
      <Separator orientation="vertical" className="h-6" />
      
      <RibbonButton action={{ id: 'import', label: 'Import', icon: Download }} />
      <RibbonButton action={{ id: 'export', label: 'Export', icon: Upload }} />
      
      <Separator orientation="vertical" className="h-6" />
      
      <RibbonButton action={{ id: 'debug', label: 'Debug Mode', icon: Bug }} />
      <RibbonButton action={{ id: 'history', label: 'Run History', icon: Clock }} />
    </motion.div>
  );
}

function WorkflowBuilderRibbon() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-center gap-3 px-4 py-2 bg-card/50 border-b border-border"
    >
      <RibbonButton action={{ id: 'save', label: 'Save', icon: Save, variant: 'default' }} />
      
      <Separator orientation="vertical" className="h-6" />
      
      <RibbonButton action={{ id: 'undo', label: 'Undo', icon: RotateCcw }} />
      <RibbonButton action={{ id: 'redo', label: 'Redo', icon: RotateCcw, disabled: true }} />
      
      <Separator orientation="vertical" className="h-6" />
      
      <RibbonButton action={{ id: 'run', label: 'Run', icon: Play }} />
      <RibbonButton action={{ id: 'debug', label: 'Debug', icon: Bug }} />
      
      <Separator orientation="vertical" className="h-6" />
      
      <RibbonButton action={{ id: 'add-trigger', label: 'Add Trigger', icon: Zap }} />
      <RibbonButton action={{ id: 'add-action', label: 'Add Action', icon: GitBranch }} />
      
      <Separator orientation="vertical" className="h-6" />
      
      <RibbonButton action={{ id: 'code-view', label: 'Code View', icon: FileCode }} />
    </motion.div>
  );
}

function AssetsRibbon() {
  const [viewMode, setViewMode] = useState('grid');
  
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-center gap-3 px-4 py-2 bg-card/50 border-b border-border"
    >
      <RibbonButton action={{ id: 'upload', label: 'Upload', icon: Upload, variant: 'default' }} />
      <RibbonButton action={{ id: 'new-folder', label: 'New Folder', icon: FolderPlus }} />
      
      <Separator orientation="vertical" className="h-6" />
      
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">View</span>
        <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v)} size="sm">
          <ToggleGroupItem value="grid" className="h-7 px-2">
            <Grid className="h-3.5 w-3.5" />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" className="h-7 px-2">
            <List className="h-3.5 w-3.5" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      
      <Separator orientation="vertical" className="h-6" />
      
      <RibbonButton action={{ id: 'filter', label: 'Filter', icon: Filter }} />
      <RibbonButton action={{ id: 'sort', label: 'Sort', icon: SortAsc }} />
      
      <Separator orientation="vertical" className="h-6" />
      
      <RibbonButton action={{ id: 'copy', label: 'Copy', icon: Copy, disabled: true }} />
      <RibbonButton action={{ id: 'delete', label: 'Delete', icon: Trash2, variant: 'ghost', disabled: true }} />
    </motion.div>
  );
}

function ScenesRibbon() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-center gap-3 px-4 py-2 bg-card/50 border-b border-border"
    >
      <RibbonButton action={{ id: 'new', label: 'New Scene', icon: Plus, variant: 'default' }} />
      
      <Separator orientation="vertical" className="h-6" />
      
      <RibbonButton action={{ id: 'preview', label: 'Preview', icon: Eye }} />
      <RibbonButton action={{ id: 'duplicate', label: 'Duplicate', icon: Copy }} />
      
      <Separator orientation="vertical" className="h-6" />
      
      <RibbonButton action={{ id: 'import', label: 'Import', icon: Download }} />
      <RibbonButton action={{ id: 'export', label: 'Export', icon: Upload }} />
    </motion.div>
  );
}

function SceneEditorRibbon() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-center gap-3 px-4 py-2 bg-card/50 border-b border-border"
    >
      <RibbonButton action={{ id: 'save', label: 'Save', icon: Save, variant: 'default' }} />
      
      <Separator orientation="vertical" className="h-6" />
      
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Add</span>
      <RibbonButton action={{ id: 'add-text', label: 'Text', icon: Type }} />
      <RibbonButton action={{ id: 'add-image', label: 'Image', icon: Image }} />
      <RibbonButton action={{ id: 'add-rect', label: 'Rectangle', icon: Square }} />
      <RibbonButton action={{ id: 'add-circle', label: 'Circle', icon: Circle }} />
      
      <Separator orientation="vertical" className="h-6" />
      
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tools</span>
      <RibbonButton action={{ id: 'select', label: 'Select', icon: Move }} />
      <RibbonButton action={{ id: 'transform', label: 'Transform', icon: Maximize }} />
      
      <Separator orientation="vertical" className="h-6" />
      
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Align</span>
      <RibbonButton action={{ id: 'align-left', label: 'Left', icon: AlignLeft }} />
      <RibbonButton action={{ id: 'align-center', label: 'Center', icon: AlignCenter }} />
      <RibbonButton action={{ id: 'align-right', label: 'Right', icon: AlignRight }} />
      
      <Separator orientation="vertical" className="h-6" />
      
      <RibbonButton action={{ id: 'lock', label: 'Lock', icon: Lock }} />
      <RibbonButton action={{ id: 'visibility', label: 'Visibility', icon: Eye }} />
      <RibbonButton action={{ id: 'layers', label: 'Layers', icon: Layers }} />
    </motion.div>
  );
}

export function ContextRibbon() {
  const [location] = useLocation();
  
  const getRibbonForRoute = () => {
    if (location === '/') return <DashboardRibbon />;
    if (location === '/modules' || location === '/modules/installed') return <ModulesRibbon />;
    if (location === '/workflows') return <WorkflowsRibbon />;
    if (location.startsWith('/workflows/')) return <WorkflowBuilderRibbon />;
    if (location === '/assets') return <AssetsRibbon />;
    if (location === '/scenes') return <ScenesRibbon />;
    if (location.startsWith('/scenes/')) return <SceneEditorRibbon />;
    return null;
  };

  return (
    <AnimatePresence mode="wait">
      {getRibbonForRoute()}
    </AnimatePresence>
  );
}
