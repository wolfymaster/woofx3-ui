import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { 
  Plus, 
  Search, 
  MoreHorizontal,
  Play,
  Pause,
  Copy,
  Trash2,
  Edit3,
  Workflow as WorkflowIcon,
  Zap,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { cn } from '@/lib/utils';
import { queryClient, apiRequest } from '@/lib/queryClient';
import type { Workflow, PaginatedResponse } from '@/types';

interface WorkflowWithStats extends Workflow {
  stats: { runsToday: number; successRate: number };
}

interface WorkflowCardProps {
  workflow: WorkflowWithStats;
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
              workflow.isEnabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
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
                {workflow.description}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {isToggling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Switch
                checked={workflow.isEnabled}
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
            <span className="font-medium">{workflow.stats.runsToday}</span>
            <span className="text-muted-foreground">runs today</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            {workflow.stats.successRate >= 95 ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : workflow.stats.successRate >= 80 ? (
              <AlertCircle className="h-4 w-4 text-yellow-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-500" />
            )}
            <span className="font-medium">{workflow.stats.successRate}%</span>
            <span className="text-muted-foreground">success</span>
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

export default function Workflows() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: workflowsData, isLoading, error, refetch } = useQuery<PaginatedResponse<WorkflowWithStats>>({
    queryKey: ['/api/workflows'],
  });

  const workflows = workflowsData?.data || [];

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      setTogglingId(id);
      const response = await apiRequest('PATCH', `/api/workflows/${id}`, { isEnabled: enabled });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
      setTogglingId(null);
    },
    onError: () => {
      setTogglingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/workflows/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
      setDeleteDialogOpen(false);
      setDeletingId(null);
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<Workflow>) => {
      const response = await apiRequest('POST', '/api/workflows', data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
    },
  });

  const filteredWorkflows = workflows.filter(w => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!w.name.toLowerCase().includes(query) && !w.description?.toLowerCase().includes(query)) {
        return false;
      }
    }
    if (statusFilter === 'enabled' && !w.isEnabled) return false;
    if (statusFilter === 'disabled' && w.isEnabled) return false;
    return true;
  });

  const handleToggle = (id: string, enabled: boolean) => {
    toggleMutation.mutate({ id, enabled });
  };

  const handleEdit = (id: string) => {
    navigate(`/workflows/${id}`);
  };

  const handleDuplicate = (id: string) => {
    const workflow = workflows.find(w => w.id === id);
    if (workflow) {
      createMutation.mutate({
        name: `${workflow.name} (Copy)`,
        description: workflow.description,
        accountId: workflow.accountId,
        isEnabled: false,
        nodes: workflow.nodes,
        edges: workflow.edges,
      });
    }
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (deletingId) {
      deleteMutation.mutate(deletingId);
    }
  };

  const enabledCount = workflows.filter(w => w.isEnabled).length;
  const totalRuns = workflows.reduce((sum, w) => sum + w.stats.runsToday, 0);
  const avgSuccess = workflows.length > 0 
    ? (workflows.reduce((sum, w) => sum + w.stats.successRate, 0) / workflows.length).toFixed(1)
    : '0';

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader 
        title="Workflows" 
        description="Automate your stream with trigger-action workflows."
        actions={
          <Button onClick={() => navigate('/workflows/new')} data-testid="button-new-workflow">
            <Plus className="h-4 w-4 mr-2" />
            New Workflow
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Workflows</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <>
                <Skeleton className="h-8 w-12 mb-1" />
                <Skeleton className="h-3 w-20" />
              </>
            ) : (
              <>
                <div className="text-2xl font-bold">{workflows.length}</div>
                <p className="text-xs text-muted-foreground">{enabledCount} enabled</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Runs Today</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <>
                <Skeleton className="h-8 w-16 mb-1" />
                <Skeleton className="h-3 w-24" />
              </>
            ) : (
              <>
                <div className="text-2xl font-bold">{totalRuns.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground">across all workflows</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Average Success</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <>
                <Skeleton className="h-8 w-14 mb-1" />
                <Skeleton className="h-3 w-28" />
              </>
            ) : (
              <>
                <div className="text-2xl font-bold">{avgSuccess}%</div>
                <p className="text-xs text-muted-foreground">workflow completion rate</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

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
          message="An error occurred while fetching the workflows."
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
          description={workflows.length === 0 
            ? "Create your first workflow to start automating your stream."
            : "Try adjusting your search or filters."
          }
          action={{
            label: workflows.length === 0 ? 'Create Workflow' : 'Clear Filters',
            onClick: () => {
              if (workflows.length === 0) {
                navigate('/workflows/new');
              } else {
                setSearchQuery('');
                setStatusFilter('all');
              }
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
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
