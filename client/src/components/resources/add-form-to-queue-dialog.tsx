import { escapeDollarKeys } from "@shared/dollar-keys";
import { FORM_KIND, QUEUE_KIND, WOOFX3_MODULE } from "@shared/resource-kinds";
import { parseFormFields } from "@shared/user-pages";
import { Loader2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { suggestInstanceId } from "@/components/modules/create-resource-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  useCreateResourceInstanceRequest,
  useResourceInstancesOfKind,
  useResourceKind,
} from "@/engine/hooks/use-module-resources";
import { useCreateWorkflowRequest, useSetWorkflowEnabledRequest, useWorkflows } from "@/engine/hooks/use-workflows";
import { toast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { conditionFieldsOf, eventTriggers, nextTriggerOrder } from "@/lib/alert-triggers";
import {
  FORM_SUBMITTED_EVENT,
  formQueueEntryChoices,
  formQueueWorkflowTree,
  QUEUE_ADD_ACTION_REF,
  reviewQueueFor,
} from "@/lib/form-kind";
import { parseConfigFields } from "@/lib/parse-config-fields";
import { resourceActions } from "@/lib/resource-actions";
import { resourceName } from "@/lib/resource-instance";
import { resourceTriggers } from "@/lib/resource-triggers";
import { getDefaultConfigValues } from "@/lib/workflow-presets";
import { treeToDefinition } from "@/lib/workflow-tree";

const NEW_QUEUE = "new-queue";
const CUSTOM_ENTRY = "custom-entry";

/**
 * Sends a form's answers to a queue by writing an ordinary workflow: when this
 * form is submitted, add this to that queue. There is no second delivery path,
 * so the result shows up with the form's other triggers and edits like them.
 */
export function AddFormToQueueDialog({
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
  const queues = useResourceInstancesOfKind(QUEUE_KIND);
  const queueKind = useResourceKind(QUEUE_KIND);
  const { triggerPresets, actionPresets, loading } = useWorkflowCatalog();
  const workflows = useWorkflows();
  const createQueue = useCreateResourceInstanceRequest();
  const createWorkflow = useCreateWorkflowRequest();
  const setEnabled = useSetWorkflowEnabledRequest();

  const choices = useMemo(() => formQueueEntryChoices(parseFormFields(settings.fields)), [settings.fields]);
  const [queue, setQueue] = useState("");
  const [queueName, setQueueName] = useState("");
  const [entryChoice, setEntryChoice] = useState(choices[0].value);
  const [customEntry, setCustomEntry] = useState("");
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);

  const creatingQueue = queue === NEW_QUEUE;
  const newQueueId = suggestInstanceId(queueName);
  const entry = entryChoice === CUSTOM_ENTRY ? customEntry.trim() : entryChoice;
  const ready =
    !loading &&
    workflows !== undefined &&
    queue !== "" &&
    (!creatingQueue || newQueueId !== "") &&
    (!(creatingQueue || review) || queueKind) &&
    entry !== "" &&
    !saving;

  const onAdd = async () => {
    const trigger = resourceTriggers(triggerPresets, FORM_KIND).find(
      (candidate) => candidate.preset.event === FORM_SUBMITTED_EVENT
    );
    const queueAdd = resourceActions(actionPresets, QUEUE_KIND).find(
      (action) => action.preset.canonicalRef === QUEUE_ADD_ACTION_REF
    );
    if (!trigger || !queueAdd || workflows === undefined) {
      toast({
        title: "Couldn't add it to a queue",
        description: "Update your engine to get forms and queues working together.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      let queueId = queue;
      if (creatingQueue) {
        queueId = `${WOOFX3_MODULE}:queue:${newQueueId}`;
        await createQueue({
          moduleName: WOOFX3_MODULE,
          kind: "queue",
          resourceInstanceId: newQueueId,
          displayName: queueName.trim(),
          settings: getDefaultConfigValues(parseConfigFields(queueKind?.schema)) as Record<string, unknown>,
        });
      }
      const chosenQueue = queues?.find((row) => row.canonicalId === queue);
      const queueLabel = chosenQueue ? resourceName(chosenQueue) : queueName.trim();
      let entriesGoTo = queueId;
      if (review) {
        const reviewQueue = reviewQueueFor(queues ?? [], queueId, queueLabel);
        if (reviewQueue.kind === "existing") {
          entriesGoTo = reviewQueue.canonicalId;
        } else {
          entriesGoTo = `${WOOFX3_MODULE}:queue:${reviewQueue.resourceInstanceId}`;
          await createQueue({
            moduleName: WOOFX3_MODULE,
            kind: "queue",
            resourceInstanceId: reviewQueue.resourceInstanceId,
            displayName: reviewQueue.displayName,
            settings: {
              ...(getDefaultConfigValues(parseConfigFields(queueKind?.schema)) as Record<string, unknown>),
              approveInto: queueId,
            },
          });
        }
      }
      const tree = formQueueWorkflowTree({
        triggerPreset: trigger.preset,
        conditionFields: conditionFieldsOf(trigger.preset),
        order: nextTriggerOrder(eventTriggers(workflows, FORM_SUBMITTED_EVENT)),
        form: { fieldId: trigger.fieldId, value: formId },
        queueAdd: queueAdd.preset,
        queue: { fieldId: queueAdd.fieldId, value: entriesGoTo },
        entry,
      });
      const { id: _unsaved, ...definition } = treeToDefinition(tree);
      const { engineWorkflowId } = await createWorkflow(
        escapeDollarKeys({ ...definition, name: `${formName} answers join ${queueLabel}` })
      );
      await setEnabled(engineWorkflowId, true);
      toast({
        title: review ? `Answers now wait for review before joining ${queueLabel}` : `Answers now join ${queueLabel}`,
      });
      onClose();
    } catch (err) {
      toast({
        title: "Couldn't add it to a queue",
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
          <DialogTitle>Add {formName} to a queue</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor={`${id}-queue`}>Queue</Label>
            <Select value={queue === "" ? undefined : queue} onValueChange={setQueue} disabled={queues === undefined}>
              <SelectTrigger id={`${id}-queue`} data-testid="select-form-queue">
                <SelectValue placeholder="Choose a queue" />
              </SelectTrigger>
              <SelectContent>
                {(queues ?? []).map((row) => (
                  <SelectItem key={row.canonicalId} value={row.canonicalId}>
                    {resourceName(row)}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_QUEUE}>New queue</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {creatingQueue && (
            <div className="space-y-2">
              <Label htmlFor={`${id}-queue-name`}>New queue's name</Label>
              <Input
                id={`${id}-queue-name`}
                placeholder="e.g. Song requests"
                value={queueName}
                onChange={(event) => setQueueName(event.target.value)}
                data-testid="input-form-queue-name"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${id}-entry`}>What goes in line</Label>
            <Select value={entryChoice} onValueChange={setEntryChoice}>
              <SelectTrigger id={`${id}-entry`} data-testid="select-form-queue-entry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {choices.map((choice) => (
                  <SelectItem key={choice.value} value={choice.value}>
                    {choice.label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_ENTRY}>Something else</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {entryChoice === CUSTOM_ENTRY && (
            <div className="space-y-2">
              <Label htmlFor={`${id}-entry-custom`}>Text</Label>
              <Input
                id={`${id}-entry-custom`}
                placeholder="${trigger.data.viewer.displayName}: ..."
                value={customEntry}
                onChange={(event) => setCustomEntry(event.target.value)}
                data-testid="input-form-queue-entry"
              />
              <p className="text-xs text-muted-foreground">
                You can change this later in the workflow, where every answer is on offer.
              </p>
            </div>
          )}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor={`${id}-review`}>Review answers first</Label>
              <p className="text-xs text-muted-foreground">
                Answers wait in a separate queue until you approve them, so nothing reaches this queue, or a scene
                showing it, without you seeing it first.
              </p>
            </div>
            <Switch
              id={`${id}-review`}
              checked={review}
              onCheckedChange={setReview}
              data-testid="switch-form-queue-review"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={() => void onAdd()} data-testid="button-confirm-form-queue">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add to queue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
