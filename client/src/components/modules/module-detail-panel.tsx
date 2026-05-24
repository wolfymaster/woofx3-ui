import {
  ArrowLeft,
  Bell,
  Check,
  Download,
  FileCode,
  Loader2,
  Puzzle,
  Trash2,
  Workflow as WorkflowIcon,
  XCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface ModuleDetailMeta {
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  tags: string[];
  isInstalled: boolean;
  iconUrl?: string;
  readme?: string;
  identifier?: string;
}

export interface ModuleDetailTrigger {
  key: string;
  name: string;
  description: string;
  color: string;
}

export interface ModuleDetailAction {
  key: string;
  name: string;
  description: string;
  color: string;
}

export interface ModuleDetailFunction {
  qualifiedName: string;
  runtime?: string;
}

export interface ModuleDetailWidget {
  slug: string;
  name: string;
}

interface ModuleDetailPanelProps {
  module: ModuleDetailMeta;
  triggers: ModuleDetailTrigger[] | undefined;
  actions: ModuleDetailAction[] | undefined;
  functions: ModuleDetailFunction[] | undefined;
  widgets?: ModuleDetailWidget[] | undefined;
  loading?: boolean;
  onBack: () => void;
  onInstall?: () => void;
  onRemove?: () => void;
  isInstalling?: boolean;
  installDisabled?: boolean;
  installDisabledReason?: string;
  installProgressMessage?: string | null;
  installSucceeded?: boolean;
  installError?: string | null;
  onShowInstallError?: () => void;
}

type TopTab = "details" | "resources";
type ResourceType = "actions" | "triggers" | "workflows" | "widgets" | "functions";

const categoryIcons: Record<string, React.ReactNode> = {
  Chat: <Bell className="h-4 w-4" />,
  Alerts: <Bell className="h-4 w-4" />,
  Media: <Puzzle className="h-4 w-4" />,
  Audio: <Puzzle className="h-4 w-4" />,
  Automation: <Zap className="h-4 w-4" />,
  Integrations: <Puzzle className="h-4 w-4" />,
  Effects: <Puzzle className="h-4 w-4" />,
  Utilities: <Puzzle className="h-4 w-4" />,
};

export function ModuleDetailPanel(props: ModuleDetailPanelProps) {
  const {
    module,
    triggers,
    actions,
    functions,
    widgets,
    loading,
    onBack,
    onInstall,
    onRemove,
    isInstalling,
    installDisabled,
    installDisabledReason,
    installProgressMessage,
    installSucceeded,
    installError,
    onShowInstallError,
  } = props;

  const [topTab, setTopTab] = useState<TopTab>("details");
  const [resourceTab, setResourceTab] = useState<ResourceType>("actions");

  const resourceCounts: Record<ResourceType, number | undefined> = {
    actions: actions?.length,
    triggers: triggers?.length,
    workflows: 0,
    widgets: widgets?.length,
    functions: functions?.length,
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6 pb-3 shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold">{module.name}</h2>
              {categoryIcons[module.category] && <span className="text-primary">{categoryIcons[module.category]}</span>}
            </div>
            <p className="text-sm text-muted-foreground">{module.description}</p>
          </div>
        </div>
      </div>

      <div className="px-6 border-b shrink-0">
        <div className="flex gap-6">
          <TopTabButton active={topTab === "details"} onClick={() => setTopTab("details")}>
            DETAILS
          </TopTabButton>
          <TopTabButton active={topTab === "resources"} onClick={() => setTopTab("resources")}>
            RESOURCES
          </TopTabButton>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : topTab === "details" ? (
        <DetailsTab
          module={module}
          onInstall={onInstall}
          onRemove={onRemove}
          isInstalling={isInstalling}
          installDisabled={installDisabled}
          installDisabledReason={installDisabledReason}
          installProgressMessage={installProgressMessage}
          installSucceeded={installSucceeded}
          installError={installError}
          onShowInstallError={onShowInstallError}
        />
      ) : (
        <ResourcesTab
          activeType={resourceTab}
          onSelectType={setResourceTab}
          counts={resourceCounts}
          triggers={triggers}
          actions={actions}
          functions={functions}
          widgets={widgets}
        />
      )}
    </div>
  );
}

function TopTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "py-3 text-xs font-semibold tracking-wider border-b-2 -mb-px transition-colors",
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

interface DetailsTabProps {
  module: ModuleDetailMeta;
  onInstall?: () => void;
  onRemove?: () => void;
  isInstalling?: boolean;
  installDisabled?: boolean;
  installDisabledReason?: string;
  installProgressMessage?: string | null;
  installSucceeded?: boolean;
  installError?: string | null;
  onShowInstallError?: () => void;
}

function DetailsTab({
  module,
  onInstall,
  onRemove,
  isInstalling,
  installDisabled,
  installDisabledReason,
  installProgressMessage,
  installSucceeded,
  installError,
  onShowInstallError,
}: DetailsTabProps) {
  const installButton = module.isInstalled
    ? onRemove && (
        <Button variant="destructive" size="sm" className="w-full" onClick={onRemove}>
          <Trash2 className="h-4 w-4 mr-2" />
          Remove
        </Button>
      )
    : onInstall && (
        <Button
          size="sm"
          className="w-full"
          variant={installError ? "destructive" : "default"}
          onClick={installError && onShowInstallError ? onShowInstallError : onInstall}
          disabled={isInstalling || installDisabled}
          title={installError ?? installDisabledReason}
        >
          {isInstalling ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />
              <span className="truncate">{installProgressMessage || "Installing..."}</span>
            </>
          ) : installSucceeded ? (
            <>
              <Check className="h-4 w-4 mr-2 shrink-0" />
              Installed
            </>
          ) : installError ? (
            <>
              <XCircle className="h-4 w-4 mr-2 shrink-0" />
              Install failed — details
            </>
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Install
            </>
          )}
        </Button>
      );

  return (
    <div className="flex-1 min-h-0 grid grid-cols-3 gap-6 px-6 py-4">
      <ScrollArea className="col-span-2 h-full pr-4">
        <div className="prose prose-sm dark:prose-invert max-w-none">
          {module.readme ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{module.readme}</ReactMarkdown>
          ) : (
            <p className="text-sm text-muted-foreground not-prose">No README provided.</p>
          )}
        </div>
      </ScrollArea>

      <div className="col-span-1 space-y-4">
        {installButton}
        <MetaRow label="Identifier" value={module.identifier ?? "—"} mono />
        <MetaRow label="Version" value={module.version || "—"} />
        <MetaRow label="Author" value={module.author || "Unknown"} />
        <MetaRow label="Category">
          <Badge variant="outline" className="text-xs">
            {module.category}
          </Badge>
        </MetaRow>
        <MetaRow label="Status">
          <Badge variant={module.isInstalled ? "secondary" : "outline"} className="text-xs">
            {module.isInstalled ? (
              <>
                <Check className="h-3 w-3 mr-1" />
                Installed
              </>
            ) : (
              "Not installed"
            )}
          </Badge>
        </MetaRow>
        {module.tags.length > 0 && (
          <MetaRow label="Tags">
            <div className="flex flex-wrap gap-1">
              {module.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          </MetaRow>
        )}
      </div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  children,
  mono,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-sm mt-1 break-words", mono && "font-mono text-xs")}>{children ?? value}</div>
    </div>
  );
}

const RESOURCE_NAV: Array<{ type: ResourceType; label: string }> = [
  { type: "actions", label: "Actions" },
  { type: "functions", label: "Functions" },
  { type: "triggers", label: "Triggers" },
  { type: "widgets", label: "Widgets" },
  { type: "workflows", label: "Workflows" },
];

