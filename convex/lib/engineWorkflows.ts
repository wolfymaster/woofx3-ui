import type { EngineApi } from "./engineInstanceUrl";
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
