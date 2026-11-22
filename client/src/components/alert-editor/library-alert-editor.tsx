import { PROFILES } from "@woofx3/scene/model";
import { Loader2 } from "lucide-react";
import { useCallback, useMemo } from "react";
import { AlertEditorFrame, useAlertEditorView } from "@/components/alert-editor/alert-layout-editor";
import { DraftLiveControls, type DraftLiveCopy, type DraftLiveTestIds } from "@/components/scenes/draft-live-controls";
import { sessionNotice, sessionStatusText } from "@/components/scenes/scene-canvas-editor";
import { UnreadSceneNotice } from "@/components/scenes/unread-scene-notice";
import { Button } from "@/components/ui/button";
import { useLibraryAlert } from "@/engine/hooks/use-alert-library";
import { useEngineInfoRequest } from "@/engine/hooks/use-engine-status";
import { useRepairSceneRequest, useSceneWidgetCatalog } from "@/engine/hooks/use-scenes";
import type { InstanceId } from "@/engine/types";
import { useCollapsedSidebar } from "@/hooks/use-collapsed-sidebar";
import { useOverlayEditorSession } from "@/hooks/use-overlay-editor-session";
import { useToast } from "@/hooks/use-toast";
import { compositionOfLibraryAlert, inputVariableOptions, libraryPreviewInputs } from "@/lib/alert-library";
import { DRAFT_COPY } from "@/lib/copy";
import { draftSaveStatus } from "@/lib/draft-save-status";
import { catalogOfRows } from "@/lib/scene-composition";
import { repairResultToast } from "@/lib/scene-unread";

interface LibraryAlertEditorProps {
  instanceId: InstanceId;
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
  useCollapsedSidebar();
  const row = useLibraryAlert(compositionId);
  const catalogRows = useSceneWidgetCatalog();
  const catalog = useMemo(() => catalogOfRows(catalogRows ?? []), [catalogRows]);

  const getEngineInfo = useEngineInfoRequest();
  const repairScene = useRepairSceneRequest();
  // An alert has no preview page to take sceneManager's origin from, so the socket is
  // opened at the engine's overlay URL, which is sceneManager's public URL.
  const socketOrigin = useCallback(async () => (await getEngineInfo())?.overlayPublicUrl ?? null, [getEngineInfo]);
  const cacheDocument = useMemo(() => (row ? compositionOfLibraryAlert(row) : null), [row]);
  const {
    session,
    composition,
    live,
    setLive,
    syncState,
    conn,
    pendingCommand,
    draftCommandsEnabled,
    runDraftCommand,
  } = useOverlayEditorSession({
    instanceId,
    engineSceneId: compositionId,
    noun: "alert",
    profile: PROFILES.alert,
    catalog,
    cacheDocument,
    socketOrigin,
  });
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

  if (row === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-muted-foreground">This alert isn't in the library.</p>
        <p className="text-xs text-muted-foreground">
          It may have been deleted, or it is still saving. Try again in a moment.
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

  const notice = sessionNotice(syncState, "alert");

  const handleRepair = async () => {
    try {
      const result = await repairScene(compositionId);
      toast(repairResultToast(result, "alert"));
      if (result.ok) {
        session.reopen();
      }
    } catch {
      toast({
        title: "Couldn't repair this alert. Try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <AlertEditorFrame
      session={handle}
      view={view}
      title={row?.name ?? "Library alert"}
      context="Alert library"
      backLabel="alerts"
      onBack={onBack}
      notice={<UnreadSceneNotice conn={conn} unread={syncState?.unread} noun="alert" onRepair={handleRepair} />}
      status={
        notice === null ? undefined : (
          <span className="truncate text-xs text-muted-foreground" data-testid="text-alert-sync">
            {notice}
          </span>
        )
      }
      actions={
        <DraftLiveControls
          live={live}
          onLiveChange={setLive}
          commandsEnabled={draftCommandsEnabled}
          pendingCommand={pendingCommand}
          onCommand={runDraftCommand}
          hasDraft={syncState?.hasDraft ?? false}
          saveStatus={draftSaveStatus(syncState, live)}
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
      phoneStatus={sessionStatusText(syncState, live, "alert")}
    />
  );
}

const ALERT_DRAFT_COPY: DraftLiveCopy = {
  draft: DRAFT_COPY.privateUntilPublished,
  live: "Edits change what new copies start from right away",
  liveDisabled: "Live edits are already what new copies start from",
  publish: DRAFT_COPY.publish,
  discardTitle: "Discard your changes to this alert?",
  discardDescription: "Your changes since the last publish are lost.",
};

const ALERT_DRAFT_TEST_IDS: DraftLiveTestIds = {
  live: "switch-alert-live-update",
  discard: "button-discard-alert-draft",
  confirmDiscard: "button-confirm-discard-alert-draft",
  publish: "button-publish-alert",
};
