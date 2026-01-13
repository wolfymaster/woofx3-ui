import { useState, useCallback, useRef, useEffect } from 'react';
import { useRoute, useLocation } from 'wouter';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Save,
  Play,
  Undo2,
  Redo2,
  ChevronLeft,
  Layers,
  Settings,
  Grid,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Type,
  Image,
  Square,
  Timer,
  MessageSquare,
  Bell,
  Code,
  Move,
  ZoomIn,
  ZoomOut,
  Maximize,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ArrowUpDown,
  Plus,
  Copy,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toggle } from '@/components/ui/toggle';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Widget, Scene } from '@/types';

const widgetTypes = [
  { type: 'text', label: 'Text', icon: Type },
  { type: 'image', label: 'Image', icon: Image },
  { type: 'shape', label: 'Shape', icon: Square },
  { type: 'timer', label: 'Timer', icon: Timer },
  { type: 'chat', label: 'Chat Box', icon: MessageSquare },
  { type: 'alert', label: 'Alert Box', icon: Bell },
  { type: 'custom', label: 'Custom HTML', icon: Code },
];

const mockScene: Scene = {
  id: '1',
  name: 'Main Overlay',
  description: 'Primary streaming overlay with chat and alerts',
  accountId: '1',
  width: 1920,
  height: 1080,
  backgroundColor: 'transparent',
  widgets: [
    { id: 'w1', type: 'text', name: 'Stream Title', position: { x: 50, y: 50 }, size: { width: 400, height: 60 }, rotation: 0, opacity: 100, zIndex: 3, locked: false, visible: true, properties: { text: 'Welcome to the Stream!', fontSize: 32, fontFamily: 'Inter', color: '#ffffff', align: 'left' } },
    { id: 'w2', type: 'image', name: 'Logo', position: { x: 1720, y: 50 }, size: { width: 150, height: 150 }, rotation: 0, opacity: 100, zIndex: 2, locked: false, visible: true, properties: { src: '/logo.png' } },
    { id: 'w3', type: 'chat', name: 'Chat Widget', position: { x: 1520, y: 600 }, size: { width: 380, height: 400 }, rotation: 0, opacity: 80, zIndex: 1, locked: false, visible: true, properties: {} },
    { id: 'w4', type: 'shape', name: 'Background Box', position: { x: 30, y: 30 }, size: { width: 440, height: 100 }, rotation: 0, opacity: 50, zIndex: 0, locked: false, visible: true, properties: { fill: '#000000', borderRadius: 8 } },
  ],
  createdAt: '2024-01-01',
  updatedAt: '2024-01-10',
};

interface SortableLayerItemProps {
  widget: Widget;
  isSelected: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
}

function SortableLayerItem({ widget, isSelected, onSelect, onToggleVisibility, onToggleLock }: SortableLayerItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const WidgetIcon = widgetTypes.find(w => w.type === widget.type)?.icon || Square;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover-elevate',
        isSelected && 'bg-primary/10',
        isDragging && 'opacity-50'
      )}
      onClick={onSelect}
      data-testid={`layer-${widget.id}`}
    >
      <div {...attributes} {...listeners} className="cursor-grab touch-none">
        <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
      </div>
      <WidgetIcon className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className={cn('flex-1 text-sm truncate', !widget.visible && 'text-muted-foreground line-through')}>
        {widget.name}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
      >
        {widget.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
      >
        {widget.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
      </Button>
    </div>
  );
}

interface CanvasWidgetProps {
  widget: Widget;
  isSelected: boolean;
  scale: number;
  onSelect: () => void;
  onMove: (dx: number, dy: number) => void;
  onResize: (width: number, height: number) => void;
}

