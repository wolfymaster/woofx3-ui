import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CompositionEditor, EditorState } from "@woofx3/scene/editor";
import {
  PREVIEW_LOAD,
  PREVIEW_OVERRIDES,
  PREVIEW_PAUSE,
  PREVIEW_PLAY,
  PREVIEW_RESTART,
  PREVIEW_SEEK,
  type PreviewCommand,
  type PreviewProblem,
  type PreviewReport,
  type PreviewSampleEvent,
  parsePreviewReport,
} from "@woofx3/scene/runtime";
import { useAction } from "convex/react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEngineCapabilities } from "@/hooks/use-engine-capabilities";
import { useToast } from "@/hooks/use-toast";
import {
  createPreviewUrlCache,
  overridesOf,
  PREVIEW_LOAD_DEBOUNCE_MS,
  PREVIEW_MAX_ATTEMPTS,
  PREVIEW_READY_TIMEOUT_MS,
  type PreviewUrl,
  problemText,
  undrawnIds,
  unseenProblems,
} from "@/lib/composition-preview";
import { createDebouncer } from "@/lib/debounce";
import { createFrameCoalescer } from "@/lib/frame-coalescer";

/** The frame the stage puts behind its layers. */
export interface PreviewFrameBinding {
  src: string;
  ref: RefObject<HTMLIFrameElement>;
  onLoad: () => void;
}

/** The alert editor's live preview, for the stage and the transport to render. */
export interface CompositionPreviewController {
  /** The page is playing the document: the stage's stand-ins step aside. */
  live: boolean;
  /** Layers the page draws nothing for, which keep their stand-ins. */
  undrawn: ReadonlySet<string>;
  /** Null without the capability, or once the editor has given up on the page. */
  frame: PreviewFrameBinding | null;
  /** When the alert finishes on the page, exits included; null until it says. */
  durationMs: number | null;
  play(): void;
  pause(): void;
  /** Move the playhead; may be called once per pointer move, it posts once per frame. */
  seek(ms: number): void;
  restart(): void;
}

interface UseCompositionPreviewArgs {
  instanceId: Id<"instances"> | undefined;
  editor: CompositionEditor | null;
  state: EditorState | null;
  /** The document as the page should play it (`previewDocumentOf`); null before it loads. */
  document: EditorState["doc"];
  event: PreviewSampleEvent | null;
  inputs?: Record<string, unknown>;
  /** Names what a problem's id is about, for its toast. */
  labelOf: (id: string) => string | undefined;
}

const CAPABILITY = "compositions.preview";

/** How long before a frame's load event a `ready` may arrive and still be that page's. */
const READY_BEFORE_LOAD_MS = 2_000;

/** What was last posted as a `load`, and where the playhead was when it went. */
interface PostedLoad {
  id: string;
  document: EditorState["doc"];
  event: PreviewSampleEvent | null;
  inputs: Record<string, unknown> | undefined;
  restoreMs: number;
}

// One cache for the page session: a URL names nothing, so any editor on the
// instance may frame one another editor fetched.
let fetchPreviewUrl: ((instanceId: string) => Promise<PreviewUrl | null>) | null = null;
const urlCache = createPreviewUrlCache((instanceId) => {
  if (fetchPreviewUrl === null) {
    throw new Error("composition preview: a URL was asked for before the editor could fetch one");
  }
  return fetchPreviewUrl(instanceId);
});

/** Problems with which the page plays nothing at all, so the stand-ins stay. */
const NOTHING_PLAYS: ReadonlySet<PreviewProblem["kind"]> = new Set(["bind", "frames-unavailable"]);

/**
 * Drives sceneManager's composition preview page from the composition
 * editor (see docs/ui/commands.md, "Alert editor preview").
 *
 * - The document is posted as a `load` once the page is listening, and again
 *   once it has held still for PREVIEW_LOAD_DEBOUNCE_MS: a load remounts
 *   every frame, so it is never posted per keystroke or per pointer move.
 * - A gesture in progress goes as `overrides` on every editor state change
 *   (once per frame at most, as the stage coalesces pointer moves); the load
 *   that follows its commit clears them on the page.
 * - The page owns the playhead. Its reports move the editor's timeline
 *   (`editor.timeline.seek`, `play`, `pause`), and the transport posts to the
 *   page, so the two cannot disagree for longer than a report takes. A scrub
 *   also moves the editor's playhead at once, so the slider keeps up with the
 *   pointer.
 * - A page that does not say it is listening within PREVIEW_READY_TIMEOUT_MS
 *   of loading (an expired token gets a blank page) is framed again with a
 *   fresh URL, up to PREVIEW_MAX_ATTEMPTS times.
 */
