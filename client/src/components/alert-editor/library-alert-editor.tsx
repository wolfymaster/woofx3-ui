import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Version } from "@woofx3/api/scene-editor/document";
import { LocalDocumentSource, SyncDocumentSource } from "@woofx3/scene/editor";
import { PROFILES } from "@woofx3/scene/model";
import { useAction, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertEditorFrame, useAlertEditorView } from "@/components/alert-editor/alert-layout-editor";
import {
  type DraftCommand,
  DraftLiveControls,
  type DraftLiveCopy,
  type DraftLiveTestIds,
} from "@/components/scenes/draft-live-controls";
import { sessionStatusText } from "@/components/scenes/scene-canvas-editor";
import { Button } from "@/components/ui/button";
import { useCompositionEditor, useEditorKeys } from "@/hooks/use-composition-editor";
import { useSceneEditorSession } from "@/hooks/use-scene-editor-session";
import { useToast } from "@/hooks/use-toast";
import { compositionOfLibraryAlert, inputVariableOptions, libraryPreviewInputs } from "@/lib/alert-library";
import { catalogOfRows } from "@/lib/scene-composition";

interface LibraryAlertEditorProps {
  instanceId: Id<"instances">;
  /** The library alert's engine id. */
  compositionId: string;
  onBack: () => void;
}

/**
 * The editor for a library alert itself. It edits live through sceneManager's editor
 * socket like a scene, so every change is saved as it is made into a draft, and
 * publishing makes the draft what a new copy starts from. Steps hold copies, so nothing
 * that already plays changes. The text fields offer the alert's inputs, `{{id}}`, which
 * a copy fills in with its step's variables.
 */
export function LibraryAlertEditor({ instanceId, compositionId, onBack }: LibraryAlertEditorProps) {
  const { toast } = useToast();
  const row = useQuery(api.alertCompositions.getByEngineId, { instanceId, engineCompositionId: compositionId });
  const catalogRows = useQuery(api.sceneWidgets.listForInstance, { instanceId });
  const catalog = useMemo(() => catalogOfRows(catalogRows ?? []), [catalogRows]);

  const me = useQuery(api.users.getMe);
  const myName = me === undefined ? undefined : (me?.name ?? me?.email ?? "");
  const getEngineInfo = useAction(api.engineInfo.getEngineInfo);
  // An alert has no preview page to take sceneManager's origin from, so the socket is
  // opened at the engine's overlay URL, which is sceneManager's public URL.
  const publicUrl = useCallback(
    async () => (await getEngineInfo({ instanceId }))?.overlayPublicUrl ?? null,
    [instanceId, getEngineInfo]
  );

  // Each open editor chooses for itself whether it edits the published alert, and every one starts on the draft.
  const [live, setLive] = useState(false);
  const uiVersion: Version = live ? "published" : "draft";
  const session = useSceneEditorSession({
    instanceId,
    engineSceneId: compositionId,
    sceneId: undefined,
    publicUrl,
    enabled: true,
    editorName: myName,
    unsavedOutsideSession: false,
  });
  const client = session.client;
  const syncState = session.state;
  const sessionLoaded = syncState?.local != null;
  const conn = syncState?.conn ?? null;
  const sessionEnded = conn === "gone" || conn === "closed";
  const pendingCommand = syncState?.pendingCommand ?? null;
  const draftCommandsEnabled =
    syncState !== null &&
    sessionLoaded &&
    !sessionEnded &&
    pendingCommand === null &&
    (syncState.hasDraft || syncState.pendingItems > 0);

  // The published alert from the cache is shown, read-only, until the session has the alert.
  const [cacheSource, setCacheSource] = useState<LocalDocumentSource | null>(null);
  useEffect(() => {
    if (row && cacheSource === null) {
      setCacheSource(new LocalDocumentSource(compositionOfLibraryAlert(row), { readOnly: true }));
    }
  }, [row, cacheSource]);
  const syncSource = useMemo(
    () => (client !== null ? new SyncDocumentSource({ client, version: uiVersion }) : null),
    [client, uiVersion]
  );
  const source = syncSource !== null && sessionLoaded && !sessionEnded ? syncSource : cacheSource;
  const composition = useCompositionEditor({ source, profile: PROFILES.alert, catalog });
  useEditorKeys(composition?.editor ?? null);
  const handle = useMemo(
    () => (composition === null || catalogRows === undefined ? null : { ...composition, catalogRows }),
    [composition, catalogRows]
  );
  const declaredInputs = handle?.state?.doc?.inputs;
  const inputKey = JSON.stringify(declaredInputs ?? []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: inputKey stands for the declared inputs' content
  const inputOptions = useMemo(() => inputVariableOptions(declaredInputs ?? []), [inputKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: inputKey stands for the declared inputs' content
  const previewInputs = useMemo(() => libraryPreviewInputs(declaredInputs ?? []), [inputKey]);
  const view = useAlertEditorView(handle, inputOptions, previewInputs);

  const runDraftCommand = (command: DraftCommand) => {
    const taken = client !== null && (command === "publish" ? client.publish() : client.discard());
    if (!taken) {
      toast({
        title: `${command === "publish" ? "Publish" : "Discard"} wasn't sent`,
        description:
          conn === "gone"
            ? "This alert is no longer in the library."
            : "The editor hasn't loaded the alert from the scene manager yet.",
        variant: "destructive",
      });
    }
  };

  if (row === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-muted-foreground">This alert isn't in the library.</p>
        <p className="text-xs text-muted-foreground">
          It was deleted, or it was saved a moment ago and the engine hasn't reported it yet.
        </p>
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
      </div>
    );
  }

  if (handle === null || view === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const status = sessionStatusText(syncState, live, "alert");

  return (
    <AlertEditorFrame
      session={handle}
      view={view}
      title={row?.name ?? "Library alert"}
      context="Alert library · new copies start from what you publish"
      backLabel="alerts"
      onBack={onBack}
      status={
        <span className="truncate text-xs text-muted-foreground" data-testid="text-alert-sync">
          {status}
        </span>
      }
      actions={
        <DraftLiveControls
          live={live}
          onLiveChange={setLive}
          commandsEnabled={draftCommandsEnabled}
          pendingCommand={pendingCommand}
          onCommand={runDraftCommand}
          hasDraft={syncState?.hasDraft ?? false}
          copy={ALERT_DRAFT_COPY}
          testIds={ALERT_DRAFT_TEST_IDS}
        />
      }
      phoneAction={
        <Button
          className="h-11"
          onClick={() => runDraftCommand("publish")}
          disabled={live || !draftCommandsEnabled}
          data-testid="button-publish-alert"
        >
          {pendingCommand === "publish" ? "Publishing…" : "Publish"}
        </Button>
      }
      phoneStatus={status}
    />
  );
}

const ALERT_DRAFT_COPY: DraftLiveCopy = {
  draft: "Edit a draft that new copies don't start from until you publish it",
  live: "Edit what new copies start from right now, without publishing",
  liveDisabled: "Live edits are already what new copies start from",
  publish: "Make the draft what new copies start from",
};

const ALERT_DRAFT_TEST_IDS: DraftLiveTestIds = {
  mode: "toggle-alert-mode",
  draft: "toggle-alert-draft",
  live: "toggle-alert-live",
  discard: "button-discard-alert-draft",
  publish: "button-publish-alert",
};
