import { api } from "@convex/_generated/api";
import type { SceneWidgetCatalogRow } from "@convex/sceneWidgets";
import { LocalDocumentSource } from "@woofx3/scene/editor";
import { type CompositionDocument, PROFILES } from "@woofx3/scene/model";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useEngineCapabilities } from "@/engine/hooks/use-engine-capabilities";
import { type CompositionEditorHandle, useCompositionEditor, useEditorKeys } from "@/hooks/use-composition-editor";
import { useInstance } from "@/hooks/use-instance";
import {
  ALERT_COMPOSITION_CAPABILITY,
  alertLayoutChanged,
  alertLayoutShapeFor,
  readAlertComposition,
  storedAlertLayout,
} from "@/lib/alert-layout";
import { catalogOfRows } from "@/lib/scene-composition";

/** A composition editor over an alert, and the installed widgets it places. */
export interface AlertEditorHandle extends CompositionEditorHandle {
  /** The installed widgets: names, settings fields and icons. The editor decides which may be added. */
  catalogRows: readonly SceneWidgetCatalogRow[];
}

export interface AlertLayoutSession extends AlertEditorHandle {
  /**
   * Replace the whole alert, as a change from elsewhere would: the copy the
   * editor opened with stays what Cancel returns to and `isDirty` compares with.
   */
  replace: (doc: CompositionDocument) => void;
  /** The document differs from the one the editor opened with. */
  isDirty: boolean;
  /** The edited layout as a step stores it, in the shape the engine plays; null when nothing changed. */
  changedLayout: () => unknown | null;
}

/**
 * A composition editor (alert profile) over a copy of a step's `layout`, in
 * memory: nothing the caller holds changes until it takes `changedLayout()`.
 *
 * The copy is made once, when the widget catalog first arrives (it names
 * widgets stored without a name); a later change to `value` must not
 * overwrite edits made here. Null until then.
 */
export function useAlertLayoutEditor(value: unknown): AlertLayoutSession | null {
  const { instance } = useInstance();
  const catalogRows = useQuery(api.sceneWidgets.listForInstance, instance ? { instanceId: instance._id } : "skip");
  const compositionSupport = useEngineCapabilities(instance?._id).support(ALERT_COMPOSITION_CAPABILITY);

  const [seed, setSeed] = useState<CompositionDocument | null>(null);
  useEffect(() => {
    if (seed !== null || catalogRows === undefined) {
      return;
    }
    const nameOf = (widgetCanonicalId: string) =>
      catalogRows.find((row) => row.widgetId === widgetCanonicalId)?.name ?? widgetCanonicalId;
    setSeed(readAlertComposition(value, nameOf));
  }, [seed, catalogRows, value]);

  const source = useMemo(() => (seed === null ? null : new LocalDocumentSource(seed)), [seed]);
  const catalog = useMemo(() => catalogOfRows(catalogRows ?? []), [catalogRows]);
  const composition = useCompositionEditor({ source, profile: PROFILES.alert, catalog });
  useEditorKeys(composition?.editor ?? null);

  const doc = composition?.state.doc ?? null;
  const isDirty = useMemo(() => seed !== null && doc !== null && alertLayoutChanged(seed, doc), [seed, doc]);
  const changedLayout = useCallback(
    () => (isDirty && doc !== null ? storedAlertLayout(doc, alertLayoutShapeFor(compositionSupport)) : null),
    [isDirty, doc, compositionSupport]
  );

  const replace = useCallback((next: CompositionDocument) => source?.replace(next), [source]);

  if (composition === null || catalogRows === undefined) {
    return null;
  }
  return { ...composition, catalogRows, replace, isDirty, changedLayout };
}
