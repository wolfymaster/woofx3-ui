import type { CatalogListing } from "@convex/lib/marketplaceCatalog";
import { Star } from "lucide-react";
import { ListingArt } from "@/components/marketplace/listing-art";
import type { ListingCardState } from "@/components/marketplace/listing-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { authorInitials, hasStats, listingStats } from "@/lib/listing-signals";
import { formatPrice, listingTypeColor, listingTypeMeta } from "@/lib/listing-type";
import { cn } from "@/lib/utils";

// The storefront's front window: one large featured listing and two smaller
// ones beside it.
//
// Curation is the marketplace's (`featuredRank`), so this renders whatever it
// is handed, in order. With a single featured listing the hero is the single
// listing full width, because two thirds of a hero and an empty column reads
// as a page that failed to load.

interface StorefrontHeroProps {
  /** Featured listings in curation order. */
  featured: CatalogListing[];
  state: (listing: CatalogListing) => ListingCardState;
  onOpen: (id: string) => void;
}

export function StorefrontHero({ featured, state, onOpen }: StorefrontHeroProps) {
  const [main, ...rest] = featured;
  if (!main) {
    return null;
  }
  const side = rest.slice(0, 2);

  return (
    <div className={cn("grid gap-4", side.length > 0 && "lg:grid-cols-[2fr_1fr]")}>
      <HeroMain listing={main} state={state(main)} onOpen={onOpen} />
      {side.length > 0 && (
        <div className="flex flex-col gap-4">
          {side.map((listing) => (
            <HeroSide key={listing.id} listing={listing} state={state(listing)} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

function HeroMain({
  listing,
  state,
  onOpen,
}: {
  listing: CatalogListing;
  state: ListingCardState;
  onOpen: (id: string) => void;
}) {
  return (
    <HeroPanel listing={listing} onOpen={onOpen} scale={1.6} className="min-h-[360px]">
      <HeroKicker label={`Featured · ${listingTypeMeta(listing.type).label}`} />
      <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">{listing.name}</h2>
      {listing.description && (
        <p className="line-clamp-2 max-w-xl text-sm leading-relaxed text-white/70">{listing.description}</p>
      )}
      <HeroMeta listing={listing} />
      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Button size="lg" className="font-semibold shadow-lg shadow-primary/30" onClick={press(listing.id, onOpen)}>
          {ctaLabel(listing, state)}
        </Button>
        <div className="leading-tight text-white">
          <div className="text-xl font-extrabold tracking-tight">{formatPrice(listing.price)}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/60">
            {listing.price ? "One-time purchase" : "No purchase needed"}
          </div>
        </div>
      </div>
    </HeroPanel>
  );
}

function HeroSide({
  listing,
  state,
  onOpen,
}: {
  listing: CatalogListing;
  state: ListingCardState;
  onOpen: (id: string) => void;
}) {
  const stats = listingStats(listing);
  return (
    <HeroPanel listing={listing} onOpen={onOpen} scale={0.8} className="min-h-[172px] flex-1">
      <HeroKicker label="Featured" />
      <h3 className="line-clamp-2 text-lg font-bold leading-tight tracking-tight text-white">{listing.name}</h3>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
        <Button size="sm" className="font-semibold" onClick={press(listing.id, onOpen)}>
          {ctaLabel(listing, state)}
        </Button>
        {hasStats(stats) && (
          <span className="flex items-center gap-1.5 text-xs text-white/75">
            {stats.rating && (
              <span className="flex items-center gap-1 font-semibold text-amber-300">
                <Star className="h-3 w-3 fill-current" />
                {stats.rating}
              </span>
            )}
            {stats.installs && <span>{stats.installs} installs</span>}
          </span>
        )}
      </div>
    </HeroPanel>
  );
}

/** The art, the scrim and the click target every hero panel shares. */
function HeroPanel({
  listing,
  onOpen,
  scale,
  className,
  children,
}: {
  listing: CatalogListing;
  onOpen: (id: string) => void;
  scale: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`View ${listingTypeMeta(listing.type).label.toLowerCase()} ${listing.name}`}
      className={cn(
        "group relative flex cursor-pointer overflow-hidden rounded-2xl bg-neutral-950 p-0 transition-transform duration-200 hover:-translate-y-1",
        "dark:border-primary/30 dark:shadow-[0_0_60px_-18px_hsl(var(--primary)/0.6)]",
        className
      )}
      onClick={() => onOpen(listing.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(listing.id);
        }
      }}
    >
      <ListingArt
        listing={listing}
        sizes="(min-width: 1280px) 900px, 100vw"
        scale={scale}
        className="transition-transform duration-500 group-hover:scale-[1.03]"
      />
      {/* The copy sits on a scrim rather than on the art: a featured listing's
          own banner can be any colour, and the name has to stay readable. */}
      <div className="relative z-10 mt-auto w-full space-y-2 bg-gradient-to-t from-black/90 via-black/55 to-transparent p-6">
        {children}
      </div>
    </Card>
  );
}

function HeroKicker({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.1em] text-violet-200">
      <span className="h-1.5 w-1.5 rounded-full bg-[#EC6758] shadow-[0_0_10px_#EC6758]" />
      {label}
    </div>
  );
}

function HeroMeta({ listing }: { listing: CatalogListing }) {
  const stats = listingStats(listing);
  const author = listing.author || "Unknown";
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-white/75">
      {listing.authorAvatarUrl ? (
        <img
          src={listing.authorAvatarUrl}
          alt=""
          width={24}
          height={24}
          loading="lazy"
          className="h-6 w-6 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white"
          style={{ backgroundColor: listingTypeColor(listing.type) }}
        >
          {authorInitials(author)}
        </span>
      )}
      <span>{author}</span>
      {stats.rating && (
        <span className="flex items-center gap-1 font-semibold text-amber-300">
          <Star className="h-3 w-3 fill-current" />
          {stats.rating}
          {stats.ratingCount && <span className="font-normal text-white/70">({stats.ratingCount})</span>}
        </span>
      )}
      {stats.installs && <span>· {stats.installs} installs</span>}
    </div>
  );
}

function press(id: string, onOpen: (id: string) => void) {
  return (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpen(id);
  };
}

/** What the hero's button says, given what the account already has. */
function ctaLabel(listing: CatalogListing, state: ListingCardState): string {
  if (state.updateAvailable) {
    return "Update";
  }
  if (state.isInstalled) {
    return "Installed";
  }
  if (listing.price && !state.isOwned) {
    return `Buy · ${formatPrice(listing.price)}`;
  }
  return listing.price ? "Install — owned" : "Install — Free";
}
