import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { ArrowLeft, Bell, Loader2, Puzzle, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { UninstallModuleDialog } from "@/components/modules/uninstall-module-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useInstance } from "@/hooks/use-instance";

export default function ModuleDetail() {
  const [, navigate] = useLocation();
  const [match, params] = useRoute("/modules/:id");
  const moduleId = params?.id as Id<"moduleRepository"> | undefined;
  const { instance } = useInstance();
  const [uninstallOpen, setUninstallOpen] = useState(false);

  const module = useQuery(api.moduleRepository.get, moduleId ? { moduleId } : "skip");
  const triggers = useQuery(api.triggerDefinitions.listByModule, moduleId ? { moduleId } : "skip");
  const actions = useQuery(api.actionDefinitions.listByModule, moduleId ? { moduleId } : "skip");

  if (!match) {
    return null;
  }

  if (module === undefined) {
    return (
      <div className="p-6 lg:p-8 max-w-[1600px] mx-auto flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (module === null) {
    return (
      <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
        <PageHeader
          title="Module Not Found"
          description="The requested module could not be found."
          actions={
            <Button variant="outline" onClick={() => navigate("/modules")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Modules
            </Button>
          }
        />
      </div>
    );
  }

  const author = (module.manifest?.author as string) || "Unknown";
  const category = (module.manifest?.category as string) || "Utilities";

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title={module.name}
        description={module.description || "No description available."}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate("/modules")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Modules
            </Button>
            <Button
              variant="destructive"
              onClick={() => setUninstallOpen(true)}
              disabled={!instance}
              data-testid="button-module-uninstall"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Remove
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Version</span>
              <span>{module.version}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Author</span>
              <span>{author}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Category</span>
              <Badge variant="outline" className="text-xs">
                {category}
              </Badge>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={module.status === "installed" ? "secondary" : "destructive"} className="text-xs">
                {module.status ?? "unknown"}
              </Badge>
            </div>
            {module.tags.length > 0 && (
              <div className="pt-2">
                <span className="text-sm text-muted-foreground">Tags</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {module.tags.map((tag) => (
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
              <p className="text-sm text-muted-foreground">No triggers registered.</p>
            ) : (
              <div className="space-y-3">
                {triggers.map((trigger) => (
                  <div key={trigger._id} className="flex items-start gap-3">
                    <div
                      className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 text-xs"
                      style={{ backgroundColor: `${trigger.color}20`, color: trigger.color }}
                    >
                      <Puzzle className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{trigger.name}</p>
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
              <p className="text-sm text-muted-foreground">No actions registered.</p>
            ) : (
              <div className="space-y-3">
                {actions.map((action) => (
                  <div key={action._id} className="flex items-start gap-3">
                    <div
                      className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 text-xs"
                      style={{ backgroundColor: `${action.color}20`, color: action.color }}
                    >
                      <Zap className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{action.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{action.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {instance && (
        <UninstallModuleDialog
          open={uninstallOpen}
          onOpenChange={setUninstallOpen}
          instanceId={instance._id}
          module={{
            _id: module._id,
            name: module.name,
            version: module.version,
            moduleKey: module.moduleKey,
          }}
          onSuccess={() => navigate("/modules")}
        />
      )}
    </div>
  );
}