export function useCompositionPreview({
  instanceId,
  editor,
  state,
  document,
  event,
  inputs,
  labelOf,
}: UseCompositionPreviewArgs): CompositionPreviewController {
  const supported = useEngineCapabilities(instanceId).support(CAPABILITY) === "supported";
  const getUrl = useAction(api.compositionPreview.getUrl);
  fetchPreviewUrl = (id) => getUrl({ instanceId: id as Id<"instances"> });
  const { toast } = useToast();

  const frameRef = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pageReady, setPageReady] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [problems, setProblems] = useState<readonly PreviewProblem[]>([]);

  // Read by message handlers and timers, which outlive the render that made them.
  const latest = useRef({ editor, document, event, inputs, labelOf, src });
  latest.current = { editor, document, event, inputs, labelOf, src };
  const loadCounter = useRef(0);
  const currentLoad = useRef<PostedLoad | null>(null);
  const loadedRef = useRef<string | null>(null);
  const lastReadyAt = useRef(Number.NEGATIVE_INFINITY);
  const seenProblems = useRef(new Set<string>());

  useEffect(() => {
    if (!supported || instanceId === undefined || attempt >= PREVIEW_MAX_ATTEMPTS) {
      setSrc(null);
      return;
    }
    let current = true;
    urlCache.get(instanceId, { fresh: attempt > 0 }).then(
      (answer) => current && setSrc(answer?.url ?? null),
      () => current && setSrc(null)
    );
    return () => {
      current = false;
    };
  }, [supported, instanceId, attempt]);

  const post = useCallback((command: PreviewCommand) => {
    const target = frameRef.current?.contentWindow;
    const frameSrc = latest.current.src;
    if (!target || frameSrc === null) {
      return;
    }
    // Addressed to the page's origin, so a frame that navigated elsewhere never receives it.
    target.postMessage(command, new URL(frameSrc).origin);
  }, []);

  const postLoad = useCallback(() => {
    const { document: doc, event: sample, inputs: values, editor: current } = latest.current;
    if (doc === null) {
      return;
    }
    loadCounter.current += 1;
    const id = `load-${loadCounter.current}`;
    currentLoad.current = {
      id,
      document: doc,
      event: sample,
      inputs: values,
      restoreMs: current?.getState().timeline.playheadMs ?? 0,
    };
    post({
      type: PREVIEW_LOAD,
      loadId: id,
      profile: "alert",
      document: doc,
      event: sample,
      ...(values === undefined ? {} : { inputs: values }),
      autoplay: false,
    });
  }, [post]);

  const [loads] = useState(() => createDebouncer<null>(PREVIEW_LOAD_DEBOUNCE_MS, () => postLoad()));
  useEffect(() => () => loads.cancel(), [loads]);

  // A new page knows nothing until it is loaded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new src is a new page in the frame
  useEffect(() => {
    setPageReady(false);
    setLoadedId(null);
    setDurationMs(null);
    setProblems([]);
    currentLoad.current = null;
    loadedRef.current = null;
    loads.cancel();
  }, [src, loads]);

  const watchReady = useCallback(() => {
    const startedAt = performance.now();
    return window.setTimeout(() => {
      // A page posts `ready` as its script runs, which may be just before the frame's load event.
      if (lastReadyAt.current < startedAt - READY_BEFORE_LOAD_MS) {
        setPageReady(false);
        setAttempt((tries) => tries + 1);
      }
    }, PREVIEW_READY_TIMEOUT_MS);
  }, []);
  const readyTimer = useRef<number | null>(null);
  const onLoad = useCallback(() => {
    if (readyTimer.current !== null) {
      window.clearTimeout(readyTimer.current);
    }
    readyTimer.current = watchReady();
  }, [watchReady]);
  useEffect(
    () => () => {
      if (readyTimer.current !== null) {
        window.clearTimeout(readyTimer.current);
      }
    },
    []
  );

  const report = useCallback(
    (fresh: PreviewProblem[]) => {
      if (fresh.length === 0) {
        return;
      }
      const lines = fresh.map((problem) => problemText(problem, latest.current.labelOf));
      toast({ title: "The preview can't show everything", description: lines.join(" ") });
    },
    [toast]
  );

  const handleReport = useCallback(
    (message: PreviewReport) => {
      const current = latest.current.editor;
      const load = currentLoad.current;
      switch (message.type) {
        case "woofx3.composition-preview.ready":
          lastReadyAt.current = performance.now();
          setPageReady(true);
          setLoadedId(null);
          loadedRef.current = null;
          loads.cancel();
          postLoad();
          return;
        case "woofx3.composition-preview.timeline":
          if (load === null || message.loadId !== load.id) {
            return;
          }
          setDurationMs(message.durationMs);
          if (loadedRef.current !== load.id) {
            loadedRef.current = load.id;
            setLoadedId(load.id);
            if (load.restoreMs > 0) {
              // Keep the playhead where it was before the edit that reloaded the page.
              post({ type: PREVIEW_SEEK, ms: Math.min(load.restoreMs, message.durationMs ?? load.restoreMs) });
            }
          }
          return;
        case "woofx3.composition-preview.playhead":
          if (load === null || message.loadId !== load.id || current === null) {
            return;
          }
          current.timeline.seek(message.ms);
          if (message.playing) {
            current.timeline.play();
          } else {
            current.timeline.pause();
          }
          return;
        case "woofx3.composition-preview.finished":
          if (load === null || message.loadId !== load.id || current === null) {
            return;
          }
          current.timeline.pause();
          current.timeline.seek(message.ms);
          return;
        case "woofx3.composition-preview.problems":
          if (message.loadId !== null && (load === null || message.loadId !== load.id)) {
            return;
          }
          if (message.loadId !== null) {
            setProblems(message.problems);
          }
          report(unseenProblems(seenProblems.current, message.problems));
          return;
      }
    },
    [loads, post, postLoad, report]
  );

  useEffect(() => {
    if (src === null) {
      return;
    }
    const origin = new URL(src).origin;
    const onMessage = (message: MessageEvent) => {
      if (message.source !== frameRef.current?.contentWindow || message.origin !== origin) {
        return;
      }
      const parsed = parsePreviewReport(message.data);
      if (parsed === null) {
        return;
      }
      if (!parsed.ok) {
        // The page speaks a protocol this dashboard does not: keep the stand-ins.
        console.warn("[alert preview] unreadable report", parsed.error);
        return;
      }
      handleReport(parsed.report);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [src, handleReport]);

  // The document, sample event and inputs: posted again once they hold still.
  useEffect(() => {
    if (!pageReady || document === null) {
      return;
    }
    const posted = currentLoad.current;
    if (posted !== null && posted.document === document && posted.event === event && posted.inputs === inputs) {
      return;
    }
    loads.push(null);
  }, [pageReady, document, event, inputs, loads]);

  const transient = state?.transient ?? null;
  const gestured = useRef(false);
  useEffect(() => {
    if (!pageReady || loadedId === null) {
      return;
    }
    const overrides = overridesOf(transient);
    if (overrides !== null) {
      gestured.current = true;
      post({ type: PREVIEW_OVERRIDES, overrides });
      return;
    }
    // A gesture that changed nothing (refused, or cancelled) leaves no load to clear its overrides.
    if (gestured.current && currentLoad.current?.document === latest.current.document) {
      post({ type: PREVIEW_OVERRIDES, overrides: null });
    }
    gestured.current = false;
  }, [transient, pageReady, loadedId, post]);

  const [seeks] = useState(() => createFrameCoalescer<number>((ms) => post({ type: PREVIEW_SEEK, ms })));
  useEffect(() => () => seeks.cancel(), [seeks]);

  const undrawn = useMemo(() => undrawnIds(problems), [problems]);
  const nothingPlays = problems.some((problem) => NOTHING_PLAYS.has(problem.kind));
  const live = src !== null && pageReady && loadedId !== null && !nothingPlays;

  return {
    live,
    undrawn,
    frame: src === null ? null : { src, ref: frameRef, onLoad },
    durationMs,
    play: () => post({ type: PREVIEW_PLAY }),
    pause: () => post({ type: PREVIEW_PAUSE }),
    seek: (ms) => {
      const at = Math.max(0, ms);
      // The scrub follows the pointer at once; the page's report confirms where it landed.
      editor?.timeline.seek(at);
      seeks.push(at);
    },
    restart: () => post({ type: PREVIEW_RESTART }),
  };
}
