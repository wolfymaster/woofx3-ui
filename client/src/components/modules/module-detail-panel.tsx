import {
  ArrowLeft,
  Bell,
  Check,
  Download,
  FileCode,
  Loader2,
  Plus,
  Puzzle,
  Trash2,
  Workflow as WorkflowIcon,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Id } from "@convex/_generated/dataModel";
import type { ManifestResourceKind, ManifestSettingField } from "@convex/moduleDetail";
import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInternalSettingAction } from "@/hooks/use-internal-setting-action";
import { CONVEX_SITE_URL } from "@/lib/convexSiteUrl";
import { cn, isNewerVersion } from "@/lib/utils";

export interface ModuleDetailMeta {
  name: string;
  description: string;
  version: string;
  latestVersion?: string;
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

export interface ModuleDetailWorkflow {
  slug: string;
  name: string;
}

interface ModuleDetailPanelProps {
  module: ModuleDetailMeta;
  triggers: ModuleDetailTrigger[] | undefined;
  actions: ModuleDetailAction[] | undefined;
  functions: ModuleDetailFunction[] | undefined;
  widgets?: ModuleDetailWidget[] | undefined;
  workflows?: ModuleDetailWorkflow[] | undefined;
  loading?: boolean;
  onBack: () => void;
  onInstall?: () => void;
  onRemove?: () => void;
  onUpdate?: () => void;
  isInstalling?: boolean;
  installDisabled?: boolean;
  installDisabledReason?: string;
  installProgressMessage?: string | null;
  installSucceeded?: boolean;
  installError?: string | null;
  onDismissError?: () => void;
  instanceId?: Id<"instances">;
  moduleDbId?: Id<"moduleRepository">;
  manifestSettings?: ManifestSettingField[];
  manifestResourceKinds?: ManifestResourceKind[];
}

type TopTab = "details" | "definitions" | "settings" | "resources";
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
    workflows,
    loading,
    onBack,
    onInstall,
    onRemove,
    onUpdate,
    isInstalling,
    installDisabled,
    installDisabledReason,
    installProgressMessage,
    installSucceeded,
    installError,
    onDismissError,
    instanceId,
    moduleDbId,
    manifestSettings,
    manifestResourceKinds,
  } = props;

  const [topTab, setTopTab] = useState<TopTab>("details");
  const [resourceTab, setResourceTab] = useState<ResourceType>("actions");

  const resourceCounts: Record<ResourceType, number | undefined> = {
    actions: actions?.length,
    triggers: triggers?.length,
    workflows: workflows?.length,
    widgets: widgets?.length,
    functions: functions?.length,
  };

  const updateAvailable =
    module.isInstalled && !!module.latestVersion && isNewerVersion(module.latestVersion, module.version);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6 pb-3 shrink-0 space-y-3">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0 mt-0.5">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold truncate">{module.name}</h2>
              {categoryIcons[module.category] && <span className="text-primary shrink-0">{categoryIcons[module.category]}</span>}
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2">{module.description}</p>
          </div>
          {!loading && (
            <ModuleInstallActions
              module={module}
              updateAvailable={updateAvailable}
              onInstall={onInstall}
              onRemove={onRemove}
              onUpdate={onUpdate}
              isInstalling={isInstalling}
              installDisabled={installDisabled}
              installDisabledReason={installDisabledReason}
              installProgressMessage={installProgressMessage}
              installSucceeded={installSucceeded}
            />
          )}
        </div>
        {!loading && installError && (
          <InstallErrorBanner error={installError} onDismissError={onDismissError} />
        )}
      </div>

      <div className="px-6 border-b shrink-0">
        <div className="flex gap-6">
          <TopTabButton active={topTab === "details"} onClick={() => setTopTab("details")}>
            DETAILS
          </TopTabButton>
          <TopTabButton active={topTab === "definitions"} onClick={() => setTopTab("definitions")}>
            DEFINITIONS
          </TopTabButton>
          {module.isInstalled && (
            <>
              <TopTabButton active={topTab === "settings"} onClick={() => setTopTab("settings")}>
                SETTINGS
              </TopTabButton>
              <TopTabButton active={topTab === "resources"} onClick={() => setTopTab("resources")}>
                RESOURCES
              </TopTabButton>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : topTab === "details" ? (
        <DetailsTab module={module} />
      ) : topTab === "definitions" ? (
        <ResourcesTab
          activeType={resourceTab}
          onSelectType={setResourceTab}
          counts={resourceCounts}
          triggers={triggers}
          actions={actions}
          functions={functions}
          widgets={widgets}
          workflows={workflows}
        />
      ) : topTab === "settings" ? (
        <SettingsTab
          instanceId={instanceId}
          moduleId={module.identifier ?? ""}
          manifestSettings={manifestSettings ?? []}
        />
      ) : (
        <ManageResourcesTab
          instanceId={instanceId}
          moduleDbId={moduleDbId}
          moduleName={module.identifier ?? ""}
          manifestResourceKinds={manifestResourceKinds ?? []}
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

interface ModuleInstallActionsProps {
  module: ModuleDetailMeta;
  updateAvailable: boolean;
  onInstall?: () => void;
  onRemove?: () => void;
  onUpdate?: () => void;
  isInstalling?: boolean;
  installDisabled?: boolean;
  installDisabledReason?: string;
  installProgressMessage?: string | null;
  installSucceeded?: boolean;
}

function ModuleInstallActions({
  module,
  updateAvailable,
  onInstall,
  onRemove,
  onUpdate,
  isInstalling,
  installDisabled,
  installDisabledReason,
  installProgressMessage,
  installSucceeded,
}: ModuleInstallActionsProps) {
  return (
    <div className="flex flex-col items-end gap-2 shrink-0">
      {updateAvailable && onUpdate && (
        <Button
          size="sm"
          variant="outline"
          className="border-amber-500/50 text-amber-600 dark:text-amber-400"
          onClick={onUpdate}
          disabled={isInstalling}
          title={`Update available: v${module.version} → v${module.latestVersion}`}
        >
          {isInstalling ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />
              <span className="truncate max-w-[10rem]">{installProgressMessage || "Updating..."}</span>
            </>
          ) : (
            <>
              <Download className="h-4 w-4 mr-2 shrink-0" />
              Update to v{module.latestVersion}
            </>
          )}
        </Button>
      )}
      {module.isInstalled
        ? onRemove && (
            <Button variant="destructive" size="sm" onClick={onRemove}>
              <Trash2 className="h-4 w-4 mr-2" />
              Remove
            </Button>
          )
        : onInstall && (
            <Button
              size="sm"
              variant="default"
              onClick={onInstall}
              disabled={isInstalling || installDisabled}
              title={installDisabledReason}
            >
              {isInstalling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />
                  <span className="truncate max-w-[10rem]">{installProgressMessage || "Installing..."}</span>
                </>
              ) : installSucceeded ? (
                <>
                  <Check className="h-4 w-4 mr-2 shrink-0" />
                  Installed
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Install
                </>
              )}
            </Button>
          )}
    </div>
  );
}

function InstallErrorBanner({
  error,
  onDismissError,
}: {
  error: string;
  onDismissError?: () => void;
}) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 ml-12">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
          <p className="text-xs text-destructive break-words">{error}</p>
        </div>
        {onDismissError && (
          <button
            type="button"
            onClick={onDismissError}
            className="shrink-0 text-destructive/60 hover:text-destructive transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            <span className="sr-only">Dismiss error</span>
          </button>
        )}
      </div>
    </div>
  );
}

