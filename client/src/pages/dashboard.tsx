import { useQuery } from '@tanstack/react-query';
import { 
  Activity, 
  Workflow, 
  Puzzle, 
  FolderOpen,
  TrendingUp,
  Play,
  Pause,
  AlertCircle,
  CheckCircle2,
  Clock,
  Zap,
  Eye,
  ArrowUpRight,
  MoreHorizontal,
  Loader2
} from 'lucide-react';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/common/error-state';
import { cn } from '@/lib/utils';

interface DashboardStats {
  activeWorkflows: number;
  totalWorkflows: number;
  installedModules: number;
  totalModules: number;
  totalAssets: number;
  totalAssetsSize: number;
  eventsToday: number;
  systemHealth: {
    cpu: number;
    memory: number;
    storage: number;
    apiRateLimit: { used: number; total: number };
  };
}

interface StatCardProps {
  title: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon: React.ReactNode;
  description?: string;
  isLoading?: boolean;
}

function StatCard({ title, value, change, changeType = 'neutral', icon, description, isLoading }: StatCardProps) {
  if (isLoading) {
    return (
      <Card data-testid={`card-stat-${title.toLowerCase().replace(/\s/g, '-')}`}>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-16 mb-2" />
          <Skeleton className="h-3 w-32" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover-elevate" data-testid={`card-stat-${title.toLowerCase().replace(/\s/g, '-')}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary">
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" data-testid={`text-stat-value-${title.toLowerCase().replace(/\s/g, '-')}`}>{value}</div>
        {(change || description) && (
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            {change && (
              <span className={cn(
                'font-medium',
                changeType === 'positive' && 'text-green-500',
                changeType === 'negative' && 'text-red-500'
              )}>
                {change}
              </span>
            )}
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface WorkflowStatusProps {
  id: string;
  name: string;
  status: 'running' | 'paused' | 'error' | 'completed';
  lastRun?: string;
  runsToday?: number;
}

function WorkflowStatusItem({ id, name, status, lastRun, runsToday }: WorkflowStatusProps) {
  const statusConfig = {
    running: { icon: Play, color: 'text-green-500', bg: 'bg-green-500/10', label: 'Running' },
    paused: { icon: Pause, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Paused' },
    error: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Error' },
    completed: { icon: CheckCircle2, color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Completed' },
  };

  const config = statusConfig[status];
  const StatusIcon = config.icon;

  return (
    <div 
      className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer"
      data-testid={`card-workflow-status-${id}`}
    >
      <div className={cn('h-9 w-9 rounded-md flex items-center justify-center', config.bg)}>
        <StatusIcon className={cn('h-4 w-4', config.color)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{name}</p>
        <p className="text-xs text-muted-foreground">
          {lastRun && <span>{lastRun}</span>}
          {runsToday !== undefined && <span> · {runsToday} runs today</span>}
        </p>
      </div>
      <Badge variant="secondary" className="text-xs shrink-0">
        {config.label}
      </Badge>
    </div>
  );
}

function WorkflowStatusSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3">
      <Skeleton className="h-9 w-9 rounded-md" />
      <div className="flex-1">
        <Skeleton className="h-4 w-32 mb-1" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-5 w-16" />
    </div>
  );
}

interface ActivityItemProps {
  id: string;
  type: 'workflow' | 'module' | 'asset' | 'scene';
  action: string;
  target: string;
  user: {
    name: string;
    avatar?: string;
  };
  timestamp: string;
}

function ActivityItem({ id, type, action, target, user, timestamp }: ActivityItemProps) {
  const typeIcons = {
    workflow: Workflow,
    module: Puzzle,
    asset: FolderOpen,
    scene: Eye,
  };

  const Icon = typeIcons[type];
  const initials = user.name.split(' ').map(n => n[0]).join('').slice(0, 2);

  return (
    <div 
      className="flex items-start gap-3 py-3 border-b border-border/50 last:border-0"
      data-testid={`item-activity-${id}`}
    >
      <Avatar className="h-8 w-8">
        <AvatarImage src={user.avatar} />
        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="font-medium">{user.name}</span>
          <span className="text-muted-foreground"> {action} </span>
          <span className="font-medium">{target}</span>
        </p>
        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
          <Icon className="h-3 w-3" />
          <span>{type}</span>
          <span>·</span>
          <Clock className="h-3 w-3" />
          <span>{timestamp}</span>
        </div>
      </div>
    </div>
  );
}

interface QuickActionProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  href: string;
}

function QuickAction({ icon, label, description, href }: QuickActionProps) {
  return (
    <Link href={href}>
      <div 
        className="flex items-center gap-4 p-4 rounded-lg border border-border/50 bg-card hover-elevate cursor-pointer group"
        data-testid={`card-quick-action-${label.toLowerCase().replace(/\s/g, '-')}`}
      >
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium flex items-center gap-2">
            {label}
            <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </p>
          <p className="text-xs text-muted-foreground truncate">{description}</p>
        </div>
      </div>
    </Link>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function Dashboard() {
  const { 
    data: stats, 
    isLoading: statsLoading, 
    error: statsError,
    refetch: refetchStats 
  } = useQuery<DashboardStats>({
    queryKey: ['/api/stats/dashboard'],
  });

  const { 
    data: workflowsData, 
    isLoading: workflowsLoading, 
    error: workflowsError,
    refetch: refetchWorkflows 
  } = useQuery<{ data: Array<{ id: string; name: string; isEnabled: boolean; stats: { runsToday: number; successRate: number } }> }>({
    queryKey: ['/api/workflows'],
  });

  const workflows = workflowsData?.data || [];

  const workflowStatuses: WorkflowStatusProps[] = workflows.slice(0, 5).map(w => ({
    id: w.id,
    name: w.name,
    status: w.isEnabled ? (w.stats.successRate >= 80 ? 'running' : 'error') : 'paused',
    lastRun: 'Recently',
    runsToday: w.stats.runsToday,
  }));

  const activities: ActivityItemProps[] = [
    { id: '1', type: 'workflow', action: 'modified', target: 'Chat Commands Handler', user: { name: 'Alex Chen' }, timestamp: '5 min ago' },
    { id: '2', type: 'module', action: 'installed', target: 'Twitch Integration v2.1', user: { name: 'Sarah Kim' }, timestamp: '15 min ago' },
    { id: '3', type: 'asset', action: 'uploaded', target: '5 new sound effects', user: { name: 'Alex Chen' }, timestamp: '1 hour ago' },
    { id: '4', type: 'scene', action: 'updated', target: 'Main Overlay', user: { name: 'Jordan Lee' }, timestamp: '2 hours ago' },
    { id: '5', type: 'workflow', action: 'created', target: 'New Subscriber Alert', user: { name: 'Sarah Kim' }, timestamp: '3 hours ago' },
  ];

  const quickActions: QuickActionProps[] = [
    { icon: <Workflow className="h-5 w-5" />, label: 'New Workflow', description: 'Create automated event chains', href: '/workflows/new' },
    { icon: <Puzzle className="h-5 w-5" />, label: 'Browse Modules', description: 'Discover new integrations', href: '/modules' },
    { icon: <FolderOpen className="h-5 w-5" />, label: 'Upload Assets', description: 'Add media to your library', href: '/assets' },
    { icon: <Eye className="h-5 w-5" />, label: 'Edit Scene', description: 'Customize your overlays', href: '/scenes' },
  ];

  const statCards = [
    { 
      title: 'Active Workflows', 
      value: stats?.activeWorkflows ?? 0, 
      change: '+2', 
      changeType: 'positive' as const, 
      icon: <Workflow className="h-4 w-4" />, 
      description: 'from last week' 
    },
    { 
      title: 'Installed Modules', 
      value: stats?.installedModules ?? 0, 
      change: '+5', 
      changeType: 'positive' as const, 
      icon: <Puzzle className="h-4 w-4" />, 
      description: 'from last month' 
    },
    { 
      title: 'Total Assets', 
      value: stats?.totalAssets ?? 0, 
      icon: <FolderOpen className="h-4 w-4" />, 
      description: stats ? formatBytes(stats.totalAssetsSize) + ' used' : 'Loading...' 
    },
    { 
      title: 'Events Today', 
      value: stats?.eventsToday?.toLocaleString() ?? '0', 
      change: '+18%', 
      changeType: 'positive' as const, 
      icon: <Zap className="h-4 w-4" />, 
      description: 'vs yesterday' 
    },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader 
        title="Dashboard" 
        description="Welcome back! Here's what's happening with your stream."
        actions={
          <Button data-testid="button-quick-start">
            <Play className="h-4 w-4 mr-2" />
            Quick Start
          </Button>
        }
      />

      {statsError ? (
        <div className="mb-8">
          <ErrorState 
            message="Failed to load dashboard statistics" 
            onRetry={() => refetchStats()} 
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-8">
          {statCards.map((stat) => (
            <StatCard key={stat.title} {...stat} isLoading={statsLoading} />
          ))}
        </div>
      )}

      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickActions.map((action) => (
            <QuickAction key={action.label} {...action} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/activity">View All</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[320px] pr-4">
              {activities.map((activity) => (
                <ActivityItem key={activity.id} {...activity} />
              ))}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold">Workflow Status</CardTitle>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[320px]">
              <div className="px-6 pb-4 space-y-1">
                {workflowsError ? (
                  <ErrorState 
                    compact 
                    message="Failed to load workflows" 
                    onRetry={() => refetchWorkflows()} 
                  />
                ) : workflowsLoading ? (
                  <>
                    <WorkflowStatusSkeleton />
                    <WorkflowStatusSkeleton />
                    <WorkflowStatusSkeleton />
                    <WorkflowStatusSkeleton />
                    <WorkflowStatusSkeleton />
                  </>
                ) : workflowStatuses.length === 0 ? (
                  <div className="py-8 text-center">
                    <Workflow className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">No workflows yet</p>
                  </div>
                ) : (
                  workflowStatuses.map((workflow) => (
                    <WorkflowStatusItem key={workflow.id} {...workflow} />
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold">System Health</CardTitle>
            <Badge variant="secondary" className="font-normal">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 mr-1.5" />
              All Systems Operational
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted-foreground">CPU Usage</span>
                <span className="font-medium">{stats?.systemHealth?.cpu ?? 0}%</span>
              </div>
              <Progress value={stats?.systemHealth?.cpu ?? 0} className="h-2" />
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted-foreground">Memory</span>
                <span className="font-medium">{stats?.systemHealth?.memory ?? 0}%</span>
              </div>
              <Progress value={stats?.systemHealth?.memory ?? 0} className="h-2" />
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted-foreground">Storage</span>
                <span className="font-medium">{stats?.systemHealth?.storage ?? 0}%</span>
              </div>
              <Progress value={stats?.systemHealth?.storage ?? 0} className="h-2" />
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted-foreground">API Rate Limit</span>
                <span className="font-medium">
                  {stats?.systemHealth?.apiRateLimit?.used?.toLocaleString() ?? 0} / {stats?.systemHealth?.apiRateLimit?.total?.toLocaleString() ?? 0}
                </span>
              </div>
              <Progress value={stats ? (stats.systemHealth.apiRateLimit.used / stats.systemHealth.apiRateLimit.total) * 100 : 0} className="h-2" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold">Upcoming Events</CardTitle>
            <Button variant="ghost" size="sm">Schedule</Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-3 rounded-lg bg-muted/50">
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">15</p>
                  <p className="text-xs text-muted-foreground uppercase">Jan</p>
                </div>
                <div>
                  <p className="font-medium">Weekly Stream Maintenance</p>
                  <p className="text-sm text-muted-foreground">Scheduled downtime for updates</p>
                  <p className="text-xs text-muted-foreground mt-1">2:00 AM - 4:00 AM UTC</p>
                </div>
              </div>
              <div className="flex items-start gap-4 p-3 rounded-lg bg-muted/50">
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">18</p>
                  <p className="text-xs text-muted-foreground uppercase">Jan</p>
                </div>
                <div>
                  <p className="font-medium">Charity Stream Event</p>
                  <p className="text-sm text-muted-foreground">Special overlays and alerts active</p>
                  <p className="text-xs text-muted-foreground mt-1">6:00 PM - 12:00 AM UTC</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
