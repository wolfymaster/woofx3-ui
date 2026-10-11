import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Version } from "@woofx3/api/scene-editor/document";
import { LocalDocumentSource, SyncDocumentSource } from "@woofx3/scene/editor";
import { PROFILES } from "@woofx3/scene/model";
import { useAction, useQuery } from "convex/react";
import { Loader2, MoreVertical } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AlertEditorFrame, useAlertEditorView } from "@/components/alert-editor/alert-layout-editor";
import {
  type DraftCommand,
  DraftLiveControls,
  type DraftLiveCopy,
  type DraftLiveTestIds,
} from "@/components/scenes/draft-live-controls";
import { sessionStatusText } from "@/components/scenes/scene-canvas-editor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCompositionEditor, useEditorKeys } from "@/hooks/use-composition-editor";
import { useEngineCapabilities } from "@/hooks/use-engine-capabilities";
import { useSceneEditorSession } from "@/hooks/use-scene-editor-session";
import { useToast } from "@/hooks/use-toast";
import { ALERT_COMPOSITION_CAPABILITY, alertLayoutShapeFor, storedAlertLayout } from "@/lib/alert-layout";
import { compositionOfLibraryAlert, inlineCopyOfLibraryAlert } from "@/lib/alert-library";
import { catalogOfRows } from "@/lib/scene-composition";
import type { VariableOption } from "@/lib/workflow-variables";

interface LinkedAlertEditorProps {
  instanceId: Id<"instances">;
  /** The library alert the step links (`parameters.composition`). */
  compositionId: string;
  /** The step's input values, which a copy into the step is filled in with. */
  inputValues: Record<string, unknown>;
  /** What is being edited, shown under the title — the trigger and step, or the command and step. */
  context: ReactNode;
  /** Named in the back arrow's label: "Back to {backLabel}". */
  backLabel: string;
  /** Offered in the layers' text settings. A library alert's own text should use its inputs instead. */
  availableVariables: VariableOption[];
  /** What the step belongs to, for "Duplicate for this {owner} only". */
  owner: "trigger" | "command";
  onBack: () => void;
  /** Replace the link with a copy of the alert held by the step: its stored `layout`. */
  onDuplicateHere: (layout: unknown) => void;
}

/**
 * The editor for a library alert a step links. It edits the alert itself, live through
 * sceneManager's editor socket like a scene, so every change is saved as it is made into
 * a draft that no step plays until it is published, and a publish changes every step
 * that uses the alert. "Duplicate for this trigger only" swaps the link for a copy the
 * step holds, which the editor for a step's own alert then opens.
 */
export function LinkedAlertEditor({
  instanceId,
  compositionId,
  inputValues,
  context,
  backLabel,
  availableVariables,
  owner,
  onBack,
  onDuplicateHere,
}: LinkedAlertEditorProps) {
  const { toast } = useToast();
  const row = useQuery(api.alertCompositions.getByEngineId, { instanceId, engineCompositionId: compositionId });
  const catalogRows = useQuery(api.sceneWidgets.listForInstance, { instanceId });
  const catalog = useMemo(() => catalogOfRows(catalogRows ?? []), [catalogRows]);
  const shape = alertLayoutShapeFor(useEngineCapabilities(instanceId).support(ALERT_COMPOSITION_CAPABILITY));

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
  const view = useAlertEditorView(handle, availableVariables);

  const listLinks = useAction(api.alertCompositionActions.listLinks);
  const [usedBy, setUsedBy] = useState<number | null>(null);
  useEffect(() => {
    let current = true;
    listLinks({ instanceId, engineCompositionId: compositionId }).then(
      (links) => current && setUsedBy(links.length),
      () => current && setUsedBy(null)
    );
    return () => {
      current = false;
    };
  }, [instanceId, compositionId, listLinks]);

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

  const duplicateHere = () => {
    if (!row) {
      return;
    }
    const { doc, unfilled } = inlineCopyOfLibraryAlert(row, inputValues);
    if (unfilled.length > 0) {
      toast({
        title: "Some of its inputs had no value",
        description: `${unfilled.join(", ")} ${unfilled.length === 1 ? "is" : "are"} left empty in this copy.`,
      });
    }
    onDuplicateHere(storedAlertLayout(doc, shape));
  };

  if (row === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-muted-foreground">This step uses a library alert the dashboard hasn't seen yet.</p>
        <p className="text-xs text-muted-foreground">
          It appears here once the engine reports it, usually a moment after it is saved.
        </p>
        <Button variant="outline" onClick={onBack}>
          Back to {backLabel}
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
  const usedByText =
    usedBy === null ? null : `Used by ${usedBy} ${usedBy === 1 ? "step" : "steps"}${usedBy === 0 ? " yet" : ""}`;
  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Alert actions" data-testid="button-linked-alert-menu">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={duplicateHere} data-testid="menu-duplicate-for-step">
          Duplicate for this {owner} only
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <AlertEditorFrame
      session={handle}
      view={view}
      title={row?.name ?? "Library alert"}
      context={
        <>
          {context}
          {usedByText ? ` · ${usedByText}` : ""}
        </>
      }
      backLabel={backLabel}
      onBack={onBack}
      status={
        <span className="truncate text-xs text-muted-foreground" data-testid="text-alert-sync">
          {status}
        </span>
      }
      actions={
        <>
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
          {menu}
        </>
      }
      phoneAction={
        <>
          <Button
            className="h-11"
            onClick={() => runDraftCommand("publish")}
            disabled={live || !draftCommandsEnabled}
            data-testid="button-publish-alert"
          >
            {pendingCommand === "publish" ? "Publishing…" : "Publish"}
          </Button>
          {menu}
        </>
      }
      phoneStatus={status}
    />
  );
}

const ALERT_DRAFT_COPY: DraftLiveCopy = {
  draft: "Edit a draft that no step plays until you publish it",
  live: "Edit what every step plays right now, without publishing",
  liveDisabled: "Live edits are already what the steps play",
  publish: "Play the draft from every step that uses this alert",
};

const ALERT_DRAFT_TEST_IDS: DraftLiveTestIds = {
  mode: "toggle-alert-mode",
  draft: "toggle-alert-draft",
  live: "toggle-alert-live",
  discard: "button-discard-alert-draft",
  publish: "button-publish-alert",
};