function DetailsTab({ module }: { module: ModuleDetailMeta }) {
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
        {module.isInstalled &&
          module.latestVersion &&
          isNewerVersion(module.latestVersion, module.version) && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Update available: v{module.version} → v{module.latestVersion}
            </p>
          )}
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
  workflows: ModuleDetailWorkflow[] | undefined;
}

function ResourcesTab(props: ResourcesTabProps) {
  const { activeType, onSelectType, counts, triggers, actions, functions, widgets, workflows } = props;
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
        {activeType === "workflows" && <WorkflowList items={workflows} />}
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

function WorkflowList({ items }: { items: ModuleDetailWorkflow[] | undefined }) {
  if (items === undefined) {
    return <LoadingState />;
  }
  if (items.length === 0) {
    return <EmptyState message="This module does not declare any workflows." />;
  }
  return (
    <div className="space-y-2">
      {items.map((workflow) => (
        <div key={workflow.slug} className="flex items-start gap-3 p-3 rounded-md border bg-card">
          <div className="h-8 w-8 rounded flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
            <WorkflowIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{workflow.name}</p>
            <p className="text-xs text-muted-foreground font-mono">{workflow.slug}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Settings Tab ---

interface SettingsTabProps {
  instanceId?: Id<"instances">;
  moduleId: string;
  manifestSettings: ManifestSettingField[];
}

function SettingsTab({ instanceId, moduleId, manifestSettings }: SettingsTabProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loadedValues, setLoadedValues] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const getSettingsAction = useAction(api.moduleSettingsActions.getModuleSettings);
  const updateSettingAction = useAction(api.moduleSettingsActions.updateModuleSetting);

  const [loadState, setLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [loadError, setLoadError] = useState<string | null>(null);

  function loadSettings() {
    if (!instanceId || !moduleId) {
      return;
    }
    setLoadState("loading");
    setLoadError(null);
    void getSettingsAction({ instanceId, moduleId })
      .then((settings) => {
        const map: Record<string, string> = {};
        for (const s of settings) {
          map[s.key] = s.value;
        }
        setLoadedValues(map);
        setValues(map);
        setLoadState("loaded");
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load settings.");
        setLoadState("error");
      });
  }

  if (loadState === "idle" && instanceId) {
    loadSettings();
  }

  if (manifestSettings.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No Settings Found</p>
      </div>
    );
  }

  if (loadState === "loading") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-destructive">{loadError}</p>
      </div>
    );
  }

  async function handleSave(key: string) {
    if (!instanceId) {
      return;
    }
    setSaving(key);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      await updateSettingAction({ instanceId, moduleId, key, value: values[key] ?? "" });
      setSaveSuccess(key);
      setTimeout(() => setSaveSuccess(null), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save setting.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <ScrollArea className="flex-1">
      <div className="px-6 py-4 space-y-6 max-w-xl">
        {saveError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {saveError}
          </div>
        )}
        {manifestSettings.map((field) => {
          if (field.type === "button") {
            return <SettingButtonRow key={field.id} instanceId={instanceId} moduleId={moduleId} field={field} />;
          }
          const currentValue = values[field.id] ?? loadedValues?.[field.id] ?? field.default ?? "";
          const isDirty = currentValue !== (loadedValues?.[field.id] ?? field.default ?? "");
          return (
            <div key={field.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor={`setting-${field.id}`} className="text-sm font-medium">
                  {field.name}
                  {field.required && <span className="text-destructive ml-1">*</span>}
                </Label>
                <Button
                  size="sm"
                  variant={saveSuccess === field.id ? "secondary" : "outline"}
                  className="h-7 px-3 text-xs"
                  disabled={!isDirty || saving === field.id}
                  onClick={() => void handleSave(field.id)}
                >
                  {saving === field.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : saveSuccess === field.id ? (
                    <>
                      <Check className="h-3 w-3 mr-1" />
                      Saved
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
              {field.description && (
                <p className="text-xs text-muted-foreground">{field.description}</p>
              )}
              <Input
                id={`setting-${field.id}`}
                type={field.type === "number" ? "number" : "text"}
                value={currentValue}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                className="font-mono text-sm"
              />
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

interface SettingButtonRowProps {
  instanceId?: Id<"instances">;
  moduleId: string;
  field: ManifestSettingField;
}

function SettingButtonRow({ instanceId, moduleId, field }: SettingButtonRowProps) {
  if (field.action?.kind === "internal") {
    return <InternalSettingButton instanceId={instanceId} field={field} action={field.action} />;
  }
  if (field.action?.kind === "integration") {
    return <IntegrationSettingButton instanceId={instanceId} moduleId={moduleId} field={field} action={field.action} />;
  }
  return null;
}

function InternalSettingButton({
  instanceId,
  field,
  action,
}: {
  instanceId?: Id<"instances">;
  field: ManifestSettingField;
  action: Extract<NonNullable<ManifestSettingField["action"]>, { kind: "internal" }>;
}) {
  const { trigger, status, message } = useInternalSettingAction(instanceId, action.request, action.timeoutMs);
  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" disabled={status === "pending"} onClick={trigger}>
        {status === "pending" && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
        {field.name}
      </Button>
      {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
      {status === "success" && message && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600">
          {message}
        </div>
      )}
      {status === "error" && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {message}
        </div>
      )}
    </div>
  );
}

function IntegrationSettingButton({
  instanceId,
  moduleId,
  field,
  action,
}: {
  instanceId?: Id<"instances">;
  moduleId: string;
  field: ManifestSettingField;
  action: Extract<NonNullable<ManifestSettingField["action"]>, { kind: "integration" }>;
}) {
  const handleClick = () => {
    if (!instanceId) {
      return;
    }
    // The current path already deep-links back to this module (modules.tsx
    // resolves /modules/:id via routeModuleId), so redirecting to it as-is
    // — plus whatever result params the callback appends — is enough.
    const url = new URL(`${CONVEX_SITE_URL}/api/integrations/${action.integration}/start`);
    url.searchParams.set("instanceId", instanceId);
    url.searchParams.set("moduleId", moduleId);
    url.searchParams.set("redirect_to", window.location.pathname);
    window.location.href = url.toString();
  };
  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" disabled={!instanceId} onClick={handleClick}>
        {field.name}
      </Button>
      {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
    </div>
  );
}

// --- Manage Resources Tab ---

interface ManageResourcesTabProps {
  instanceId?: Id<"instances">;
  moduleDbId?: Id<"moduleRepository">;
  moduleName: string;
  manifestResourceKinds: ManifestResourceKind[];
}

function ManageResourcesTab({ instanceId, moduleDbId, moduleName, manifestResourceKinds }: ManageResourcesTabProps) {
  const [createDialogKind, setCreateDialogKind] = useState<ManifestResourceKind | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ canonicalId: string; kind: string; resourceInstanceId: string; displayName: string } | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const instances = useQuery(
    api.moduleResourceInstances.listByModule,
    instanceId && moduleDbId ? { instanceId, moduleId: moduleDbId } : "skip"
  );

  const createAction = useAction(api.moduleResourceActions.createResourceInstance);
  const deleteAction = useAction(api.moduleResourceActions.deleteResourceInstance);

  if (manifestResourceKinds.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No Resources Found</p>
      </div>
    );
  }

  async function handleDelete() {
    if (!deleteTarget || !instanceId) {
      return;
    }
    setDeleting(deleteTarget.canonicalId);
    setOpError(null);
    try {
      await deleteAction({
        instanceId,
        moduleName,
        kind: deleteTarget.kind,
        resourceInstanceId: deleteTarget.resourceInstanceId,
      });
      setDeleteTarget(null);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "Failed to delete resource.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto px-6 py-4 space-y-6">
      {opError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-center justify-between">
          <span>{opError}</span>
          <button type="button" onClick={() => setOpError(null)} className="text-destructive/60 hover:text-destructive ml-2">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {manifestResourceKinds.map((kind) => {
        const kindInstances = (instances ?? []).filter((i) => i.kind === kind.kind);
        return (
          <section key={kind.kind}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold">{kind.name}</h3>
                {kind.description && (
                  <p className="text-xs text-muted-foreground">{kind.description}</p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5"
                onClick={() => { setCreateDialogKind(kind); setOpError(null); }}
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </Button>
            </div>

            {instances === undefined ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : kindInstances.length === 0 ? (
              <p className="text-xs text-muted-foreground">No instances yet.</p>
            ) : (
              <div className="space-y-2">
                {kindInstances.map((inst) => (
                  <div key={inst._id} className="flex items-center gap-3 p-3 rounded-md border bg-card">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{inst.displayName}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate">{inst.canonicalId}</p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      disabled={deleting === inst.canonicalId}
                      onClick={() => setDeleteTarget({
                        canonicalId: inst.canonicalId,
                        kind: inst.kind,
                        resourceInstanceId: inst.resourceInstanceId,
                        displayName: inst.displayName,
                      })}
                    >
                      {deleting === inst.canonicalId
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />
                      }
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {createDialogKind && instanceId && (
        <CreateResourceDialog
          kind={createDialogKind}
          instanceId={instanceId}
          moduleName={moduleName}
          onClose={() => setCreateDialogKind(null)}
          onCreate={async (resourceInstanceId, displayName) => {
            await createAction({ instanceId, moduleName, kind: createDialogKind.kind, resourceInstanceId, displayName });
          }}
        />
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Resource</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <span className="font-medium text-foreground">{deleteTarget?.displayName}</span>?
            This will also remove its stored value and cannot be undone.
          </p>
          <p className="text-xs font-mono text-muted-foreground mt-1">{deleteTarget?.canonicalId}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!!deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface CreateResourceDialogProps {
  kind: ManifestResourceKind;
  instanceId: Id<"instances">;
  moduleName: string;
  onClose: () => void;
  onCreate: (resourceInstanceId: string, displayName: string) => Promise<void>;
}

function CreateResourceDialog({ kind, onClose, onCreate }: CreateResourceDialogProps) {
  const [resourceInstanceId, setResourceInstanceId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!resourceInstanceId.trim() || !displayName.trim()) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await onCreate(resourceInstanceId.trim(), displayName.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create resource.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) { onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New {kind.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="new-resource-id">ID</Label>
            <Input
              id="new-resource-id"
              placeholder="e.g. death_count"
              value={resourceInstanceId}
              onChange={(e) => setResourceInstanceId(e.target.value)}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Stable identifier used in workflows and actions. Cannot be changed.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-resource-name">Display Name</Label>
            <Input
              id="new-resource-name"
              placeholder="e.g. Death Count"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!resourceInstanceId.trim() || !displayName.trim() || creating}
            onClick={() => void handleCreate()}
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