function CanvasWidget({ widget, isSelected, scale, onSelect, onMove, onResize }: CanvasWidgetProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startSize = useRef({ width: 0, height: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (widget.locked) return;
    e.stopPropagation();
    onSelect();
    setIsDragging(true);
    startPos.current = { x: e.clientX, y: e.clientY };
  }, [widget.locked, onSelect]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (widget.locked) return;
    e.stopPropagation();
    setIsResizing(true);
    startPos.current = { x: e.clientX, y: e.clientY };
    startSize.current = { width: widget.size.width, height: widget.size.height };
  }, [widget.locked, widget.size]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const dx = (e.clientX - startPos.current.x) / scale;
        const dy = (e.clientY - startPos.current.y) / scale;
        onMove(dx, dy);
        startPos.current = { x: e.clientX, y: e.clientY };
      }
      if (isResizing) {
        const dw = (e.clientX - startPos.current.x) / scale;
        const dh = (e.clientY - startPos.current.y) / scale;
        onResize(
          Math.max(50, startSize.current.width + dw),
          Math.max(50, startSize.current.height + dh)
        );
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, scale, onMove, onResize]);

  const WidgetIcon = widgetTypes.find(w => w.type === widget.type)?.icon || Square;

  if (!widget.visible) return null;

  return (
    <div
      className={cn(
        'absolute cursor-move group',
        isSelected && 'ring-2 ring-primary ring-offset-1',
        widget.locked && 'cursor-not-allowed'
      )}
      style={{
        left: widget.position.x,
        top: widget.position.y,
        width: widget.size.width,
        height: widget.size.height,
        opacity: widget.opacity / 100,
        transform: `rotate(${widget.rotation}deg)`,
        zIndex: widget.zIndex,
      }}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onMouseDown={handleMouseDown}
      data-testid={`canvas-widget-${widget.id}`}
    >
      <div className={cn(
        'w-full h-full rounded-md flex items-center justify-center overflow-hidden',
        widget.type === 'text' && 'text-white',
        widget.type === 'shape' && 'bg-white/20',
        widget.type !== 'text' && widget.type !== 'shape' && 'bg-white/10 border border-dashed border-white/30'
      )}
      style={{
        backgroundColor: widget.type === 'shape' ? (widget.properties.fill as string) : undefined,
        borderRadius: widget.type === 'shape' ? (widget.properties.borderRadius as number) : undefined,
      }}>
        {widget.type === 'text' ? (
          <div
            className="w-full h-full flex items-center"
            style={{
              fontSize: (widget.properties.fontSize as number) || 24,
              fontFamily: (widget.properties.fontFamily as string) || 'Inter',
              color: (widget.properties.color as string) || '#ffffff',
              textAlign: (widget.properties.align as 'left' | 'center' | 'right') || 'left',
              padding: '8px',
            }}
          >
            {(widget.properties.text as string) || 'Text Widget'}
          </div>
        ) : widget.type === 'image' ? (
          <div className="w-full h-full bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
            <Image className="h-8 w-8 text-muted-foreground/50" />
          </div>
        ) : (
          <div className="text-center">
            <WidgetIcon className="h-6 w-6 mx-auto mb-1 text-white/50" />
            <span className="text-xs text-white/50">{widget.name}</span>
          </div>
        )}
      </div>
      
      {isSelected && !widget.locked && (
        <>
          <div className="absolute -top-1 -left-1 w-3 h-3 bg-primary rounded-full cursor-nw-resize" />
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-primary rounded-full cursor-ne-resize" />
          <div className="absolute -bottom-1 -left-1 w-3 h-3 bg-primary rounded-full cursor-sw-resize" />
          <div
            className="absolute -bottom-1 -right-1 w-3 h-3 bg-primary rounded-full cursor-se-resize"
            onMouseDown={handleResizeMouseDown}
          />
        </>
      )}
    </div>
  );
}

