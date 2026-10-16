import {
  type CatalogWidget,
  type CompositionEditor,
  createCompositionEditor,
  type DocumentSource,
  type EditorState,
} from "@woofx3/scene/editor";
import type { CompositionProfile } from "@woofx3/scene/model";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { sendKeyToEditor } from "@/lib/editor-keys";

interface UseCompositionEditorArgs {
  /** Where the document lives; null renders nothing yet. */
  source: DocumentSource | null;
  profile: CompositionProfile;
  catalog: readonly CatalogWidget[];
}

export interface CompositionEditorHandle {
  editor: CompositionEditor;
  state: EditorState;
}

const noEditor = (): (() => void) => () => {};
const noState = (): null => null;

/**
 * A headless composition editor (`@woofx3/scene/editor`) for a component to
 * render, and its state, re-rendered as it changes.
 *
 * The editor is made again when the source or profile changes: a new source
 * is another document (the other version of a scene). Its history goes with
 * it; the selection is carried over where the widget is still there, and
 * other editors are told what this one has selected in the new source. A
 * new catalog (a module installed while the editor is open) is handed to
 * the editor it has, which keeps its history.
 *
 * Null until the first editor is made.
 */
export function useCompositionEditor({
  source,
  profile,
  catalog,
}: UseCompositionEditorArgs): CompositionEditorHandle | null {
  const [editor, setEditor] = useState<CompositionEditor | null>(null);
  const selectionRef = useRef<readonly string[]>([]);
  // The catalog a new editor starts from; later catalogs reach it through setCatalog below.
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;

  useEffect(() => {
    if (source === null) {
      setEditor(null);
      return;
    }
    const made = createCompositionEditor({ source, profile, catalog: catalogRef.current });
    for (const id of selectionRef.current) {
      made.dispatch("selection.select", { id, additive: true });
    }
    source.presence?.setSelection(made.getState().selection.primary);
    const unsubscribe = made.subscribe(() => {
      selectionRef.current = made.getState().selection.ids;
    });
    setEditor(made);
    return () => {
      unsubscribe();
      made.destroy();
    };
  }, [source, profile]);

  useEffect(() => {
    editor?.setCatalog(catalog);
  }, [editor, catalog]);

  const state = useSyncExternalStore(editor?.subscribe ?? noEditor, editor?.getState ?? noState);
  return editor === null || state === null ? null : { editor, state };
}

/**
 * Sends key presses to the editor while it is mounted. A press the editor
 * used is the editor's alone (no scrolling, no browser zoom); one it had
 * nothing to do with, and one in a text field, menu, dialog or sortable
 * grip, is left to the browser.
 */
export function useEditorKeys(editor: CompositionEditor | null): void {
  useEffect(() => {
    if (editor === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (sendKeyToEditor(editor, event)) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor]);
}
