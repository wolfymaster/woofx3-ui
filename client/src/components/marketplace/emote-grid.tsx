import type { ListingEmote } from "@convex/lib/marketplaceCatalog";
import { Zap } from "lucide-react";

interface EmoteGridProps {
  emotes: ListingEmote[];
  license?: string;
}

/**
 * An emote pack's contents.
 *
 * This *is* the preview for an emote pack: the images are the product, so
 * there is nothing more honest to show than the pack itself at the size a
 * chat renders it. Each emote is shown at 56px — Twitch's 2x size — with the
 * 112px rendition available for density.
 *
 * Animated emotes are served from the original bytes, not the WebP
 * renditions, so they actually move here.
 */
export function EmoteGrid({ emotes, license }: EmoteGridProps) {
  if (emotes.length === 0) {
    return <p className="text-sm text-muted-foreground">This pack has no emotes yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {emotes.length} {emotes.length === 1 ? "emote" : "emotes"}
        </p>
        {license && <p className="text-xs text-muted-foreground">Licence: {license}</p>}
      </div>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
        {emotes.map((emote) => (
          <li
            key={emote.id}
            className="group flex flex-col items-center gap-1.5 rounded-lg border bg-card p-2.5 text-center"
          >
            <span className="relative flex h-14 w-14 items-center justify-center">
              <img
                src={emote.animated ? emote.original : emote.sizes.md}
                srcSet={emote.animated ? undefined : `${emote.sizes.md} 56w, ${emote.sizes.lg} 112w`}
                sizes="56px"
                width={56}
                height={56}
                alt={emote.name}
                loading="lazy"
                decoding="async"
                className="max-h-14 max-w-14 object-contain"
              />
              {emote.animated && (
                <span
                  title="Animated"
                  className="absolute -right-1 -top-1 rounded-full bg-background p-0.5 text-amber-500 shadow-sm"
                >
                  <Zap className="h-3 w-3" />
                </span>
              )}
            </span>
            <span className="w-full truncate text-[11px] font-medium">{emote.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
