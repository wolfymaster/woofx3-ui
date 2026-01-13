import { useQuery } from '@tanstack/react-query';
import { Play, Pause, AlertCircle, CheckCircle2, Clock, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'running' | 'completed' | 'failed' | 'pending';
  startedAt: Date;
  duration?: number;
  trigger: string;
}

const mockRuns: WorkflowRun[] = [
  { id: 'run-1', workflowId: 'wf-1', workflowName: 'New Subscriber Alert', status: 'completed', startedAt: new Date(Date.now() - 30000), duration: 245, trigger: 'subscription' },
  { id: 'run-2', workflowId: 'wf-2', workflowName: 'Chat Command Handler', status: 'running', startedAt: new Date(Date.now() - 15000), trigger: 'chat' },
  { id: 'run-3', workflowId: 'wf-3', workflowName: 'Raid Welcome', status: 'completed', startedAt: new Date(Date.now() - 120000), duration: 1850, trigger: 'raid' },
  { id: 'run-4', workflowId: 'wf-4', workflowName: 'Donation Alert', status: 'failed', startedAt: new Date(Date.now() - 180000), duration: 523, trigger: 'donation' },
  { id: 'run-5', workflowId: 'wf-1', workflowName: 'New Subscriber Alert', status: 'completed', startedAt: new Date(Date.now() - 300000), duration: 198, trigger: 'subscription' },
  { id: 'run-6', workflowId: 'wf-5', workflowName: 'Follower Goal Update', status: 'pending', startedAt: new Date(Date.now() - 5000), trigger: 'follow' },
];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function WorkflowRunItem({ run }: { run: WorkflowRun }) {
  const statusConfig = {
    running: { icon: Loader2, color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Running', animate: true },
    completed: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10', label: 'Completed', animate: false },
    failed: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Failed', animate: false },
    pending: { icon: Clock, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Pending', animate: false },
  };

  const config = statusConfig[run.status];
  const StatusIcon = config.icon;

  return (
    <div 
      className="flex items-center gap-3 p-2.5 rounded-md hover:bg-muted/50 transition-colors"
      data-testid={`workflow-run-${run.id}`}
    >
      <div className={cn('h-8 w-8 rounded-md flex items-center justify-center shrink-0', config.bg)}>
        <StatusIcon className={cn('h-4 w-4', config.color, config.animate && 'animate-spin')} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{run.workflowName}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{run.trigger}</span>
          <span>·</span>
          <span>{formatTimeAgo(run.startedAt)}</span>
          {run.duration && (
            <>
              <span>·</span>
              <span>{formatDuration(run.duration)}</span>
            </>
          )}
        </div>
      </div>
      <Badge 
        variant="secondary" 
        className={cn('text-[10px] shrink-0', config.color)}
      >
        {config.label}
      </Badge>
    </div>
  );
}

function WorkflowRunSkeleton() {
  return (
    <div className="flex items-center gap-3 p-2.5">
      <Skeleton className="h-8 w-8 rounded-md" />
      <div className="flex-1">
        <Skeleton className="h-4 w-32 mb-1" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-5 w-16" />
    </div>
  );
}

export function WorkflowRunsModule() {
  const { data: workflowsData, isLoading, refetch, isFetching } = useQuery<{ data: Array<{ id: string; name: string; isEnabled: boolean; stats: { runsToday: number } }> }>({
    queryKey: ['/api/workflows'],
  });

  const runs = mockRuns;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Workflow Runs</span>
          <Badge variant="secondary" className="text-xs">
            {runs.filter(r => r.status === 'running').length} active
          </Badge>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-7 w-7" 
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
        </Button>
      </div>
      
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-0.5">
          {isLoading ? (
            <>
              <WorkflowRunSkeleton />
              <WorkflowRunSkeleton />
              <WorkflowRunSkeleton />
              <WorkflowRunSkeleton />
            </>
          ) : runs.length === 0 ? (
            <div className="py-8 text-center">
              <Play className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No recent runs</p>
            </div>
          ) : (
            runs.map((run) => (
              <WorkflowRunItem key={run.id} run={run} />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
