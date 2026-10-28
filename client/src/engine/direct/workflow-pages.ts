import type { Workflow } from "@woofx3/api";
import type { DirectRuntime } from "./runtime";

/**
 * Every workflow on the engine, read page by page: the engine pages its
 * list and says nothing about a page beyond its rows, so a short page ends
 * it. Throws past `workflowMaxPages` rather than looping on an engine that
 * keeps answering full pages.
 */
export async function readAllWorkflows(runtime: DirectRuntime): Promise<Workflow[]> {
  const { workflowPageSize: pageSize, workflowMaxPages } = runtime.config;
  const all: Workflow[] = [];
  for (let page = 1; page <= workflowMaxPages; page++) {
    const { workflows } = await runtime.call("getWorkflows", (api) => api.getWorkflows({ page, pageSize }));
    all.push(...workflows);
    if (workflows.length < pageSize) {
      return all;
    }
  }
  throw new Error(`The engine's workflow list ran past ${workflowMaxPages} pages of ${pageSize}.`);
}
