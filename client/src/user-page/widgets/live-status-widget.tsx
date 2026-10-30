import type { WidgetOf } from "./types";

export function LiveStatusWidget({ widget }: { widget: WidgetOf<"live-status"> }) {
  const { isLive, title, game, viewerCount } = widget.live;
  if (!isLive) {
    return (
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 rounded-full bg-line" aria-hidden="true" />
        <p className="font-semibold text-muted">Offline right now</p>
      </div>
    );
  }
  return (
    <div>
      <p className="flex items-center gap-3 font-semibold">
        <span className="relative flex h-3 w-3" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-70 motion-safe:animate-ping" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-accent" />
        </span>
        Live now
      </p>
      {title !== undefined && <p className="mt-2 text-lg font-semibold leading-snug">{title}</p>}
      {(game !== undefined || viewerCount !== undefined) && (
        <p className="mt-1 text-sm text-muted">
          {game}
          {game !== undefined && viewerCount !== undefined && ", "}
          {viewerCount !== undefined && (
            <span className="tabular-nums">{`${viewerCount.toLocaleString()} watching`}</span>
          )}
        </p>
      )}
    </div>
  );
}