interface ResourcesTabProps {
  activeType: ResourceType;
  onSelectType: (type: ResourceType) => void;
  counts: Record<ResourceType, number | undefined>;
  triggers: ModuleDetailTrigger[] | undefined;
  actions: ModuleDetailAction[] | undefined;
  functions: ModuleDetailFunction[] | undefined;
  widgets: ModuleDetailWidget[] | undefined;
}

function ResourcesTab(props: ResourcesTabProps) {
  const { activeType, onSelectType, counts, triggers, actions, functions, widgets } = props;
  return (
    <div className="flex-1 min-h-0 grid grid-cols-4 gap-6 px-6 py-4">
      <div className="col-span-1 space-y-1">
        {RESOURCE_NAV.map((item) => {
          const count = counts[item.type];
          const isActive = activeType === item.type;
          return (
            <button
              type="button"
              key={item.type}
              onClick={() => onSelectType(item.type)}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors text-left",
                isActive
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <span>{item.label}</span>
              <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                {count ?? "—"}
              </Badge>
            </button>
          );
        })}
      </div>

      <ScrollArea className="col-span-3 h-full pr-4">
        {activeType === "actions" && <ActionList items={actions} />}
        {activeType === "triggers" && <TriggerList items={triggers} />}
        {activeType === "functions" && <FunctionList items={functions} />}
        {activeType === "widgets" && <WidgetList items={widgets} />}
        {activeType === "workflows" && <EmptyState message="This module does not declare any workflows." />}
      </ScrollArea>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>;
}

function LoadingState() {
  return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
}

function TriggerList({ items }: { items: ModuleDetailTrigger[] | undefined }) {
  if (items === undefined) {
    return <LoadingState />;
  }
  if (items.length === 0) {
    return <EmptyState message="No triggers" />;
  }
  return (
    <div className="space-y-2">
      {items.map((trigger) => (
        <div key={trigger.key} className="flex items-start gap-3 p-3 rounded-md border bg-card">
          <div
            className="h-8 w-8 rounded flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${trigger.color}20`, color: trigger.color }}
          >
            <Bell className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{trigger.name}</p>
            <p className="text-xs text-muted-foreground">{trigger.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActionList({ items }: { items: ModuleDetailAction[] | undefined }) {
  if (items === undefined) {
    return <LoadingState />;
  }
  if (items.length === 0) {
    return <EmptyState message="No actions" />;
  }
  return (
    <div className="space-y-2">
      {items.map((action) => (
        <div key={action.key} className="flex items-start gap-3 p-3 rounded-md border bg-card">
          <div
            className="h-8 w-8 rounded flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${action.color}20`, color: action.color }}
          >
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{action.name}</p>
            <p className="text-xs text-muted-foreground">{action.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function FunctionList({ items }: { items: ModuleDetailFunction[] | undefined }) {
  if (items === undefined) {
    return <LoadingState />;
  }
  if (items.length === 0) {
    return <EmptyState message="No functions" />;
  }
  return (
    <div className="space-y-2">
      {items.map((fn) => (
        <div key={fn.qualifiedName} className="flex items-start gap-3 p-3 rounded-md border bg-card">
          <div className="h-8 w-8 rounded flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
            <FileCode className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium font-mono">{fn.qualifiedName}</p>
            {fn.runtime && <p className="text-xs text-muted-foreground">{fn.runtime}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function WidgetList({ items }: { items: ModuleDetailWidget[] | undefined }) {
  if (items === undefined) {
    return <LoadingState />;
  }
  if (items.length === 0) {
    return <EmptyState message="No widgets" />;
  }
  return (
    <div className="space-y-2">
      {items.map((widget) => (
        <div key={widget.slug} className="flex items-start gap-3 p-3 rounded-md border bg-card">
          <div className="h-8 w-8 rounded flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
            <WorkflowIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{widget.name}</p>
            <p className="text-xs text-muted-foreground font-mono">{widget.slug}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
