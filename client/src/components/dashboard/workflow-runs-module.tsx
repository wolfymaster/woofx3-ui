import { useState, useEffect } from 'react';
import { Play, AlertCircle, CheckCircle2, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { transport } from '@/lib/transport';
import type { WorkflowRun } from '@/lib/transport';
import { useInstance } from '@/hooks/use-instance';

function formatDuration(start: Date, end?: Date): string {
  const ms = (end ?? new Date()).getTime() - start.getTime();
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

const statusConfig: Record<string, { icon: typeof Loader2; color: string; bg: string; label: string; animate: boolean }> = {
  pending:   { icon: Loader2,      color: 'text-blue-400',  bg: 'bg-blue-400/10',  label: 'Pending',   animate: true },
  running:   { icon: Loader2,      color: 'text-blue-500',  bg: 'bg-blue-500/10',  label: 'Running',   animate: true },
  completed: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10', label: 'Success',   animate: false },
  failed:    { icon: AlertCircle,  color: 'text-red-500',   bg: 'bg-red-500/10',   label: 'Failed',    animate: false },
  cancelled: { icon: AlertCircle,  color: 'text-gray-500',  bg: 'bg-gray-500/10',  label: 'Cancelled', animate: false },
};

function WorkflowRunItem({ run }: { run: WorkflowRun }) {
  const config = statusConfig[run.status] ?? statusConfig.running;
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
          <span>{run.triggeredBy ?? 'manual'}</span>
          <span>·</span>
          <span>{formatTimeAgo(run.startedAt)}</span>
          {run.completedAt && (
            <>
              <span>·</span>
              <span>{formatDuration(run.startedAt, run.completedAt)}</span>
            </>
          )}
        </div>
      </div>
      <Badge variant="secondary" className={cn('text-[10px] shrink-0', config.color)}>
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

interface WorkflowRunsModuleProps {
  config?: Record<string, unknown>;
}

export function WorkflowRunsModule({ config: _config }: WorkflowRunsModuleProps) {
  const { instance } = useInstance();
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Subscribe to workflow runs via transport
  useEffect(() => {
    if (!instance) return;
    const instanceId = instance._id;

    const unsubscribe = transport.subscribeWorkflowRuns(instanceId, (run) => {
      setRuns((prev) => {
        const idx = prev.findIndex((r) => r.id === run.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = run;
          return next;
        }
        return [run, ...prev].slice(0, 20);
      });
    });

    return unsubscribe;
  }, [instance?._id, refreshKey]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Workflow Runs</span>
          <Badge variant="secondary" className="text-xs">
            {runs.filter((r) => r.status === 'running' || r.status === 'pending').length} active
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => { setRuns([]); setRefreshKey((k) => k + 1); }}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-0.5">
          {runs.length === 0 ? (
            <div className="py-8 text-center">
              <Play className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                {instance ? 'No recent runs' : 'No instance connected'}
              </p>
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
