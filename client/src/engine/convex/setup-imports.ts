import { api } from "@convex/_generated/api";
import type { ImportReport, ImportReportItem } from "@convex/setupImports";
import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback } from "react";
import type { SetupImportsGateway } from "@/engine/gateway";
import type {
  SetupImportAnalysis,
  SetupImportId,
  SetupImportItem,
  SetupImportLeftover,
  SetupImportNote,
  SetupImportReport,
} from "@/engine/types";
import { withPlainError } from "./errors";
import { fromSetupImportId, toSetupImportId } from "./ids";
import { useMappedValue } from "./mapped";
import { requireInstance, useScopeInstanceId } from "./scope";

// Convex reads the export into a report of the items it would create, and
// creates them on the engine once the streamer starts it, in scheduled
// slices with each item's outcome recorded as it goes.

function toSetupImportNote(note: ImportReportItem["notes"][number]): SetupImportNote {
  return { message: note.message, detail: note.detail, blocking: note.blocking };
}

function toSetupImportLeftover(leftover: ImportReport["leftovers"][number]): SetupImportLeftover {
  return { origin: leftover.origin, name: leftover.name, message: leftover.message, detail: leftover.detail };
}

function toSetupImportItem(item: ImportReportItem): SetupImportItem {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    origin: item.origin,
    readiness: item.readiness,
    notes: item.notes.map(toSetupImportNote),
    steps: item.steps,
    outcome: item.outcome,
    message: item.message,
  };
}

export function toSetupImportReport(report: ImportReport): SetupImportReport {
  return {
    id: toSetupImportId(report.id),
    source: report.source,
    label: report.label,
    status: report.status,
    createdAt: report.createdAt,
    waitingFor: report.waitingFor,
    stalled: report.stalled,
    leftovers: report.leftovers.map(toSetupImportLeftover),
    items: report.items.map(toSetupImportItem),
  };
}

function useLatest() {
  const instanceId = useScopeInstanceId();
  const report = useQuery(api.setupImports.latest, instanceId ? { instanceId } : "skip");
  return useMappedValue(report, toSetupImportReport);
}

function useAnalyzeRequest() {
  const analyze = useAction(api.setupImports.analyze);
  const instanceId = useScopeInstanceId();
  return useCallback(
    async ({ source, documentChunks }: SetupImportAnalysis) => {
      const { importId } = await analyze({ instanceId: requireInstance(instanceId), source, documentChunks }).catch(
        withPlainError
      );
      return { importId: toSetupImportId(importId) };
    },
    [analyze, instanceId]
  );
}

function useStartRequest() {
  const start = useMutation(api.setupImports.start);
  return useCallback(
    async (importId: SetupImportId) => {
      await start({ importId: fromSetupImportId(importId) }).catch(withPlainError);
    },
    [start]
  );
}

function useRetryRequest() {
  const retry = useMutation(api.setupImports.retry);
  return useCallback(
    async (importId: SetupImportId) => {
      await retry({ importId: fromSetupImportId(importId) }).catch(withPlainError);
    },
    [retry]
  );
}

function useDiscardRequest() {
  const discard = useMutation(api.setupImports.discard);
  return useCallback(
    async (importId: SetupImportId) => {
      await discard({ importId: fromSetupImportId(importId) }).catch(withPlainError);
    },
    [discard]
  );
}

export const convexSetupImportsGateway: SetupImportsGateway = {
  useLatest,
  useAnalyzeRequest,
  useStartRequest,
  useRetryRequest,
  useDiscardRequest,
};
