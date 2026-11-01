import { FORM_KIND, WOOFX3_MODULE } from "@shared/resource-kinds";
import { parseFormFields } from "@shared/user-pages";
import { ListPlus, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { CreateResourceDialog } from "@/components/modules/create-resource-dialog";
import { AddFormToQueueDialog } from "@/components/resources/add-form-to-queue-dialog";
import { Button } from "@/components/ui/button";
import {
  useCreateResourceInstanceRequest,
  useResourceInstancesOfKind,
  useResourceKind,
} from "@/engine/hooks/use-module-resources";
import { resourceName, resourceSettings } from "@/lib/resource-instance";
import { resourceKindPath } from "@/lib/resource-kind-route";

/**
 * What can be done from a page's form widget without leaving the page: make a
 * new form, and send the chosen one's answers to a queue. A form is edited on
 * its own page, since it may sit on several.
 */
export function FormWidgetActions({ value, onChange }: { value: string; onChange: (canonicalId: string) => void }) {
  const kind = useResourceKind(FORM_KIND);
  const forms = useResourceInstancesOfKind(FORM_KIND);
  const createInstance = useCreateResourceInstanceRequest();
  const [creating, setCreating] = useState(false);
  const [addingToQueue, setAddingToQueue] = useState(false);
  const chosen = forms?.find((row) => row.canonicalId === value);
  const settings = chosen ? resourceSettings(chosen) : null;
  const hasQuestions = settings !== null && parseFormFields(settings.fields).length > 0;
  const formPath = `${resourceKindPath(WOOFX3_MODULE, "form")}/${encodeURIComponent(chosen?.resourceInstanceId ?? "")}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!kind}
          onClick={() => setCreating(true)}
          data-testid="button-new-form-for-widget"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New form
        </Button>
        {chosen && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddingToQueue(true)}
            data-testid="button-widget-form-to-queue"
          >
            <ListPlus className="mr-1.5 h-3.5 w-3.5" />
            Add to a queue
          </Button>
        )}
        {chosen && (
          <Link href={formPath} className="text-sm font-medium underline">
            Edit its questions
          </Link>
        )}
      </div>
      {chosen && !hasQuestions && (
        <p className="text-xs text-muted-foreground" data-testid="form-widget-no-questions">
          This form has no questions yet, so visitors will see it as unavailable.
        </p>
      )}
      {creating && kind && (
        <CreateResourceDialog
          moduleId={kind.moduleName}
          kind={{ kind: kind.kind, name: kind.name, schema: kind.schema }}
          onClose={() => setCreating(false)}
          onCreate={async (resourceInstanceId, displayName, created) => {
            await createInstance({
              moduleName: kind.moduleName,
              kind: kind.kind,
              resourceInstanceId,
              displayName,
              settings: created,
            });
            onChange(`${kind.moduleName}:${kind.kind}:${resourceInstanceId}`);
          }}
        />
      )}
      {addingToQueue && chosen && settings && (
        <AddFormToQueueDialog
          formId={chosen.canonicalId}
          formName={resourceName(chosen)}
          settings={settings}
          onClose={() => setAddingToQueue(false)}
        />
      )}
    </div>
  );
}
