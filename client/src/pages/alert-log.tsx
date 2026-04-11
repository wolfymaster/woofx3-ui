import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { Search, Bell, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { api } from "@convex/_generated/api";
import { useInstance } from "@/hooks/use-instance";

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60_000) {
    return "just now";
  }
  if (diff < 3_600_000) {
    const mins = Math.floor(diff / 60_000);
    return `${mins} min ago`;
  }
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000);
    return `${hours}h ago`;
  }
  if (diff < 604_800_000) {
    const days = Math.floor(diff / 86_400_000);
    return `${days}d ago`;
  }
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatAbsoluteTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function alertTypeBadgeVariant(alertType: string): "default" | "secondary" | "destructive" | "outline" {
  switch (alertType.toLowerCase()) {
    case "subscription":
    case "sub":
      return "default";
    case "raid":
      return "destructive";
    case "cheer":
    case "bits":
      return "secondary";
    default:
      return "outline";
  }
}

function stateBadgeVariant(state: string): "default" | "secondary" | "destructive" | "outline" {
  switch (state.toLowerCase()) {
    case "complete":
    case "completed":
      return "default";
    case "cancelled":
    case "canceled":
      return "destructive";
    case "expired":
      return "secondary";
    default:
      return "outline";
  }
}

function truncateMessage(message: string, maxLength = 60): string {
  if (message.length <= maxLength) {
    return message;
  }
  return `${message.slice(0, maxLength)}...`;
}

const ALERT_TYPE_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "subscription", label: "Subscription" },
  { value: "raid", label: "Raid" },
  { value: "cheer", label: "Cheer" },
  { value: "follow", label: "Follow" },
  { value: "donation", label: "Donation" },
];

function AlertTableSkeleton() {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Message</TableHead>
            <TableHead>Tier</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-4 w-20" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-4 w-24" /></TableCell>
              <TableCell><Skeleton className="h-4 w-12" /></TableCell>
              <TableCell><Skeleton className="h-4 w-40" /></TableCell>
              <TableCell><Skeleton className="h-4 w-12" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-4 w-10" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export default function AlertLog() {
  const { instance, isLoading: instanceLoading } = useInstance();
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const alertsRaw = useQuery(
    api.alertLog.list,
    instance
      ? {
          instanceId: instance._id,
          ...(typeFilter !== "all" ? { alertType: typeFilter } : {}),
          ...(searchQuery.trim() ? { user: searchQuery.trim() } : {}),
        }
      : "skip",
  );

  const alerts = alertsRaw ?? [];
  const isLoading = instanceLoading || alertsRaw === undefined;

  const alertTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const alert of alerts) {
      counts[alert.alertType] = (counts[alert.alertType] ?? 0) + 1;
    }
    return counts;
  }, [alerts]);

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Alert Log"
        description="View the history of stream alerts for your instance."
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by username..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              {ALERT_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!isLoading && (
          <div className="text-sm text-muted-foreground">
            {alerts.length} alert{alerts.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {isLoading ? (
        <AlertTableSkeleton />
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No alerts found"
          description={
            searchQuery || typeFilter !== "all"
              ? "Try adjusting your search or filters."
              : "Alert history will appear here once alerts are triggered."
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((alert) => (
                <TableRow key={alert._id}>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span title={formatAbsoluteTime(alert.createdAt)}>
                        {formatRelativeTime(alert.createdAt)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={alertTypeBadgeVariant(alert.alertType)} className="capitalize">
                      {alert.alertType}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{alert.user}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {alert.amount != null ? alert.amount.toLocaleString() : "\u2014"}
                  </TableCell>
                  <TableCell className="max-w-[240px]">
                    {alert.message ? (
                      <span className="text-muted-foreground" title={alert.message}>
                        {truncateMessage(alert.message)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{"\u2014"}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {alert.tier ?? "\u2014"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={stateBadgeVariant(alert.state)} className="capitalize">
                      {alert.state}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {alert.duration != null ? `${(alert.duration / 1000).toFixed(1)}s` : "\u2014"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
