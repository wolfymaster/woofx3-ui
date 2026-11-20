import type { SceneSyncClient } from "@woofx3/api/scene-editor/client";
import type { Version } from "@woofx3/api/scene-editor/document";
import { LocalDocumentSource, SyncDocumentSource } from "@woofx3/scene/editor";
import type { CompositionDocument } from "@woofx3/scene/model";

/**
 * Where an editor's document lives, and what saving it means. The two kinds
 * differ in consequences, not just storage, so the consequences are the
 * type's shape:
 *
 * - `local-copy`: an in-memory copy of something the host owns (a step's
 *   layout). Nothing leaves the editor until the host takes the result, so
 *   there is nothing to publish; Done hands back the layout only when
 *   `changed` says it differs from the seed, and the host must then save it
 *   (a workflow save carries it).
 * - `socket-draft`: a scene or library alert edited live over the sync
 *   session. Every edit is saved as it is made; `publish` makes the draft
 *   what future copies start from (steps already holding a copy are
 *   untouched) and `discard` throws the draft away. Both return whether the
 *   command was sent.
 */
export type EditorDocumentSource =
  | {
      kind: "local-copy";
      source: LocalDocumentSource;
      /** Whether `doc` differs from the seed the copy was made from. */
      changed: (doc: CompositionDocument) => boolean;
    }
  | {
      kind: "socket-draft";
      source: SyncDocumentSource;
      version: Version;
      publish: () => boolean;
      discard: () => boolean;
    };

export function localCopySource(
  seed: CompositionDocument,
  differs: (seed: CompositionDocument, doc: CompositionDocument) => boolean,
  options: { readOnly?: boolean } = {}
): Extract<EditorDocumentSource, { kind: "local-copy" }> {
  return {
    kind: "local-copy",
    source: new LocalDocumentSource(seed, options),
    changed: (doc) => differs(seed, doc),
  };
}

type DraftClient = Pick<SceneSyncClient, "getState" | "subscribe" | "edit" | "setPresence" | "publish" | "discard">;

export function socketDraftSource(
  client: DraftClient,
  version: Version
): Extract<EditorDocumentSource, { kind: "socket-draft" }> {
  return {
    kind: "socket-draft",
    source: new SyncDocumentSource({ client, version }),
    version,
    publish: () => client.publish(),
    discard: () => client.discard(),
  };
}
