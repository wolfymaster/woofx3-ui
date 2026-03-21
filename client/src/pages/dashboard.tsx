import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation } from 'convex/react';
import {
  GripVertical,
  Plus,
  RotateCcw,
  Maximize2,
  Minimize2,
  X,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { api } from '@convex/_generated/api';
import { useInstance } from '@/hooks/use-instance';
import { ChatModule } from '@/components/dashboard/chat-module';
import { WorkflowRunsModule } from '@/components/dashboard/workflow-runs-module';
import { EventFeedModule } from '@/components/dashboard/event-feed-module';
import { MacroPadModule } from '@/components/dashboard/macro-pad-module';
import type { DashboardModule } from '@shared/api';

// Registry of available module components
const moduleComponents: Record<string, React.ComponentType<{ config?: Record<string, unknown>; onConfigChange?: (config: Record<string, unknown>) => void }>> = {
  'chat': ChatModule,
  'workflow-runs': WorkflowRunsModule,
  'event-feed': EventFeedModule,
  'macro-pad': MacroPadModule,
};

const moduleLabels: Record<string, string> = {
  'chat': 'Chat Client',
  'workflow-runs': 'Workflow Runs',
  'event-feed': 'Event Feed',
  'macro-pad': 'Macro Pad',
};

const defaultModules: DashboardModule[] = [
  { id: 'mod-1', type: 'chat', title: 'Chat Client' },
  { id: 'mod-2', type: 'workflow-runs', title: 'Workflow Runs' },
  { id: 'mod-3', type: 'event-feed', title: 'Event Feed' },
];

interface ModulePanelProps {
  module: DashboardModule;
  onRemove: (id: string) => void;
  isMaximized: boolean;
  onToggleMaximize: (id: string) => void;
  onConfigChange?: (moduleId: string, config: Record<string, unknown>) => void;
}

function ModulePanel({ module, onRemove, isMaximized, onToggleMaximize, onConfigChange }: ModulePanelProps) {
  const Component = moduleComponents[module.type];

  if (!Component) {
    return (
      <Card className="h-full flex flex-col overflow-hidden" data-testid={`panel-${module.id}`}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          Unknown module type: {module.type}
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col overflow-hidden" data-testid={`panel-${module.id}`}>
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
          <span className="text-xs font-medium text-muted-foreground">{module.title}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onToggleMaximize(module.id)}
          >
            {isMaximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(module.id)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <Component 
          config={module.config} 
          onConfigChange={onConfigChange ? (config) => onConfigChange(module.id, config) : undefined}
        />
      </div>
    </Card>
  );
}

function ResizeHandle({ direction = 'horizontal' }: { direction?: 'horizontal' | 'vertical' }) {
  return (
    <PanelResizeHandle 
      className={cn(
        "relative flex items-center justify-center group",
        "data-[resize-handle-state=hover]:bg-primary/10",
        "data-[resize-handle-state=drag]:bg-primary/20",
        "transition-colors",
        direction === 'horizontal' ? "w-2 mx-0.5 cursor-col-resize" : "h-2 my-0.5 cursor-row-resize"
      )}
    >
      <div className={cn(
        "rounded-full bg-border group-hover:bg-primary/50 transition-colors",
        direction === 'horizontal' ? "w-0.5 h-8" : "h-0.5 w-8"
      )} />
    </PanelResizeHandle>
  );
}

function ThreePanelLayout({ 
  modules, 
  onRemove, 
  onToggleMaximize,
  onConfigChange
}: { 
  modules: DashboardModule[];
  onRemove: (id: string) => void;
  onToggleMaximize: (id: string) => void;
  onConfigChange?: (moduleId: string, config: Record<string, unknown>) => void;
}) {
  return (
    <PanelGroup direction="horizontal" autoSaveId="dashboard-h">
      <Panel minSize={20} defaultSize={40}>
        <ModulePanel 
          module={modules[0]}
          onRemove={onRemove}
          isMaximized={false}
          onToggleMaximize={onToggleMaximize}
          onConfigChange={onConfigChange}
        />
      </Panel>
      <ResizeHandle direction="horizontal" />
      <Panel minSize={30} defaultSize={60}>
        <PanelGroup direction="vertical" autoSaveId="dashboard-v">
          <Panel minSize={30} defaultSize={50}>
            <ModulePanel 
              module={modules[1]}
              onRemove={onRemove}
              isMaximized={false}
              onToggleMaximize={onToggleMaximize}
              onConfigChange={onConfigChange}
            />
          </Panel>
          <ResizeHandle direction="vertical" />
          <Panel minSize={30} defaultSize={50}>
            <ModulePanel 
              module={modules[2]}
              onRemove={onRemove}
              isMaximized={false}
              onToggleMaximize={onToggleMaximize}
              onConfigChange={onConfigChange}
            />
          </Panel>
        </PanelGroup>
      </Panel>
    </PanelGroup>
  );
}

function TwoPanelLayout({ 
  modules, 
  onRemove, 
  onToggleMaximize,
  onConfigChange
}: { 
  modules: DashboardModule[];
  onRemove: (id: string) => void;
  onToggleMaximize: (id: string) => void;
  onConfigChange?: (moduleId: string, config: Record<string, unknown>) => void;
}) {
  return (
    <PanelGroup direction="horizontal" autoSaveId="dashboard-2">
      <Panel minSize={20} defaultSize={50}>
        <ModulePanel 
          module={modules[0]}
          onRemove={onRemove}
          isMaximized={false}
          onToggleMaximize={onToggleMaximize}
          onConfigChange={onConfigChange}
        />
      </Panel>
      <ResizeHandle direction="horizontal" />
      <Panel minSize={20} defaultSize={50}>
        <ModulePanel 
          module={modules[1]}
          onRemove={onRemove}
          isMaximized={false}
          onToggleMaximize={onToggleMaximize}
          onConfigChange={onConfigChange}
        />
      </Panel>
    </PanelGroup>
  );
}

function OnePanelLayout({ 
  modules, 
  onRemove, 
  onToggleMaximize,
  onConfigChange
}: { 
  modules: DashboardModule[];
  onRemove: (id: string) => void;
  onToggleMaximize: (id: string) => void;
  onConfigChange?: (moduleId: string, config: Record<string, unknown>) => void;
}) {
  return (
    <ModulePanel 
      module={modules[0]}
      onRemove={onRemove}
      isMaximized={false}
      onToggleMaximize={onToggleMaximize}
      onConfigChange={onConfigChange}
    />
  );
}

function FourPanelLayout({ 
  modules, 
  onRemove, 
  onToggleMaximize,
  onConfigChange
}: { 
  modules: DashboardModule[];
  onRemove: (id: string) => void;
  onToggleMaximize: (id: string) => void;
  onConfigChange?: (moduleId: string, config: Record<string, unknown>) => void;
}) {
  return (
    <PanelGroup direction="horizontal" autoSaveId="dashboard-4h">
      <Panel minSize={25} defaultSize={50}>
        <PanelGroup direction="vertical" autoSaveId="dashboard-4v1">
          <Panel minSize={30} defaultSize={50}>
            <ModulePanel 
              module={modules[0]}
              onRemove={onRemove}
              isMaximized={false}
              onToggleMaximize={onToggleMaximize}
              onConfigChange={onConfigChange}
            />
          </Panel>
          <ResizeHandle direction="vertical" />
          <Panel minSize={30} defaultSize={50}>
            <ModulePanel 
              module={modules[1]}
              onRemove={onRemove}
              isMaximized={false}
              onToggleMaximize={onToggleMaximize}
              onConfigChange={onConfigChange}
            />
          </Panel>
        </PanelGroup>
      </Panel>
      <ResizeHandle direction="horizontal" />
      <Panel minSize={25} defaultSize={50}>
        <PanelGroup direction="vertical" autoSaveId="dashboard-4v2">
          <Panel minSize={30} defaultSize={50}>
            <ModulePanel 
              module={modules[2]}
              onRemove={onRemove}
              isMaximized={false}
              onToggleMaximize={onToggleMaximize}
              onConfigChange={onConfigChange}
            />
          </Panel>
          <ResizeHandle direction="vertical" />
          <Panel minSize={30} defaultSize={50}>
            <ModulePanel 
              module={modules[3]}
              onRemove={onRemove}
              isMaximized={false}
              onToggleMaximize={onToggleMaximize}
              onConfigChange={onConfigChange}
            />
          </Panel>
        </PanelGroup>
      </Panel>
    </PanelGroup>
  );
}

export default function Dashboard() {
  const { instance, isLoading: instanceLoading } = useInstance();

  // Load layout from Convex
  const savedModules = useQuery(
    api.dashboardLayouts.getLayout,
    instance ? { instanceId: instance._id } : 'skip'
  );

  // Save layout to Convex
  const saveLayout = useMutation(api.dashboardLayouts.saveLayout);

  // Local state initialized from Convex data
  const [modules, setModules] = useState<DashboardModule[]>([]);
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false);

  // Sync from Convex when data loads
  useEffect(() => {
    if (savedModules !== undefined && !hasInitialized) {
      setModules(savedModules.length > 0 ? savedModules : defaultModules);
      setHasInitialized(true);
    }
  }, [savedModules, hasInitialized]);

  // Save to Convex when modules change (debounced)
  useEffect(() => {
    if (!hasInitialized || !instance) return;

    const timeout = setTimeout(() => {
      saveLayout({ instanceId: instance._id, modules });
    }, 1000);

    return () => clearTimeout(timeout);
  }, [modules, hasInitialized, instance?._id]);

  const isLoading = instanceLoading || savedModules === undefined;
  const error = null;

  const handleRemoveModule = useCallback((id: string) => {
    setModules(prev => prev.filter(m => m.id !== id));
    if (maximizedId === id) {
      setMaximizedId(null);
    }
  }, [maximizedId]);

  const handleAddModule = useCallback((type: string) => {
    const newModule: DashboardModule = {
      id: `mod-${Date.now()}`,
      type,
      title: moduleLabels[type],
    };
    setModules(prev => [...prev, newModule]);
  }, []);

  const handleResetLayout = useCallback(() => {
    setModules(defaultModules);
    setMaximizedId(null);
    // Clear panel resize state from localStorage
    localStorage.removeItem('dashboard-h');
    localStorage.removeItem('dashboard-v');
    localStorage.removeItem('dashboard-2');
    localStorage.removeItem('dashboard-4h');
    localStorage.removeItem('dashboard-4v1');
    localStorage.removeItem('dashboard-4v2');
  }, []);

  const handleToggleMaximize = useCallback((id: string) => {
    setMaximizedId(prev => prev === id ? null : id);
  }, []);

  const handleModuleConfigChange = useCallback((moduleId: string, config: Record<string, unknown>) => {
    setModules(prev => prev.map(m => m.id === moduleId ? { ...m, config } : m));
  }, []);

  const availableModuleTypes = Object.keys(moduleLabels);

  // Error state (unused with Convex but kept for future use)
  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
          <h2 className="text-lg font-semibold mb-2">Failed to Load Dashboard</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Unable to load dashboard layout.
          </p>
        </div>
      </div>
    );
  }

  // Show loading state while fetching layout
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (maximizedId) {
    const maximizedModule = modules.find(m => m.id === maximizedId);
    if (maximizedModule) {
      return (
        <div className="h-full flex flex-col p-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-semibold">{maximizedModule.title}</h1>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setMaximizedId(null)}
            >
              <Minimize2 className="h-4 w-4 mr-2" />
              Exit Fullscreen
            </Button>
          </div>
          <div className="flex-1 min-h-0">
            <ModulePanel 
              module={maximizedModule}
              onRemove={handleRemoveModule}
              isMaximized={true}
              onToggleMaximize={handleToggleMaximize}
            />
          </div>
        </div>
      );
    }
  }

  if (modules.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold mb-2">Your Dashboard is Empty</h2>
          <p className="text-muted-foreground mb-6">
            Add modules to customize your dashboard layout. You can resize and arrange them as you like.
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {availableModuleTypes.map(type => (
              <Button 
                key={type}
                variant="outline"
                onClick={() => handleAddModule(type)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add {moduleLabels[type]}
              </Button>
            ))}
          </div>
          <Button 
            variant="ghost" 
            className="mt-4"
            onClick={handleResetLayout}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset to Default
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-add-module">
                <Plus className="h-4 w-4 mr-2" />
                Add Module
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {availableModuleTypes.map(type => (
                <DropdownMenuItem 
                  key={type}
                  onClick={() => handleAddModule(type)}
                >
                  {moduleLabels[type]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button 
            variant="ghost" 
            size="icon"
            onClick={handleResetLayout}
            data-testid="button-reset-layout"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-4">
        {modules.length === 1 && (
          <OnePanelLayout 
            modules={modules}
            onRemove={handleRemoveModule}
            onToggleMaximize={handleToggleMaximize}
            onConfigChange={handleModuleConfigChange}
          />
        )}
        {modules.length === 2 && (
          <TwoPanelLayout 
            modules={modules}
            onRemove={handleRemoveModule}
            onToggleMaximize={handleToggleMaximize}
            onConfigChange={handleModuleConfigChange}
          />
        )}
        {modules.length === 3 && (
          <ThreePanelLayout 
            modules={modules}
            onRemove={handleRemoveModule}
            onToggleMaximize={handleToggleMaximize}
            onConfigChange={handleModuleConfigChange}
          />
        )}
        {modules.length >= 4 && (
          <FourPanelLayout 
            modules={modules.slice(0, 4)}
            onRemove={handleRemoveModule}
            onToggleMaximize={handleToggleMaximize}
            onConfigChange={handleModuleConfigChange}
          />
        )}
      </div>
    </div>
  );
}
