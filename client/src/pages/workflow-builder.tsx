import { useState, useCallback, useMemo } from 'react';
import ReactFlow, {
  type Node,
  type Edge,
  type Connection,
  Controls,
  Background,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Panel,
  BackgroundVariant,
  type NodeTypes,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useRoute, useLocation } from 'wouter';
import {
  Save,
  Play,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Settings2,
  ChevronLeft,
  Zap,
  Clock,
  GitBranch,
  ArrowRight,
  GripVertical,
  Search,
} from "lucide-react";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { useWorkflowCatalog } from '@/hooks/use-workflow-catalog';
import { resolveLucideIcon } from '@/lib/resolve-lucide-icon';

interface NodeData {
  label: string;
  description?: string;
  icon?: string;
  type: 'trigger' | 'action' | 'condition' | 'delay';
  moduleId?: string;
  parameters?: Record<string, unknown>;
}

type NodeLibraryCategory = {
  name: string;
  type: NodeData['type'];
  icon: React.ReactNode;
  items: { id: string; label: string; description: string; icon: string }[];
};

const staticNodeLibraryCategories: NodeLibraryCategory[] = [
  {
    name: 'Logic',
    type: 'condition',
    icon: <GitBranch className="h-4 w-4" />,
    items: [
      { id: 'condition', label: 'Condition', description: 'Branch based on conditions', icon: 'GitBranch' },
      { id: 'filter', label: 'Filter', description: 'Filter events by criteria', icon: 'Filter' },
      { id: 'random', label: 'Random', description: 'Random path selection', icon: 'GitBranch' },
    ],
  },
  {
    name: 'Timing',
    type: 'delay',
    icon: <Clock className="h-4 w-4" />,
    items: [
      { id: 'delay', label: 'Delay', description: 'Wait before continuing', icon: 'Clock' },
      { id: 'cooldown', label: 'Cooldown', description: 'Rate limit execution', icon: 'Clock' },
      { id: 'schedule', label: 'Schedule', description: 'Run at specific times', icon: 'Clock' },
    ],
  },
];

