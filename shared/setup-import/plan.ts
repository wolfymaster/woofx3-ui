import { escapeDollarKeys } from "@shared/dollar-keys";
import { flattenSteps } from "./build";
import { convertFirebot } from "./firebot";
import { asRecord, asString } from "./read";
import { convertStreamerbot } from "./streamerbot";
import {
  IMPORT_KIND_ORDER,
  type ImportItem,
  type ImportPlan,
  type ImportReadiness,
  type ImportSource,
  itemReadiness,
} from "./types";

/** More than any real setup has; keeps one import inside the stores' write limits. */
export const MAX_IMPORT_ITEMS = 2000;

/** The export could not be read as the source's: the message says what to do next, in the streamer's words. */
export class ImportDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportDocumentError";
  }
}

/** One item of a reviewed import, in the order it is created, as a store keeps it. */
export interface PlannedItem {
  order: number;
  key: string;
  kind: ImportItem["kind"];
  name: string;
  origin: string;
  readiness: ImportReadiness;
  notes: ImportItem["notes"];
  steps: string[];
  /** The item's converted spec with its `$` keys escaped, which stores cannot hold. */
  spec: unknown;
}

function stepLabels(item: ImportItem): string[] {
  if (item.kind === "command") {
    return item.spec.steps.map((step) => step.label);
  }
  if (item.kind === "workflow") {
    return flattenSteps(item.spec.steps).map((step) => step.label);
  }
  return [];
}

export function convertDocument(source: ImportSource, text: string): ImportPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ImportDocumentError("The import could not be read. Choose the file again.");
  }
  const document = asRecord(parsed);
  if (!document) {
    throw new ImportDocumentError("The import could not be read. Choose the file again.");
  }
  const name = asString(document.name);
  if (source === "firebot") {
    const components = asRecord(document.components);
    if (!components) {
      throw new ImportDocumentError("This is not a Firebot setup.");
    }
    return convertFirebot({ name, components });
  }
  const exported = asRecord(document.export);
  if (!exported) {
    throw new ImportDocumentError("This is not a Streamer.bot export.");
  }
  return convertStreamerbot({ name, export: exported });
}

/**
 * The plan's items in creation order: groups and counters before the commands
 * and workflows that refer to them, otherwise as the export listed them.
 */
export function planItems(plan: ImportPlan): PlannedItem[] {
  if (plan.items.length > MAX_IMPORT_ITEMS) {
    throw new ImportDocumentError(
      `This setup has ${plan.items.length} items; an import takes at most ${MAX_IMPORT_ITEMS}.`
    );
  }
  const order = (item: ImportItem) => IMPORT_KIND_ORDER.indexOf(item.kind);
  return plan.items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => order(a.item) - order(b.item) || a.index - b.index)
    .map(({ item }, index) => ({
      order: index,
      key: item.key,
      kind: item.kind,
      name: item.name,
      origin: item.origin,
      readiness: itemReadiness(item),
      notes: item.notes,
      steps: stepLabels(item),
      spec: escapeDollarKeys(item.spec),
    }));
}
