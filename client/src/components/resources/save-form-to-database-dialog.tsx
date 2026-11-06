import { parseDatabaseColumns } from "@shared/databases/columns";
import { escapeDollarKeys } from "@shared/dollar-keys";
import { DATABASE_KIND, FORM_KIND, WOOFX3_MODULE } from "@shared/resource-kinds";
import { parseFormFields } from "@shared/user-pages";
import { DATABASE_COLUMNS_SETTING } from "@woofx3/api/databases";
import { Loader2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { suggestInstanceId } from "@/components/modules/create-resource-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useCreateResourceInstanceRequest,
  useResourceInstancesOfKind,
  useUpdateResourceInstanceRequest,
} from "@/engine/hooks/use-module-resources";
import {
  useCreateWorkflowRequest,
  useSetWorkflowEnabledRequest,
  useUpdateWorkflowRequest,
  useWorkflows,
} from "@/engine/hooks/use-workflows";
import { toast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { conditionFieldsOf, eventTriggers, nextTriggerOrder } from "@/lib/alert-triggers";
import {
  DATABASE_INSERT_ACTION_REF,
  FORM_SUBMITTED_EVENT,
  formDatabaseColumns,
  formDatabaseTarget,
  formDatabaseValues,
  formDatabaseWorkflow,
  formDatabaseWorkflowTree,
  withInsertValues,
} from "@/lib/form-kind";
import { resourceActions } from "@/lib/resource-actions";
import { resourceName, resourceSettings } from "@/lib/resource-instance";
import { resourceTriggers } from "@/lib/resource-triggers";
import { treeToDefinition } from "@/lib/workflow-tree";

const NEW_DATABASE = "new-database";

/**
 * Saves a form's answers to a database by writing an ordinary workflow: when
 * this form is submitted, add a row with each answer and who sent it. A new
 * database gets one private column per question; an existing one gets the
 * columns it lacks. Running it again for the same database adds new questions
 * to the columns and to the workflow's step rather than writing a second
 * workflow.
 */
export function SaveFormToDatabaseDialog({
  formId,
  formName,
  settings,
  onClose,
}: {
  formId: string;
  formName: string;
  settings: Record<string, unknown>;
  onClose: () => void;
}) {
  const id = useId();
  const databases = useResourceInstancesOfKind(DATABASE_KIND);
  const { triggerPresets, actionPresets, loading } = useWorkflowCatalog();
  const workflows = useWorkflows();
  const createDatabase = useCreateResourceInstanceRequest();
  const updateDatabase = useUpdateResourceInstanceRequest();
  const createWorkflow = useCreateWorkflowRequest();
  const updateWorkflow = useUpdateWorkflowRequest();
  const setEnabled = useSetWorkflowEnabledRequest();

  const fields = useMemo(() => parseFormFields(settings.fields), [settings.fields]);
  const current = useMemo(
    () =>
      workflows === undefined || databases === undefined
        ? null
        : formDatabaseTarget(
            eventTriggers(workflows, FORM_SUBMITTED_EVENT),
            formId,
            databases.map((row) => row.canonicalId)
          ),
    [workflows, databases, formId]
  );
  // Until the streamer picks, the dialog shows where the answers already go, so Save updates that.
  const [picked, setPicked] = useState<string | null>(null);
  const target = picked ?? current ?? NEW_DATABASE;
  const [name, setName] = useState(`${formName} answers`);
  const [saving, setSaving] = useState(false);

  const creating = target === NEW_DATABASE;
  const newDatabaseId = suggestInstanceId(name);
  const ready =
    !loading && workflows !== undefined && databases !== undefined && (!creating || newDatabaseId !== "") && !saving;

  const onSave = async () => {
    const trigger = resourceTriggers(triggerPresets, FORM_KIND).find(
      (candidate) => candidate.preset.event === FORM_SUBMITTED_EVENT
    );
    const insert = resourceActions(actionPresets, DATABASE_KIND).find(
      (action) => action.preset.canonicalRef === DATABASE_INSERT_ACTION_REF
    );
    if (!trigger || !insert || workflows === undefined) {
      toast({
        title: "Couldn't save answers to a database",
        description: "Update your engine to get forms and databases working together.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      let databaseId = target;
      let databaseLabel = name.trim();
      let columns = formDatabaseColumns(fields, []).columns;
      if (creating) {
        databaseId = `${WOOFX3_MODULE}:database:${newDatabaseId}`;
        await createDatabase({
          moduleName: WOOFX3_MODULE,
          kind: "database",
          resourceInstanceId: newDatabaseId,
          displayName: databaseLabel,
          settings: { [DATABASE_COLUMNS_SETTING]: columns },
        });
      } else {
        const instance = databases?.find((row) => row.canonicalId === target);
        if (!instance) {
          throw new Error("That database is gone; pick another.");
        }
        databaseLabel = resourceName(instance);
        const instanceSettings = resourceSettings(instance);
        const merged = formDatabaseColumns(fields, parseDatabaseColumns(instanceSettings));
        columns = merged.columns;
        if (merged.added.length > 0) {
          await updateDatabase({
            canonicalId: instance.canonicalId,
            displayName: databaseLabel,
            settings: { ...instanceSettings, [DATABASE_COLUMNS_SETTING]: columns },
          });
        }
      }

      const values = formDatabaseValues(fields, columns);
      const triggers = eventTriggers(workflows, FORM_SUBMITTED_EVENT);
      const existing = formDatabaseWorkflow(triggers, formId, databaseId);
      if (existing) {
        await updateWorkflow(
          existing.trigger.row.engineWorkflowId,
          escapeDollarKeys(withInsertValues(existing.trigger.definition, existing.taskId, values))
        );
        toast({ title: `Answers to every question now save to ${databaseLabel}` });
        onClose();
        return;
      }
      const tree = formDatabaseWorkflowTree({
        triggerPreset: trigger.preset,
        conditionFields: conditionFieldsOf(trigger.preset),
        order: nextTriggerOrder(triggers),
        form: { fieldId: trigger.fieldId, value: formId },
        insert: insert.preset,
        database: { fieldId: insert.fieldId, value: databaseId },
        values,
      });
      const { id: _unsaved, ...definition } = treeToDefinition(tree);
      const { engineWorkflowId } = await createWorkflow(
        escapeDollarKeys({ ...definition, name: `${formName} answers save to ${databaseLabel}` })
      );
      await setEnabled(engineWorkflowId, true);
      toast({ title: `Answers now save to ${databaseLabel}` });
      onClose();
    } catch (err) {
      toast({
        title: "Couldn't save answers to a database",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save {formName} answers to a database</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Every answer becomes a row, with a column for each question and one for who sent it. Answers stay off your
            public page unless you choose to show a column there.
          </p>
          <div className="space-y-2">
            <Label htmlFor={`${id}-database`}>Database</Label>
            <Select
              value={target}
              onValueChange={setPicked}
              disabled={databases === undefined || workflows === undefined}
            >
              <SelectTrigger id={`${id}-database`} data-testid="select-form-database">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_DATABASE}>New database</SelectItem>
                {(databases ?? []).map((row) => (
                  <SelectItem key={row.canonicalId} value={row.canonicalId}>
                    {resourceName(row)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {creating && (
            <div className="space-y-2">
              <Label htmlFor={`${id}-database-name`}>New database's name</Label>
              <Input
                id={`${id}-database-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                data-testid="input-form-database-name"
              />
            </div>
          )}
          {!creating && (
            <p className="text-xs text-muted-foreground">
              Questions the database has no column for yet get one. Already saving there? This adds your newest
              questions.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={() => void onSave()} data-testid="button-confirm-form-database">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save answers
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
