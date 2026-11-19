import type { TriggerFields } from "@shared/trigger-identity";
import { findMergeTarget, isModuleWorkflowName, type MergeWorkflowFields } from "@shared/workflow-merge";
import type { WorkflowDefinition } from "@woofx3/api";
import type { InstanceContext } from "../workflowActions";
import { createEngineRpcSession, type EngineApi } from "./engineInstanceUrl";
import { ENGINE_SYNC_CONFIG } from "./engineSync/config";

type EngineWorkflow = Awaited<ReturnType<EngineApi["getWorkflows"]>>["workflows"][number];

/** Bounds the read on an engine that keeps answering full pages. */
const MAX_WORKFLOW_PAGES = 1000;

/**
 * Every workflow on the engine, read page by page. `newApi` opens a session per
 * page, because a capnweb HTTP batch session is spent by its first await.
 */
export async function readAllEngineWorkflows(newApi: () => EngineApi): Promise<EngineWorkflow[]> {
  const { pageSize } = ENGINE_SYNC_CONFIG;
  const all: EngineWorkflow[] = [];
  for (let page = 1; page <= MAX_WORKFLOW_PAGES; page++) {
    const { workflows } = await newApi().getWorkflows({ page, pageSize });
    all.push(...(workflows ?? []));
    if ((workflows ?? []).length < pageSize) {
      return all;
    }
  }
  throw new Error(`The engine's workflow list ran past ${MAX_WORKFLOW_PAGES} pages of ${pageSize}.`);
}

/**
 * The workflow a new item should extend, or undefined: a switched-on,
 * streamer-owned workflow on the same event and conditions. Reads the engine
 * directly so installs made without a signed-in user (setup) get the same
 * answer. A paused or module-owned workflow is never a candidate.
 */
export async function findEngineMergeTarget(
  instance: InstanceContext,
  trigger: TriggerFields
): Promise<(EngineWorkflow & { definition: WorkflowDefinition }) | undefined> {
  const session = () => createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret);
  const candidates = (await readAllEngineWorkflows(session)).flatMap((workflow) => {
    if (workflow.definition === null) {
      return [];
    }
    const candidate: MergeWorkflowFields & EngineWorkflow = {
      ...workflow,
      id: workflow.id,
      isEnabled: workflow.isEnabled,
      managed: isModuleWorkflowName(workflow.name),
      definition: workflow.definition,
    };
    return [candidate];
  });
  return findMergeTarget(candidates, trigger);
}
