import { useState } from 'react';
import { useQuery as useConvexQuery } from 'convex/react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import {
  Plus,
  Search,
  MoreHorizontal,
  Copy,
  Trash2,
  Edit3,
  Workflow as WorkflowIcon,
  Zap,
  CheckCircle2,
  AlertCircle,
  Loader2,
  BookTemplate,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { cn } from '@/lib/utils';
import { transport } from '@/lib/transport';
import type { Workflow, CreateWorkflowInput } from '@/lib/transport';
import { useInstance } from '@/hooks/use-instance';
import { api } from '@convex/_generated/api';

interface WorkflowCardProps {
  workflow: Workflow;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  isToggling?: boolean;
}

function WorkflowCard({ workflow, onToggle, onEdit, onDuplicate, onDelete, isToggling }: WorkflowCardProps) {
  const [, navigate] = useLocation();

  return (
    <Card
      className="group hover-elevate cursor-pointer overflow-visible"
      onClick={() => navigate(`/workflows/${workflow.id}`)}
      data-testid={`card-workflow-${workflow.id}`}
    >
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={cn(
              'h-10 w-10 rounded-lg flex items-center justify-center shrink-0',
              workflow.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
            )}>
              <WorkflowIcon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold truncate" data-testid={`text-workflow-name-${workflow.id}`}>
                  {workflow.name}
                </h3>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {workflow.description ?? ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {isToggling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Switch
                checked={workflow.enabled}
                onCheckedChange={(checked) => onToggle(workflow.id, checked)}
                data-testid={`switch-workflow-${workflow.id}`}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid={`button-workflow-menu-${workflow.id}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(workflow.id)}>
                  <Edit3 className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDuplicate(workflow.id)}>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDelete(workflow.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex items-center gap-4 pt-4 border-t border-border/50">
          <div className="flex items-center gap-1.5 text-sm">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{workflow.steps.length}</span>
            <span className="text-muted-foreground">steps</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="font-medium text-muted-foreground">
              {workflow.enabled ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkflowCardSkeleton() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start gap-3 mb-4">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="flex-1">
            <Skeleton className="h-5 w-40 mb-2" />
            <Skeleton className="h-4 w-full" />
          </div>
          <Skeleton className="h-6 w-10" />
        </div>
        <div className="flex items-center gap-4 pt-4 border-t border-border/50">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

type WorkflowTemplate = {
  _id: string;
  name: string;
  description: string;
  trigger: string;
  workflowJson: Record<string, unknown>;
};

function TemplatePickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: WorkflowTemplate) => void;
}) {
  const templates = useConvexQuery(api.workflowTemplates.list, {}) as WorkflowTemplate[] | undefined;

  const triggerEmoji: Record<string, string> = {
    follow: '👤',
    subscribe: '⭐',
    bits: '💎',
    raid: '🚨',
    gift: '🎁',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>From Template</DialogTitle>
          <DialogDescription>
            Choose a Twitch event template to pre-populate your workflow.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 mt-2">
          {templates === undefined ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No templates available.</p>
          ) : (
            templates.map((t) => (
              <button
                key={t._id}
                className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                onClick={() => { onSelect(t); onOpenChange(false); }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{triggerEmoji[t.trigger] ?? '⚡'}</span>
                  <div>
                    <p className="font-medium text-sm">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Workflows() {
  const [, navigate] = useLocation();
  const { instance } = useInstance();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);

  const instanceId = instance?._id ?? '';

  const { data: workflows = [], isLoading, error, refetch } = useQuery({
    queryKey: ['workflows', instanceId],
    queryFn: () => (instanceId ? transport.getWorkflows(instanceId) : Promise.resolve([])),
    enabled: !!instanceId,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      setTogglingId(id);
      return transport.updateWorkflow(instanceId, id, { enabled });
    },
    onSuccess: () => { refetch(); setTogglingId(null); },
    onError: () => setTogglingId(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => transport.deleteWorkflow(instanceId, id),
    onSuccess: () => { refetch(); setDeleteDialogOpen(false); setDeletingId(null); },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateWorkflowInput) => transport.createWorkflow(instanceId, data),
    onSuccess: () => refetch(),
  });

  const filteredWorkflows = workflows.filter((w) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!w.name.toLowerCase().includes(query) && !w.description?.toLowerCase().includes(query)) {
        return false;
      }
    }
    if (statusFilter === 'enabled' && !w.enabled) return false;
    if (statusFilter === 'disabled' && w.enabled) return false;
    return true;
  });

  const handleToggle = (id: string, enabled: boolean) => toggleMutation.mutate({ id, enabled });
  const handleEdit = (id: string) => navigate(`/workflows/${id}`);

  const handleDuplicate = (id: string) => {
    const workflow = workflows.find((w) => w.id === id);
    if (!workflow) return;
    createMutation.mutate({
      name: `${workflow.name} (Copy)`,
      description: workflow.description,
      enabled: false,
      steps: workflow.steps,
    });
  };

  const handleDelete = (id: string) => { setDeletingId(id); setDeleteDialogOpen(true); };
  const confirmDelete = () => { if (deletingId) deleteMutation.mutate(deletingId); };

  const handleTemplateSelect = (template: WorkflowTemplate) => {
    const wf = template.workflowJson as { name?: string; steps?: unknown[]; variables?: Record<string, string> };
    createMutation.mutate({
      name: wf.name ?? template.name,
      description: template.description,
      enabled: false,
      steps: (wf.steps as CreateWorkflowInput['steps']) ?? [],
      variables: wf.variables,
    });
  };

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Workflows"
        description="Automate your stream with trigger-action workflows."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setTemplateDialogOpen(true)}>
              <BookTemplate className="h-4 w-4 mr-2" />
              From Template
            </Button>
            <Button onClick={() => navigate('/workflows/new')} data-testid="button-new-workflow">
              <Plus className="h-4 w-4 mr-2" />
              New Workflow
            </Button>
          </div>
        }
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search workflows..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-workflows"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="w-32" data-testid="select-filter-workflows">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="enabled">Enabled</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <ErrorState
          title="Failed to load workflows"
          message="Unable to connect to the woofx3 instance."
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <WorkflowCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredWorkflows.length === 0 ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No workflows found"
          description={
            workflows.length === 0
              ? 'Create your first workflow to start automating your stream.'
              : 'Try adjusting your search or filters.'
          }
          action={{
            label: workflows.length === 0 ? 'Create Workflow' : 'Clear Filters',
            onClick: () => {
              if (workflows.length === 0) navigate('/workflows/new');
              else { setSearchQuery(''); setStatusFilter('all'); }
            },
          }}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredWorkflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              onToggle={handleToggle}
              onEdit={handleEdit}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              isToggling={togglingId === workflow.id}
            />
          ))}
        </div>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this workflow? This action cannot be undone.
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

      <TemplatePickerDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        onSelect={handleTemplateSelect}
      />
    </div>
  );
}