function CustomNode({ data, selected }: { data: NodeData; selected: boolean }) {
  const Icon = resolveLucideIcon(data.icon || 'Zap');
  
  const typeColors = {
    trigger: 'border-green-500/50 bg-green-500/5',
    action: 'border-blue-500/50 bg-blue-500/5',
    condition: 'border-yellow-500/50 bg-yellow-500/5',
    delay: 'border-purple-500/50 bg-purple-500/5',
  };

  const handleColors = {
    trigger: 'bg-green-500',
    action: 'bg-blue-500',
    condition: 'bg-yellow-500',
    delay: 'bg-purple-500',
  };

  return (
    <div
      className={cn(
        'px-4 py-3 rounded-lg border-2 bg-card min-w-[180px] max-w-[220px]',
        typeColors[data.type],
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
      )}
      data-testid={`node-${data.label.toLowerCase().replace(/\s/g, '-')}`}
    >
      {data.type !== 'trigger' && (
        <Handle
          type="target"
          position={Position.Left}
          className={cn('!w-3 !h-3 !border-2 !border-background', handleColors[data.type])}
        />
      )}
      <div className="flex items-center gap-3">
        <div className={cn(
          'h-8 w-8 rounded-md flex items-center justify-center shrink-0',
          data.type === 'trigger' && 'bg-green-500/20 text-green-500',
          data.type === 'action' && 'bg-blue-500/20 text-blue-500',
          data.type === 'condition' && 'bg-yellow-500/20 text-yellow-500',
          data.type === 'delay' && 'bg-purple-500/20 text-purple-500',
        )}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{data.label}</p>
          {data.description && (
            <p className="text-xs text-muted-foreground truncate">{data.description}</p>
          )}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className={cn('!w-3 !h-3 !border-2 !border-background', handleColors[data.type])}
      />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  custom: CustomNode,
};

const initialNodes: Node<NodeData>[] = [
  {
    id: '1',
    type: 'custom',
    position: { x: 100, y: 150 },
    data: { label: 'Chat Message', description: 'When message received', type: 'trigger', icon: 'MessageSquare' },
  },
  {
    id: '2',
    type: 'custom',
    position: { x: 400, y: 100 },
    data: { label: 'Check Command', description: 'If starts with !', type: 'condition', icon: 'Filter' },
  },
  {
    id: '3',
    type: 'custom',
    position: { x: 700, y: 50 },
    data: { label: 'Send Response', description: 'Reply in chat', type: 'action', icon: 'MessageSquare' },
  },
  {
    id: '4',
    type: 'custom',
    position: { x: 700, y: 180 },
    data: { label: 'Play Sound', description: 'Play notification', type: 'action', icon: 'Bell' },
  },
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', animated: true },
  { id: 'e2-3', source: '2', target: '3' },
  { id: 'e2-4', source: '2', target: '4' },
];

interface NodeLibraryProps {
  categories: NodeLibraryCategory[];
  catalogLoading: boolean;
  catalogError: string | null;
  onRetryCatalog: () => void;
  onDragStart: (event: React.DragEvent, nodeType: string, data: Partial<NodeData>) => void;
}

function NodeLibrary({ categories, catalogLoading, catalogError, onRetryCatalog, onDragStart }: NodeLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCategories = useMemo(() => {
    if (!searchQuery) {
      return categories;
    }

    const query = searchQuery.toLowerCase();
    return categories
      .map((cat) => ({
        ...cat,
        items: cat.items.filter(
          (item) =>
            item.label.toLowerCase().includes(query) || item.description.toLowerCase().includes(query),
        ),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [searchQuery, categories]);

  const defaultOpen = useMemo(() => categories.map((c) => c.name), [categories]);

  return (
    <div className="w-60 bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-3 border-b border-sidebar-border space-y-2">
        {catalogError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            <p className="font-medium">Catalog</p>
            <p className="opacity-90 line-clamp-2">{catalogError}</p>
            <button
              type="button"
              onClick={() => void onRetryCatalog()}
              className="mt-1 text-primary underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        )}
        {catalogLoading && (
          <p className="text-xs text-muted-foreground">Loading instance catalog…</p>
        )}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search nodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
            data-testid="input-search-nodes"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        <Accordion type="multiple" defaultValue={defaultOpen} className="px-2 py-2">
          {filteredCategories.map((category) => (
            <AccordionItem key={category.name} value={category.name} className="border-none">
              <AccordionTrigger className="py-2 px-2 text-sm font-medium hover:no-underline hover:bg-sidebar-accent rounded-md">
                <span className="flex items-center gap-2">
                  {category.icon}
                  {category.name}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-2">
                <div className="space-y-1">
                  {category.items.map((item) => {
                    const Icon = resolveLucideIcon(item.icon);
                    return (
                      // Draggable palette row: must be a div for HTML5 DnD (not a button).
                      // biome-ignore lint/a11y/noStaticElementInteractions: drag source for React Flow
                      <div
                        key={item.id}
                        className="flex items-center gap-2 p-2 rounded-md cursor-grab hover-elevate text-sm"
                        draggable
                        onDragStart={(e) => onDragStart(e, 'custom', {
                          label: item.label,
                          description: item.description,
                          type: category.type as NodeData['type'],
                          icon: item.icon,
                        })}
                        data-testid={`node-library-${item.id}`}
                      >
                        <GripVertical className="h-3 w-3 text-muted-foreground" />
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{item.label}</span>
                      </div>
                    );
                  })}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </ScrollArea>
    </div>
  );
}

interface NodeInspectorProps {
  node: Node<NodeData> | null;
  onClose: () => void;
  onUpdate: (nodeId: string, data: Partial<NodeData>) => void;
}

function NodeInspector({ node, onClose, onUpdate }: NodeInspectorProps) {
  if (!node) return null;

  return (
    <Sheet open={!!node} onOpenChange={() => onClose()}>
      <SheetContent className="w-[360px] sm:w-[400px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Configure Node
          </SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          <div className="space-y-2">
            <Label htmlFor="node-label">Label</Label>
            <Input
              id="node-label"
              value={node.data.label}
              onChange={(e) => onUpdate(node.id, { label: e.target.value })}
              data-testid="input-node-label"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="node-description">Description</Label>
            <Textarea
              id="node-description"
              value={node.data.description || ''}
              onChange={(e) => onUpdate(node.id, { description: e.target.value })}
              className="resize-none"
              rows={3}
              data-testid="input-node-description"
            />
          </div>
          <Separator />
          <div className="space-y-4">
            <h4 className="font-medium text-sm">Parameters</h4>
            {node.data.type === 'trigger' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Message Filter</Label>
                  <Select defaultValue="all">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All messages</SelectItem>
                      <SelectItem value="commands">Commands only</SelectItem>
                      <SelectItem value="mentions">Mentions only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Include Bots</Label>
                  <Switch />
                </div>
              </div>
            )}
            {node.data.type === 'action' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Response Template</Label>
                  <Textarea
                    placeholder="Enter message template..."
                    className="resize-none font-mono text-sm"
                    rows={4}
                  />
                </div>
              </div>
            )}
            {node.data.type === 'condition' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Condition Type</Label>
                  <Select defaultValue="contains">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contains">Contains</SelectItem>
                      <SelectItem value="startsWith">Starts With</SelectItem>
                      <SelectItem value="endsWith">Ends With</SelectItem>
                      <SelectItem value="matches">Regex Match</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Value</Label>
                  <Input placeholder="Enter value..." />
                </div>
              </div>
            )}
            {node.data.type === 'delay' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Duration</Label>
                  <div className="flex gap-2">
                    <Input type="number" defaultValue={5} className="w-20" />
                    <Select defaultValue="seconds">
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="milliseconds">Milliseconds</SelectItem>
                        <SelectItem value="seconds">Seconds</SelectItem>
                        <SelectItem value="minutes">Minutes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function WorkflowBuilder() {
  useRoute('/workflows/:id');
  const [, navigate] = useLocation();
  const { catalogTriggers, catalogActions, loading: catalogLoading, error: catalogError, refresh } =
    useWorkflowCatalog();

  const nodeLibraryCategories = useMemo((): NodeLibraryCategory[] => {
    const dynamic: NodeLibraryCategory[] = [];
    const triggerItems = catalogTriggers.map((t) => ({
      id: t.id,
      label: t.name,
      description: t.description,
      icon: t.icon || 'Zap',
    }));
    if (triggerItems.length > 0) {
      dynamic.push({
        name: 'Triggers',
        type: 'trigger',
        icon: <Zap className="h-4 w-4" />,
        items: triggerItems,
      });
    }
    const actionItems = catalogActions.map((a) => ({
      id: a.id,
      label: a.name,
      description: a.description,
      icon: a.icon || 'ArrowRight',
    }));
    if (actionItems.length > 0) {
      dynamic.push({
        name: 'Actions',
        type: 'action',
        icon: <ArrowRight className="h-4 w-4" />,
        items: actionItems,
      });
    }
    return [...dynamic, ...staticNodeLibraryCategories];
  }, [catalogTriggers, catalogActions]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node<NodeData> | null>(null);
  const [workflowName, setWorkflowName] = useState('Chat Commands Handler');

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, animated: true }, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<NodeData>) => {
    setSelectedNode(node);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow/type');
      const dataString = event.dataTransfer.getData('application/reactflow/data');

      if (!type || !dataString) return;

      const data = JSON.parse(dataString) as Partial<NodeData>;
      const position = {
        x: event.clientX - 280,
        y: event.clientY - 56,
      };

      const newNode: Node<NodeData> = {
        id: `node-${Date.now()}`,
        type,
        position,
        data: {
          label: data.label || 'New Node',
          description: data.description,
          type: data.type || 'action',
          icon: data.icon || 'Zap',
        },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes]
  );

  const onDragStart = useCallback((event: React.DragEvent, nodeType: string, data: Partial<NodeData>) => {
    event.dataTransfer.setData('application/reactflow/type', nodeType);
    event.dataTransfer.setData('application/reactflow/data', JSON.stringify(data));
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const onUpdateNode = useCallback((nodeId: string, data: Partial<NodeData>) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
      )
    );
    setSelectedNode((prev) => prev ? { ...prev, data: { ...prev.data, ...data } } : null);
  }, [setNodes]);

  return (
    <div className="h-full flex flex-col">
      <div className="h-14 border-b border-border bg-background flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/workflows')} data-testid="button-back">
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <Input
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            className="font-semibold border-none bg-transparent focus-visible:ring-0 w-64"
            data-testid="input-workflow-name"
          />
          <Badge variant="secondary">Draft</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" disabled data-testid="button-undo">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" disabled data-testid="button-redo">
            <Redo2 className="h-4 w-4" />
          </Button>
          <Separator orientation="vertical" className="h-6 mx-2" />
          <Button variant="outline" data-testid="button-test-workflow">
            <Play className="h-4 w-4 mr-2" />
            Test
          </Button>
          <Button data-testid="button-save-workflow">
            <Save className="h-4 w-4 mr-2" />
            Save
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <NodeLibrary
          categories={nodeLibraryCategories}
          catalogLoading={catalogLoading}
          catalogError={catalogError}
          onRetryCatalog={refresh}
          onDragStart={onDragStart}
        />
        
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            fitView
            className="bg-background"
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} className="!bg-muted/30" />
            <Controls className="!bg-card !border-border !shadow-none" />
            <MiniMap
              className="!bg-card !border-border"
              nodeColor={(node) => {
                const colors = {
                  trigger: 'rgb(34 197 94)',
                  action: 'rgb(59 130 246)',
                  condition: 'rgb(234 179 8)',
                  delay: 'rgb(168 85 247)',
                };
                return colors[(node.data as NodeData).type] || 'rgb(156 163 175)';
              }}
            />
            <Panel position="bottom-left" className="flex items-center gap-2 !m-4">
              <Button variant="outline" size="icon" data-testid="button-zoom-in">
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" data-testid="button-zoom-out">
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" data-testid="button-fit-view">
                <Maximize2 className="h-4 w-4" />
              </Button>
            </Panel>
          </ReactFlow>
        </div>
      </div>

      <NodeInspector
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
        onUpdate={onUpdateNode}
      />
    </div>
  );
}
