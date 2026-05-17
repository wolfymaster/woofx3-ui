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
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
}

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
  } = props;

  return (
    <div className="p-6">
      <div className="flex items-center gap-4 mb-6">
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
                onClick={onInstall}
                disabled={isInstalling || installDisabled}
                title={installDisabledReason}
              >
                {isInstalling ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Installing...
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

      {loading ? (
        <div className="flex items-center justify-center min-h-[20vh]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Version</span>
                <span>{module.version}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Author</span>
                <span>{module.author || "Unknown"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Category</span>
                <Badge variant="outline" className="text-xs">
                  {module.category}
                </Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
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
              </div>
              {module.tags.length > 0 && (
                <div className="pt-2">
                  <span className="text-sm text-muted-foreground">Tags</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {module.tags.slice(0, 4).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Triggers
                {triggers && (
                  <Badge variant="secondary" className="text-xs">
                    {triggers.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {triggers === undefined ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : triggers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No triggers</p>
              ) : (
                <div className="space-y-2">
                  {triggers.slice(0, 5).map((trigger) => (
                    <div key={trigger.key} className="flex items-start gap-2">
                      <div
                        className="h-6 w-6 rounded flex items-center justify-center shrink-0 text-xs"
                        style={{ backgroundColor: `${trigger.color}20`, color: trigger.color }}
                      >
                        <Puzzle className="h-3 w-3" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{trigger.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{trigger.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Actions
                {actions && (
                  <Badge variant="secondary" className="text-xs">
                    {actions.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {actions === undefined ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No actions</p>
              ) : (
                <div className="space-y-2">
                  {actions.slice(0, 5).map((action) => (
                    <div key={action.key} className="flex items-start gap-2">
                      <div
                        className="h-6 w-6 rounded flex items-center justify-center shrink-0 text-xs"
                        style={{ backgroundColor: `${action.color}20`, color: action.color }}
                      >
                        <Zap className="h-3 w-3" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{action.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{action.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <FileCode className="h-4 w-4" />
                Functions
                {functions && (
                  <Badge variant="secondary" className="text-xs">
                    {functions.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {functions === undefined ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : functions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No functions</p>
              ) : (
                <div className="space-y-2">
                  {functions.slice(0, 5).map((fn) => (
                    <div key={fn.qualifiedName} className="flex items-start gap-2">
                      <div className="h-6 w-6 rounded flex items-center justify-center shrink-0 text-xs bg-muted text-muted-foreground">
                        <FileCode className="h-3 w-3" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{fn.qualifiedName}</p>
                        <p className="text-xs text-muted-foreground truncate">{fn.runtime ?? ""}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {widgets !== undefined && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <WorkflowIcon className="h-4 w-4" />
                  Widgets
                  <Badge variant="secondary" className="text-xs">
                    {widgets.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {widgets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No widgets</p>
                ) : (
                  <div className="space-y-2">
                    {widgets.slice(0, 5).map((widget) => (
                      <div key={widget.slug} className="flex items-start gap-2">
                        <div className="h-6 w-6 rounded flex items-center justify-center shrink-0 text-xs bg-muted text-muted-foreground">
                          <WorkflowIcon className="h-3 w-3" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{widget.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{widget.slug}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
