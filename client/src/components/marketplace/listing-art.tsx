import type { CatalogListing, ListingType } from "@shared/marketplace-catalog";
import { ModuleBannerImage } from "@/components/modules/module-image";
import { listingTypeHue, listingTypeIcon } from "@/lib/listing-type";
import { cn } from "@/lib/utils";

// A listing's product shot.
//
// On a creator marketplace the thumbnail *is* the product: a theme or an emote
// pack lives or dies on its art, so the card gives it 16:10 and this fills it.
// An uploaded banner always wins. What is left is the listings with no banner,
// and for those a placeholder has to look like product art rather than like a
// loading skeleton -- hence a deep type-hued gradient with a motif of what the
// type actually does, not a stripe pattern.

interface ListingArtProps {
  listing: Pick<CatalogListing, "type" | "images" | "name">;
  /** The `sizes` attribute for a real banner image. */
  sizes: string;
  /** Scales the motif's type, for the hero's much larger surface. */
  scale?: number;
  className?: string;
}

export function ListingArt({ listing, sizes, scale = 1, className }: ListingArtProps) {
  const hue = listingTypeHue(listing.type);
  return (
    <div className={cn("absolute inset-0 overflow-hidden", className)} style={placeholderStyle(hue)}>
      {/* The type's own glyph, oversized and faint: it reads as art at the
          corner of a card and as a watermark on the hero. */}
      <span className="absolute -bottom-6 -right-5 text-white/10">{listingTypeIcon(listing.type, "h-32 w-32")}</span>
      <Motif type={listing.type} hue={hue} scale={scale} />
      {listing.images.banner && <ModuleBannerImage banner={listing.images.banner} sizes={sizes} />}
    </div>
  );
}

/**
 * The placeholder surface: two off-centre hue glows over a near-black
 * gradient. Dark in both themes on purpose -- product art is art, and a card's
 * image switching from dark to light would make the grid flicker between
 * identities rather than feel like one store.
 */
function placeholderStyle(hue: number): React.CSSProperties {
  return {
    backgroundImage: [
      `radial-gradient(60% 55% at 22% 18%, hsl(${hue} 85% 62% / 0.5), transparent 70%)`,
      `radial-gradient(65% 60% at 82% 88%, hsl(${(hue + 60) % 360} 80% 60% / 0.38), transparent 70%)`,
      `linear-gradient(135deg, hsl(${hue} 45% 16%), hsl(${hue} 50% 7%))`,
    ].join(", "),
  };
}

/** What each type looks like when it has no art of its own yet. */
function Motif({ type, hue, scale }: { type: ListingType; hue: number; scale: number }) {
  const centred = "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2";
  const glow = `0 0 34px hsl(${hue} 85% 60% / 0.5)`;

  if (type === "module" || type === "theme") {
    // A widget mid-stream: the counter most modules and every counter theme
    // end up rendering. The theme version is the same widget, reskinned.
    const themed = type === "theme";
    return (
      <div
        className={cn(centred, "rounded-xl border px-6 py-3 text-center", themed && "-rotate-2")}
        style={{
          backgroundColor: themed ? "hsl(270 60% 4% / 0.9)" : "hsl(260 50% 5% / 0.72)",
          borderColor: `hsl(${hue} 80% ${themed ? 72 : 65}% / ${themed ? 1 : 0.6})`,
          boxShadow: glow,
        }}
      >
        <div
          className="font-extrabold leading-none tracking-tight"
          style={{
            fontSize: `${34 * scale}px`,
            ...(themed
              ? {
                  backgroundImage: `linear-gradient(90deg, hsl(${hue} 85% 75%), hsl(${(hue + 120) % 360} 85% 70%))`,
                  backgroundClip: "text",
                  color: "transparent",
                }
              : { color: "#fff", textShadow: `0 0 18px hsl(${hue} 90% 70% / 0.9)` }),
          }}
        >
          1,284
        </div>
        <div className="mt-1 text-[10px] font-bold tracking-[0.22em]" style={{ color: `hsl(${hue} 80% 78%)` }}>
          HYPE
        </div>
      </div>
    );
  }

  if (type === "emote") {
    // The emote row, which is what an emote pack is: faces, in a line.
    return (
      <div className={cn(centred, "flex items-center gap-2")}>
        {[0, 300, 60, 180].map((offset, index) => (
          <EmoteFace
            key={offset}
            hue={(hue + offset) % 360}
            // The row tapers so it reads as a set rather than as four icons.
            size={(index === 0 || index === 3 ? 26 : 32) * scale}
          />
        ))}
      </div>
    );
  }

  if (type === "overlay") {
    // A scene thumbnail: webcam frame, title bar, chat box.
    return (
      <div
        className={cn(centred, "aspect-video w-[72%] overflow-hidden rounded-lg border")}
        style={{
          backgroundColor: "hsl(260 60% 3% / 0.8)",
          borderColor: `hsl(${hue} 70% 55% / 0.55)`,
          boxShadow: glow,
        }}
      >
        <div
          className="absolute left-[6%] top-[12%] h-[10%] w-[44%] rounded-full"
          style={{ backgroundColor: `hsl(${hue} 85% 60% / 0.7)` }}
        />
        <div
          className="absolute right-[6%] top-[12%] aspect-[16/10] w-[30%] rounded border"
          style={{ backgroundColor: `hsl(${hue} 60% 35%)`, borderColor: `hsl(${hue} 80% 70% / 0.6)` }}
        />
        <div className="absolute bottom-[10%] left-[6%] h-[34%] w-[38%] rounded bg-white/10" />
      </div>
    );
  }

  // An alert, as it fires on stream.
  return (
    <div
      className={cn(centred, "rounded-xl border px-5 py-3 text-center")}
      style={{
        backgroundColor: "hsl(260 50% 4% / 0.85)",
        borderColor: `hsl(${hue} 85% 65%)`,
        boxShadow: glow,
      }}
    >
      <div className="text-[10px] font-extrabold tracking-[0.18em]" style={{ color: `hsl(${hue} 85% 72%)` }}>
        ★ NEW FOLLOWER ★
      </div>
      <div className="mt-1.5 font-extrabold text-white" style={{ fontSize: `${20 * scale}px` }}>
        wolfy_fan_92
      </div>
      <div className="mt-0.5 text-[10px] text-white/60">just followed!</div>
    </div>
  );
}

function EmoteFace({ hue, size }: { hue: number; size: number }) {
  const ink = `hsl(${hue} 60% 20%)`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      style={{ filter: `drop-shadow(0 0 10px hsl(${hue} 90% 60% / 0.45))` }}
    >
      <rect x="4" y="10" width="40" height="32" rx="10" fill={`hsl(${hue} 85% 68%)`} />
      <path d="M10 14 6 4l10 6zM38 14l4-10-10 6z" fill={`hsl(${hue} 85% 68%)`} />
      <circle cx="18" cy="26" r="3.2" fill={ink} />
      <circle cx="30" cy="26" r="3.2" fill={ink} />
      <path d="M18 34c2.5 2.5 9.5 2.5 12 0" stroke={ink} strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}
