import { useState, useCallback, useEffect } from 'react';
import { 
  GripVertical, 
  Plus, 
  RotateCcw,
  Maximize2,
  Minimize2,
  X
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
import { ChatModule } from '@/components/dashboard/chat-module';
import { WorkflowRunsModule } from '@/components/dashboard/workflow-runs-module';
import { EventFeedModule } from '@/components/dashboard/event-feed-module';

interface DashboardModule {
  id: string;
  type: 'chat' | 'workflow-runs' | 'event-feed';
  title: string;
}

const moduleComponents: Record<string, React.ComponentType> = {
  'chat': ChatModule,
  'workflow-runs': WorkflowRunsModule,
  'event-feed': EventFeedModule,
};

const moduleLabels: Record<string, string> = {
  'chat': 'Chat Client',
  'workflow-runs': 'Workflow Runs',
  'event-feed': 'Event Feed',
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
}

function ModulePanel({ module, onRemove, isMaximized, onToggleMaximize }: ModulePanelProps) {
  const Component = moduleComponents[module.type];

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
        {Component && <Component />}
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
  onToggleMaximize 
}: { 
  modules: DashboardModule[];
  onRemove: (id: string) => void;
  onToggleMaximize: (id: string) => void;
}) {
  return (
    <PanelGroup direction="horizontal" autoSaveId="dashboard-h">
      <Panel minSize={20} defaultSize={40}>
        <ModulePanel 
          module={modules[0]}
          onRemove={onRemove}
          isMaximized={false}
          onToggleMaximize={onToggleMaximize}
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
            />
          </Panel>
          <ResizeHandle direction="vertical" />
          <Panel minSize={30} defaultSize={50}>
            <ModulePanel 
              module={modules[2]}
              onRemove={onRemove}
              isMaximized={false}
              onToggleMaximize={onToggleMaximize}
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
  onToggleMaximize 
}: { 
  modules: DashboardModule[];
  onRemove: (id: string) => void;
  onToggleMaximize: (id: string) => void;
}) {
  return (
    <PanelGroup direction="horizontal" autoSaveId="dashboard-2">
      <Panel minSize={20} defaultSize={50}>
        <ModulePanel 
          module={modules[0]}
          onRemove={onRemove}
          isMaximized={false}
          onToggleMaximize={onToggleMaximize}
        />
      </Panel>
      <ResizeHandle direction="horizontal" />
      <Panel minSize={20} defaultSize={50}>
        <ModulePanel 
          module={modules[1]}
          onRemove={onRemove}
          isMaximized={false}
          onToggleMaximize={onToggleMaximize}
        />
      </Panel>
    </PanelGroup>
  );
}

function OnePanelLayout({ 
  modules, 
  onRemove, 
  onToggleMaximize 
}: { 
  modules: DashboardModule[];
  onRemove: (id: string) => void;
  onToggleMaximize: (id: string) => void;
}) {
  return (
    <ModulePanel 
      module={modules[0]}
      onRemove={onRemove}
      isMaximized={false}
      onToggleMaximize={onToggleMaximize}
    />
  );
}

function FourPanelLayout({ 
  modules, 
  onRemove, 
  onToggleMaximize 
}: { 
  modules: DashboardModule[];
  onRemove: (id: string) => void;
  onToggleMaximize: (id: string) => void;
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
            />
          </Panel>
          <ResizeHandle direction="vertical" />
          <Panel minSize={30} defaultSize={50}>
            <ModulePanel 
              module={modules[1]}
              onRemove={onRemove}
              isMaximized={false}
              onToggleMaximize={onToggleMaximize}
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
            />
          </Panel>
          <ResizeHandle direction="vertical" />
          <Panel minSize={30} defaultSize={50}>
            <ModulePanel 
              module={modules[3]}
              onRemove={onRemove}
              isMaximized={false}
              onToggleMaximize={onToggleMaximize}
            />
          </Panel>
        </PanelGroup>
      </Panel>
    </PanelGroup>
  );
}

export default function Dashboard() {
  const [modules, setModules] = useState<DashboardModule[]>(() => {
    const saved = localStorage.getItem('dashboard-modules');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return defaultModules;
      }
    }
    return defaultModules;
  });

  const [maximizedId, setMaximizedId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('dashboard-modules', JSON.stringify(modules));
  }, [modules]);

  const handleRemoveModule = useCallback((id: string) => {
    setModules(prev => prev.filter(m => m.id !== id));
    if (maximizedId === id) {
      setMaximizedId(null);
    }
  }, [maximizedId]);

  const handleAddModule = useCallback((type: string) => {
    const newModule: DashboardModule = {
      id: `mod-${Date.now()}`,
      type: type as DashboardModule['type'],
      title: moduleLabels[type],
    };
    setModules(prev => [...prev, newModule]);
  }, []);

  const handleResetLayout = useCallback(() => {
    setModules(defaultModules);
    setMaximizedId(null);
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

  const availableModuleTypes = Object.keys(moduleLabels);

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
          />
        )}
        {modules.length === 2 && (
          <TwoPanelLayout 
            modules={modules}
            onRemove={handleRemoveModule}
            onToggleMaximize={handleToggleMaximize}
          />
        )}
        {modules.length === 3 && (
          <ThreePanelLayout 
            modules={modules}
            onRemove={handleRemoveModule}
            onToggleMaximize={handleToggleMaximize}
          />
        )}
        {modules.length >= 4 && (
          <FourPanelLayout 
            modules={modules.slice(0, 4)}
            onRemove={handleRemoveModule}
            onToggleMaximize={handleToggleMaximize}
          />
        )}
      </div>
    </div>
  );
}
