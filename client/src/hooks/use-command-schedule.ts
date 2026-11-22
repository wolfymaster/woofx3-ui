import { escapeDollarKeys } from "@shared/dollar-keys";
import { SCHEDULE_KIND, WOOFX3_MODULE } from "@shared/resource-kinds";
import { useMemo } from "react";
import { suggestInstanceId } from "@/components/modules/create-resource-dialog";
import { useEngineScope } from "@/engine/context";
import {
  useCreateResourceInstanceRequest,
  useResourceInstancesOfKind,
  useRunResourceActionsRequest,
} from "@/engine/hooks/use-module-resources";
import {
  useCreateWorkflowRequest,
  useDeleteWorkflowRequest,
  useSetWorkflowEnabledRequest,
  useUpdateWorkflowRequest,
  useWorkflows,
} from "@/engine/hooks/use-workflows";
import type { ModuleResourceInstance } from "@/engine/types";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { conditionFieldsOf, eventTriggers, newTriggerTree } from "@/lib/alert-triggers";
import {
  bareCommandWord,
  COMMAND_RUN_ACTION_REF,
  type CommandScheduleLink,
  commandScheduleLinks,
  SCHEDULE_FIRED_EVENT,
  type ScheduleChoice,
  withCommandWord,
} from "@/lib/command-schedule";
import { resourceActionStep } from "@/lib/resource-actions";
import { resourceName } from "@/lib/resource-instance";
import { resourceTriggers } from "@/lib/resource-triggers";
import { treeToDefinition } from "@/lib/workflow-tree";

const SCHEDULE_START_ACTION = "schedule.start";

export interface CommandScheduleState {
  /** False until the workflows, schedules and catalog have loaded, or when the engine lacks what the card needs. */
  ready: boolean;
  /** Why the card cannot offer a schedule on this engine, or null. */
  unavailable: string | null;
  schedules: ModuleResourceInstance[];
  /** The schedule choice as stored for the command `word`: its first schedule trigger, or none. */
  stored: ScheduleChoice;
  /** Brings the stored schedules in line with `choice`, for a command now called `word`. */
  apply: (previousWord: string | undefined, word: string, choice: ScheduleChoice) => Promise<void>;
}

/**
 * A command's schedule: the workflows that run it when a schedule fires, which are
 * ordinary workflows the builder shows too. The command editor adds, moves and removes
 * them, and creates the schedule when the streamer asks for a new one.
 */
export function useCommandSchedule(storedWord: string | undefined): CommandScheduleState {
  const { instanceId } = useEngineScope();
  const schedules = useResourceInstancesOfKind(SCHEDULE_KIND);
  const workflows = useWorkflows();
  const { triggerPresets, actionPresets, loading } = useWorkflowCatalog();
  const createSchedule = useCreateResourceInstanceRequest();
  const runActions = useRunResourceActionsRequest();
  const createWorkflow = useCreateWorkflowRequest();
  const updateWorkflow = useUpdateWorkflowRequest();
  const deleteWorkflow = useDeleteWorkflowRequest();
  const setEnabled = useSetWorkflowEnabledRequest();

  const trigger = useMemo(
    () =>
      resourceTriggers(triggerPresets, SCHEDULE_KIND).find(
        (candidate) => candidate.preset.event === SCHEDULE_FIRED_EVENT
      ),
    [triggerPresets]
  );
  const runPreset = useMemo(
    () => actionPresets.find((preset) => preset.canonicalRef === COMMAND_RUN_ACTION_REF),
    [actionPresets]
  );
  const fields = useMemo(() => conditionFieldsOf(trigger?.preset), [trigger]);

  const links = useMemo<CommandScheduleLink[]>(() => {
    if (!trigger || workflows === undefined || storedWord === undefined) {
      return [];
    }
    return commandScheduleLinks(eventTriggers(workflows, SCHEDULE_FIRED_EVENT), fields, trigger.fieldId, storedWord);
  }, [trigger, workflows, fields, storedWord]);

  const stored = useMemo<ScheduleChoice>(() => {
    const pinned = links.find((link) => link.canonicalId !== null);
    return pinned?.canonicalId ? { kind: "existing", canonicalId: pinned.canonicalId } : { kind: "none" };
  }, [links]);

  const ready = !loading && workflows !== undefined && schedules !== undefined;
  const unavailable = ready && (!trigger || !runPreset) ? "Update your engine to run commands on a schedule." : null;

  async function apply(previousWord: string | undefined, word: string, choice: ScheduleChoice): Promise<void> {
    if (!trigger || !runPreset || !instanceId || schedules === undefined) {
      throw new Error("This engine can't run commands on a schedule yet.");
    }
    const renamed = previousWord !== undefined && bareCommandWord(previousWord) !== bareCommandWord(word);
    let remaining = links;
    if (renamed) {
      for (const link of remaining) {
        await updateWorkflow(
          link.trigger.row.engineWorkflowId,
          escapeDollarKeys(withCommandWord(link.trigger.definition, previousWord, word))
        );
      }
    }

    let target: string | null = null;
    let targetLabel = "";
    if (choice.kind === "existing") {
      target = choice.canonicalId;
      const instance = schedules.find((row) => row.canonicalId === target);
      targetLabel = instance ? resourceName(instance) : target;
    } else if (choice.kind === "new") {
      const resourceInstanceId = suggestInstanceId(choice.name);
      if (resourceInstanceId === "") {
        throw new Error("Name the new schedule with letters or numbers.");
      }
      if (schedules.some((row) => row.canonicalId === `${WOOFX3_MODULE}:schedule:${resourceInstanceId}`)) {
        throw new Error(`A schedule called "${choice.name.trim()}" already exists; pick it from the list instead.`);
      }
      const created = await createSchedule({
        moduleName: WOOFX3_MODULE,
        kind: "schedule",
        resourceInstanceId,
        displayName: choice.name.trim(),
        settings: { lifetime: "forever", interval: choice.minutes, runWhileOffline: choice.runWhileOffline },
      });
      target = created.canonicalId;
      targetLabel = choice.name.trim();
      // New schedules start stopped; one made to run a command is meant to run.
      const start = resourceActionStep(actionPresets, WOOFX3_MODULE, SCHEDULE_START_ACTION, { target });
      await runActions(`dashboard:${target}`, escapeDollarKeys([start]) as unknown[]);
    }

    const keep = target === null ? undefined : remaining.find((link) => link.canonicalId === target);
    for (const link of remaining) {
      if (link !== keep) {
        await deleteWorkflow(link.trigger.row.engineWorkflowId);
      }
    }
    remaining = keep ? [keep] : [];

    if (target !== null && !keep) {
      const tree = newTriggerTree({
        triggerPreset: trigger.preset,
        conditionFields: fields,
        pin: { fieldId: trigger.fieldId, value: target },
        seed: runPreset,
        seedParameters: { command: word },
      });
      const { id: _unsaved, ...definition } = treeToDefinition(tree);
      const { engineWorkflowId } = await createWorkflow(
        escapeDollarKeys({ ...definition, name: `!${bareCommandWord(word)} on ${targetLabel}` })
      );
      await setEnabled(engineWorkflowId, true);
    }
  }

  return { ready, unavailable, schedules: schedules ?? [], stored, apply };
}