export default function SceneEditor() {
  const [, params] = useRoute('/scenes/:id');
  const [, navigate] = useLocation();
  const [scene, setScene] = useState<Scene>(mockScene);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.5);
  const [showGrid, setShowGrid] = useState(true);
  const canvasRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const selectedWidget = scene.widgets.find(w => w.id === selectedWidgetId);

  const sortedWidgets = [...scene.widgets].sort((a, b) => b.zIndex - a.zIndex);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setScene(prev => {
        const oldIndex = prev.widgets.findIndex(w => w.id === active.id);
        const newIndex = prev.widgets.findIndex(w => w.id === over.id);
        const newWidgets = arrayMove(prev.widgets, oldIndex, newIndex);
        return {
          ...prev,
          widgets: newWidgets.map((w, i) => ({ ...w, zIndex: newWidgets.length - i })),
        };
      });
    }
  };

  const updateWidget = useCallback((widgetId: string, updates: Partial<Widget>) => {
    setScene(prev => ({
      ...prev,
      widgets: prev.widgets.map(w => w.id === widgetId ? { ...w, ...updates } : w),
    }));
  }, []);

  const updateWidgetProperty = useCallback((widgetId: string, key: string, value: unknown) => {
    setScene(prev => ({
      ...prev,
      widgets: prev.widgets.map(w => w.id === widgetId ? {
        ...w,
        properties: { ...w.properties, [key]: value },
      } : w),
    }));
  }, []);

  const handleMove = useCallback((widgetId: string, dx: number, dy: number) => {
    setScene(prev => ({
      ...prev,
      widgets: prev.widgets.map(w => w.id === widgetId ? {
        ...w,
        position: { x: Math.max(0, w.position.x + dx), y: Math.max(0, w.position.y + dy) },
      } : w),
    }));
  }, []);

  const handleResize = useCallback((widgetId: string, width: number, height: number) => {
    setScene(prev => ({
      ...prev,
      widgets: prev.widgets.map(w => w.id === widgetId ? {
        ...w,
        size: { width, height },
      } : w),
    }));
  }, []);

  const addWidget = useCallback((type: Widget['type']) => {
    const newWidget: Widget = {
      id: `w-${Date.now()}`,
      type,
      name: `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
      position: { x: 100, y: 100 },
      size: { width: 200, height: type === 'text' ? 60 : 150 },
      rotation: 0,
      opacity: 100,
      zIndex: scene.widgets.length + 1,
      locked: false,
      visible: true,
      properties: type === 'text' ? { text: 'New Text', fontSize: 24, color: '#ffffff' } : {},
    };
    setScene(prev => ({ ...prev, widgets: [...prev.widgets, newWidget] }));
    setSelectedWidgetId(newWidget.id);
  }, [scene.widgets.length]);

  const deleteWidget = useCallback((widgetId: string) => {
    setScene(prev => ({
      ...prev,
      widgets: prev.widgets.filter(w => w.id !== widgetId),
    }));
    if (selectedWidgetId === widgetId) {
      setSelectedWidgetId(null);
    }
  }, [selectedWidgetId]);

  const duplicateWidget = useCallback((widgetId: string) => {
    const widget = scene.widgets.find(w => w.id === widgetId);
    if (widget) {
      const newWidget: Widget = {
        ...widget,
        id: `w-${Date.now()}`,
        name: `${widget.name} (Copy)`,
        position: { x: widget.position.x + 20, y: widget.position.y + 20 },
        zIndex: scene.widgets.length + 1,
      };
      setScene(prev => ({ ...prev, widgets: [...prev.widgets, newWidget] }));
      setSelectedWidgetId(newWidget.id);
    }
  }, [scene.widgets]);

  return (
    <div className="h-full flex flex-col">
      <div className="h-14 border-b border-border bg-background flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/scenes')} data-testid="button-back">
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <Input
            value={scene.name}
            onChange={(e) => setScene(prev => ({ ...prev, name: e.target.value }))}
            className="font-semibold border-none bg-transparent focus-visible:ring-0 w-48"
            data-testid="input-scene-name"
          />
          <Badge variant="secondary">{scene.width}x{scene.height}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" disabled data-testid="button-undo">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" disabled data-testid="button-redo">
            <Redo2 className="h-4 w-4" />
          </Button>
          <Separator orientation="vertical" className="h-6 mx-2" />
          <Button variant="outline" data-testid="button-preview">
            <Play className="h-4 w-4 mr-2" />
            Preview
          </Button>
          <Button data-testid="button-save-scene">
            <Save className="h-4 w-4 mr-2" />
            Save
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-12 bg-sidebar border-r border-sidebar-border flex flex-col items-center py-2 gap-1">
          {widgetTypes.map(({ type, label, icon: Icon }) => (
            <Tooltip key={type}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-10 h-10"
                  onClick={() => addWidget(type as Widget['type'])}
                  data-testid={`button-add-${type}`}
                >
                  <Icon className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        <div className="flex-1 bg-muted/30 relative overflow-auto" onClick={() => setSelectedWidgetId(null)}>
          <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-card rounded-md border p-1 z-10">
            <Button variant="ghost" size="icon" onClick={() => setZoom(z => Math.max(0.25, z - 0.1))} data-testid="button-zoom-out">
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm w-12 text-center">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="icon" onClick={() => setZoom(z => Math.min(2, z + 0.1))} data-testid="button-zoom-in">
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <Toggle pressed={showGrid} onPressedChange={setShowGrid} size="sm" data-testid="button-toggle-grid">
              <Grid className="h-4 w-4" />
            </Toggle>
            <Button variant="ghost" size="icon" onClick={() => setZoom(0.5)} data-testid="button-fit">
              <Maximize className="h-4 w-4" />
            </Button>
          </div>

          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div
              ref={canvasRef}
              className="relative bg-black/80 shadow-2xl"
              style={{
                width: scene.width * zoom,
                height: scene.height * zoom,
                backgroundImage: showGrid ? 'radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px)' : 'none',
                backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
              }}
              data-testid="scene-canvas"
            >
              <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: scene.width, height: scene.height }}>
                {scene.widgets.map(widget => (
                  <CanvasWidget
                    key={widget.id}
                    widget={widget}
                    isSelected={selectedWidgetId === widget.id}
                    scale={zoom}
                    onSelect={() => setSelectedWidgetId(widget.id)}
                    onMove={(dx, dy) => handleMove(widget.id, dx, dy)}
                    onResize={(w, h) => handleResize(widget.id, w, h)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="w-72 bg-sidebar border-l border-sidebar-border flex flex-col">
          <Tabs defaultValue="layers" className="flex-1 flex flex-col">
            <TabsList className="w-full justify-start rounded-none border-b bg-transparent h-auto p-0">
              <TabsTrigger value="layers" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">
                Layers
              </TabsTrigger>
              <TabsTrigger value="properties" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">
                Properties
              </TabsTrigger>
            </TabsList>

            <TabsContent value="layers" className="flex-1 mt-0 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-2">
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={sortedWidgets.map(w => w.id)} strategy={verticalListSortingStrategy}>
                      {sortedWidgets.map(widget => (
                        <SortableLayerItem
                          key={widget.id}
                          widget={widget}
                          isSelected={selectedWidgetId === widget.id}
                          onSelect={() => setSelectedWidgetId(widget.id)}
                          onToggleVisibility={() => updateWidget(widget.id, { visible: !widget.visible })}
                          onToggleLock={() => updateWidget(widget.id, { locked: !widget.locked })}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="properties" className="flex-1 mt-0 overflow-hidden">
              <ScrollArea className="h-full">
                {selectedWidget ? (
                  <div className="p-4 space-y-6">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input
                        value={selectedWidget.name}
                        onChange={(e) => updateWidget(selectedWidget.id, { name: e.target.value })}
                        data-testid="input-widget-name"
                      />
                    </div>

                    <Accordion type="multiple" defaultValue={['transform', 'appearance', 'content']}>
                      <AccordionItem value="transform">
                        <AccordionTrigger>Transform</AccordionTrigger>
                        <AccordionContent className="space-y-4">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-xs">X</Label>
                              <Input
                                type="number"
                                value={selectedWidget.position.x}
                                onChange={(e) => updateWidget(selectedWidget.id, {
                                  position: { ...selectedWidget.position, x: Number(e.target.value) }
                                })}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Y</Label>
                              <Input
                                type="number"
                                value={selectedWidget.position.y}
                                onChange={(e) => updateWidget(selectedWidget.id, {
                                  position: { ...selectedWidget.position, y: Number(e.target.value) }
                                })}
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-xs">Width</Label>
                              <Input
                                type="number"
                                value={selectedWidget.size.width}
                                onChange={(e) => updateWidget(selectedWidget.id, {
                                  size: { ...selectedWidget.size, width: Number(e.target.value) }
                                })}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Height</Label>
                              <Input
                                type="number"
                                value={selectedWidget.size.height}
                                onChange={(e) => updateWidget(selectedWidget.id, {
                                  size: { ...selectedWidget.size, height: Number(e.target.value) }
                                })}
                              />
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs">Rotation</Label>
                            <Slider
                              value={[selectedWidget.rotation]}
                              onValueChange={([v]) => updateWidget(selectedWidget.id, { rotation: v })}
                              min={0}
                              max={360}
                              step={1}
                            />
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="appearance">
                        <AccordionTrigger>Appearance</AccordionTrigger>
                        <AccordionContent className="space-y-4">
                          <div>
                            <Label className="text-xs">Opacity</Label>
                            <div className="flex items-center gap-2">
                              <Slider
                                value={[selectedWidget.opacity]}
                                onValueChange={([v]) => updateWidget(selectedWidget.id, { opacity: v })}
                                min={0}
                                max={100}
                                step={1}
                                className="flex-1"
                              />
                              <span className="text-xs w-8">{selectedWidget.opacity}%</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <Label className="text-xs">Visible</Label>
                            <Switch
                              checked={selectedWidget.visible}
                              onCheckedChange={(v) => updateWidget(selectedWidget.id, { visible: v })}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <Label className="text-xs">Locked</Label>
                            <Switch
                              checked={selectedWidget.locked}
                              onCheckedChange={(v) => updateWidget(selectedWidget.id, { locked: v })}
                            />
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      {selectedWidget.type === 'text' && (
                        <AccordionItem value="content">
                          <AccordionTrigger>Text Content</AccordionTrigger>
                          <AccordionContent className="space-y-4">
                            <div>
                              <Label className="text-xs">Text</Label>
                              <Textarea
                                value={(selectedWidget.properties.text as string) || ''}
                                onChange={(e) => updateWidgetProperty(selectedWidget.id, 'text', e.target.value)}
                                className="resize-none"
                                rows={3}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Font Size</Label>
                              <Input
                                type="number"
                                value={(selectedWidget.properties.fontSize as number) || 24}
                                onChange={(e) => updateWidgetProperty(selectedWidget.id, 'fontSize', Number(e.target.value))}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Font Family</Label>
                              <Select
                                value={(selectedWidget.properties.fontFamily as string) || 'Inter'}
                                onValueChange={(v) => updateWidgetProperty(selectedWidget.id, 'fontFamily', v)}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Inter">Inter</SelectItem>
                                  <SelectItem value="Roboto">Roboto</SelectItem>
                                  <SelectItem value="Montserrat">Montserrat</SelectItem>
                                  <SelectItem value="Open Sans">Open Sans</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs">Color</Label>
                              <Input
                                type="color"
                                value={(selectedWidget.properties.color as string) || '#ffffff'}
                                onChange={(e) => updateWidgetProperty(selectedWidget.id, 'color', e.target.value)}
                                className="h-9 p-1"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Alignment</Label>
                              <div className="flex gap-1 mt-1">
                                <Toggle
                                  pressed={(selectedWidget.properties.align as string) === 'left'}
                                  onPressedChange={() => updateWidgetProperty(selectedWidget.id, 'align', 'left')}
                                  size="sm"
                                >
                                  <AlignLeft className="h-4 w-4" />
                                </Toggle>
                                <Toggle
                                  pressed={(selectedWidget.properties.align as string) === 'center'}
                                  onPressedChange={() => updateWidgetProperty(selectedWidget.id, 'align', 'center')}
                                  size="sm"
                                >
                                  <AlignCenter className="h-4 w-4" />
                                </Toggle>
                                <Toggle
                                  pressed={(selectedWidget.properties.align as string) === 'right'}
                                  onPressedChange={() => updateWidgetProperty(selectedWidget.id, 'align', 'right')}
                                  size="sm"
                                >
                                  <AlignRight className="h-4 w-4" />
                                </Toggle>
                              </div>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      )}

                      {selectedWidget.type === 'shape' && (
                        <AccordionItem value="content">
                          <AccordionTrigger>Shape</AccordionTrigger>
                          <AccordionContent className="space-y-4">
                            <div>
                              <Label className="text-xs">Fill Color</Label>
                              <Input
                                type="color"
                                value={(selectedWidget.properties.fill as string) || '#000000'}
                                onChange={(e) => updateWidgetProperty(selectedWidget.id, 'fill', e.target.value)}
                                className="h-9 p-1"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Border Radius</Label>
                              <Slider
                                value={[(selectedWidget.properties.borderRadius as number) || 0]}
                                onValueChange={([v]) => updateWidgetProperty(selectedWidget.id, 'borderRadius', v)}
                                min={0}
                                max={50}
                                step={1}
                              />
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      )}
                    </Accordion>

                    <Separator />

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => duplicateWidget(selectedWidget.id)}
                      >
                        <Copy className="h-4 w-4 mr-1" />
                        Duplicate
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteWidget(selectedWidget.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 text-center text-muted-foreground">
                    <Layers className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">Select a widget to edit its properties</p>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
