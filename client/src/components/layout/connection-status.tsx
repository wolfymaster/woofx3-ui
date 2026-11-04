import { api } from "@convex/_generated/api";
import { useStore } from "@nanostores/react";
import { useQuery } from "convex/react";
import { AlertTriangle } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useInstalledModules } from "@/engine/hooks/use-modules";
import { useObsStatus } from "@/engine/hooks/use-obs-status";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { useTwitchIntegration } from "@/hooks/use-twitch-integration";
import { actionErrorMessage } from "@/lib/action-error";
import {
  type Connection,
  type ConnectionState,
  fitConnections,
  localModules,
  needsAttention,
  obsConnection,
  sortConnections,
  twitchConnection,
  unreportedConnection,
  worstState,
} from "@/lib/connection-status";
import { OBS_MODULE_ID } from "@/lib/obs-status";
import { $relayLimitation, type RelayLimitation } from "@/lib/relay-limitation";
import { cn } from "@/lib/utils";

/** Must match the `gap-3` on the name rows below. */
const NAME_GAP_PX = 12;

/** The widest overflow chip measured; a status bar never overflows into three digits. */
const CHIP_SAMPLE = "+99";

const STATE_TEXT: Record<ConnectionState, string> = {
  connected: "text-green-600 dark:text-green-400",
  degraded: "text-amber-600 dark:text-amber-400",
  disconnected: "text-red-600 dark:text-red-400",
  pending: "text-muted-foreground",
};

const NAME_CLASS = "flex shrink-0 items-center gap-1 font-semibold uppercase tracking-wider whitespace-nowrap";

export interface EngineStatus {
  label: string;
  dot: string;
  text: string;
  state: string;
  version: string;
}

/** Every app and platform this instance uses, in status bar order. One still loading is left out until it is known. */
function useConnections(relayLimited: boolean): Connection[] {
  const { instance } = useInstance();
  const twitchRequired = useQuery(api.setup.status, instance ? { instanceId: instance._id } : "skip")?.twitchRequired;
  const { health, twitchLink, isLoading: twitchLoading } = useTwitchIntegration();
  const modules = localModules(useInstalledModules() ?? []);
  const { status: obsStatus } = useObsStatus(modules.some(({ id }) => id === OBS_MODULE_ID));

  const connections: Connection[] = [];
  if (twitchRequired && !twitchLoading) {
    connections.push(twitchConnection(health, twitchLink?.platformUsername));
  }
  for (const module of modules) {
    connections.push(
      module.id === OBS_MODULE_ID ? obsConnection(module, obsStatus, relayLimited) : unreportedConnection(module)
    );
  }
  return sortConnections(connections);
}

/**
 * How many of `connections` fit in the row. Measures a hidden copy of every
 * name, because the row's width depends on the page's tabs and the window, and
 * each name's width on its label and whether it carries a warning icon.
 */
function useFittedCount(connections: readonly Connection[]) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(connections.length);
  const signature = connections.map(({ id, label, state }) => `${id}:${label}:${state}`).join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: `signature` is what changes the measured names.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) {
      return;
    }
    const fit = () => {
      const [chip, ...names] = Array.from(measure.children).map((child) => child.getBoundingClientRect().width);
      setCount(fitConnections({ widths: names, chipWidth: chip ?? 0, gap: NAME_GAP_PX, available: row.clientWidth }));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    return () => observer.disconnect();
  }, [signature]);

  return { rowRef, measureRef, count };
}

function ConnectionName({ connection }: { connection: Connection }) {
  return (
    <span className={cn(NAME_CLASS, STATE_TEXT[connection.state])}>
      {needsAttention(connection.state) && <AlertTriangle className="h-3 w-3" aria-hidden />}
      {connection.label}
    </span>
  );
}

/**
 * The left of the status bar: the engine, then one coloured name per connected
 * app. Names that don't fit collapse into a chip coloured by the worst of them,
 * and problems sort first, so a problem is never hidden. Clicking anything
 * opens one panel with the details.
 */
export function ConnectionStatusBar({ engine }: { engine: EngineStatus }) {
  const relayLimitation = useStore($relayLimitation);
  const connections = useConnections(relayLimitation !== null);
  const { rowRef, measureRef, count } = useFittedCount(connections);
  const [open, setOpen] = useState(false);
  const shown = connections.slice(0, count);
  const hidden = connections.slice(count);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <button
            type="button"
            className="flex shrink-0 items-center gap-2"
            onClick={() => setOpen(true)}
            data-testid="status-engine-connection"
            data-state={engine.state}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", engine.dot)} />
            <span className={cn("font-semibold uppercase tracking-wider", engine.text)}>{engine.label}</span>
          </button>
          {connections.length > 0 && (
            <span className="text-muted-foreground/60" aria-hidden>
              |
            </span>
          )}
          <div ref={rowRef} className="relative flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
            {shown.map((connection) => (
              <Tooltip key={connection.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="shrink-0"
                    onClick={() => setOpen(true)}
                    data-testid={`status-connection-${connection.id}`}
                    data-state={connection.state}
                  >
                    <ConnectionName connection={connection} />
                    <span className="sr-only">{connection.detail}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>{connection.detail}</TooltipContent>
              </Tooltip>
            ))}
            {hidden.length > 0 && (
              <button
                type="button"
                className={cn(NAME_CLASS, STATE_TEXT[worstState(hidden)])}
                onClick={() => setOpen(true)}
                aria-label={`${hidden.length} more connections`}
                data-testid="status-connection-overflow"
                data-state={worstState(hidden)}
              >
                +{hidden.length}
              </button>
            )}
            <div ref={measureRef} className="invisible absolute flex" aria-hidden>
              <span className={NAME_CLASS}>{CHIP_SAMPLE}</span>
              {connections.map((connection) => (
                <ConnectionName key={connection.id} connection={connection} />
              ))}
            </div>
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent side="top" align="start" className="w-96 space-y-3 text-sm" data-testid="connection-panel">
        <PanelRow name="Engine" state={<span className={engine.text}>{engine.label}</span>}>
          <span className="font-mono" data-testid="status-engine-version">
            {engine.version}
          </span>
        </PanelRow>
        {relayLimitation && <RelayRow limitation={relayLimitation} />}
        {connections.map((connection) => (
          <PanelRow
            key={connection.id}
            name={connection.label}
            state={<ConnectionName connection={{ ...connection, label: "" }} />}
          >
            {connection.detail}
          </PanelRow>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function PanelRow({ name, state, children }: { name: string; state: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2 font-medium">
        <span>{name}</span>
        {state}
      </div>
      <div className="text-xs text-muted-foreground">{children}</div>
    </div>
  );
}

function RelayRow({ limitation }: { limitation: RelayLimitation }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function reconnect(run: () => Promise<void>) {
    setBusy(true);
    try {
      await run();
    } catch (err) {
      toast({ title: "Couldn't reconnect", description: actionErrorMessage(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const { reconnect: run } = limitation;
  return (
    <PanelRow
      name="Relay"
      state={<AlertTriangle className={cn("h-3.5 w-3.5", STATE_TEXT.degraded)} aria-label="Needs attention" />}
    >
      <p>{limitation.detail}</p>
      {run && (
        <Button
          size="sm"
          variant="outline"
          className="mt-1.5"
          disabled={busy}
          onClick={() => void reconnect(run)}
          data-testid="button-reconnect-relay"
        >
          Reconnect
        </Button>
      )}
    </PanelRow>
  );
}
