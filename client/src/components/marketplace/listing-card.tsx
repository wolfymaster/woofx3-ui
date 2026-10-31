import type { CatalogListing } from "@shared/marketplace-catalog";
import { Check, Download, Star } from "lucide-react";
import { ListingArt } from "@/components/marketplace/listing-art";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { authorInitials, hasStats, type ListingBadge, listingStats } from "@/lib/listing-signals";
import { listingTypeColor, listingTypeIcon, listingTypeMeta, pricingLabel } from "@/lib/listing-type";
import { cn } from "@/lib/utils";

export interface ListingCardState {
  /** Already installed on this instance. Only modules and themes can be. */
  isInstalled?: boolean;
  /** A newer version of an installed module is available. */
  updateAvailable?: boolean;
  /** The account holds this listing. */
  isOwned?: boolean;
}

interface ListingCardProps {
  listing: CatalogListing;
  state?: ListingCardState;
  /** The one value badge this listing earned, from `listingBadge`. */
  badge?: ListingBadge | null;
  /** `rail` is the fixed-width card the horizontal rails scroll. */
  size?: "default" | "rail";
  onClick: () => void;
  /** Opens the author's page instead of the listing. */
  onAuthorClick?: (slug: string) => void;
}

/**
 * One listing in the storefront, whatever its type.
 *
 * The scan path is art, name, price: the art gets 16:10 because on a creator
 * marketplace the thumbnail is the product, the name is one line because a
 * second line of description moves the price below the fold, and the action is
 * a real button because a text link does not read as something you can press.
 * Everything that is not one of those three -- the description, the credits,
 * the version -- belongs on the listing page, which is one click away.
 */
export function ListingCard({ listing, state, badge, size = "default", onClick, onAuthorClick }: ListingCardProps) {
  const meta = listingTypeMeta(listing.type);
  const stats = listingStats(listing);
  const authorName = listing.author || "Unknown";

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`View ${meta.label.toLowerCase()} ${listing.name}`}
      className={cn(
        "group flex cursor-pointer flex-col overflow-hidden rounded-2xl p-0 text-left",
        "transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-foreground/10",
        // Dark mode gets the border glow in the listing type's own hue: the
        // grid is the one place a streamer reads five types at once.
        "hover:border-foreground/20 dark:hover:border-[color:var(--type-hue-border)] dark:hover:shadow-primary/25",
        size === "rail" ? "w-[272px] shrink-0" : "w-full"
      )}
      style={{ "--type-hue-border": listingTypeColor(listing.type) } as React.CSSProperties}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="relative aspect-[16/10] shrink-0 overflow-hidden bg-neutral-950">
        <ListingArt
          listing={listing}
          sizes={size === "rail" ? "272px" : "(min-width: 1280px) 320px, (min-width: 820px) 33vw, 50vw"}
          className="transition-transform duration-500 group-hover:scale-[1.05]"
        />
        {/* Taxonomy, quietly: a streamer filters by type in the rail, so on
            the card it is a label rather than a shout. */}
        <span className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
          {listingTypeIcon(listing.type, "h-3 w-3")}
          {meta.label}
        </span>
        {badge && <BadgeRibbon badge={badge} />}
        {state?.isOwned && listing.pricing?.mode === "paid" && !badge && (
          <span className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
            <Check className="h-3 w-3" />
            Owned
          </span>
        )}
        {listing.tier === "dev" && (
          <span
            className="absolute bottom-2.5 right-2.5 rounded-full border border-amber-400/60 bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-amber-300 backdrop-blur-sm"
            title="Dev-tier listing: hidden from the public catalog"
          >
            Dev
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="truncate text-[15px] font-semibold leading-snug tracking-tight">{listing.name}</h3>

        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <AuthorAvatar listing={listing} name={authorName} />
          {listing.authorSlug && onAuthorClick ? (
            // Stops the card's own click so the author page is reachable
            // without landing on the listing first.
            <button
              type="button"
              className="truncate text-left hover:text-foreground hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                onAuthorClick(listing.authorSlug as string);
              }}
            >
              {authorName}
            </button>
          ) : (
            <span className="truncate">{authorName}</span>
          )}
        </div>

        {/* The stats line keeps its height whether or not the marketplace has
            the numbers yet, so a catalog that starts counting installs does
            not reflow every card on the page. */}
        <div className="flex h-4 items-center gap-1.5 text-xs text-muted-foreground">
          {hasStats(stats) && (
            <>
              {stats.rating && (
                <span className="flex items-center gap-1 font-semibold text-amber-500 dark:text-amber-400">
                  <Star className="h-3 w-3 fill-current" />
                  {stats.rating}
                </span>
              )}
              {stats.ratingCount && <span>({stats.ratingCount})</span>}
              {stats.rating && stats.installs && <span aria-hidden="true">·</span>}
              {stats.installs && <span>{stats.installs} installs</span>}
            </>
          )}
        </div>

        {listing.type === "theme" && listing.baseModuleId && (
          <p className="truncate text-[11px] text-muted-foreground">Requires {listing.baseModuleId}</p>
        )}

        <CardCta listing={listing} state={state} onClick={onClick} />
      </div>
    </Card>
  );
}

/** The value badge: what a buyer gets from this listing over its neighbours. */
function BadgeRibbon({ badge }: { badge: ListingBadge }) {
  const label = badge === "bestseller" ? "Bestseller" : badge === "staff" ? "Staff pick" : "New";
  return (
    <span
      className={cn(
        "absolute right-2.5 top-2.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-lg",
        badge === "bestseller" && "bg-[#EC6758] shadow-[#EC6758]/40",
        badge === "staff" && "bg-primary shadow-primary/40",
        badge === "new" && "bg-emerald-600 shadow-emerald-600/40"
      )}
    >
      {label}
    </span>
  );
}

function AuthorAvatar({ listing, name }: { listing: CatalogListing; name: string }) {
  if (listing.authorAvatarUrl) {
    return (
      <img
        src={listing.authorAvatarUrl}
        alt=""
        width={22}
        height={22}
        loading="lazy"
        decoding="async"
        className="h-[22px] w-[22px] shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
      style={{ backgroundColor: listingTypeColor(listing.type) }}
    >
      {authorInitials(name)}
    </span>
  );
}

/**
 * The card's action, as a button rather than a text link.
 *
 * It opens the listing rather than installing from the grid: a module install
 * needs the permission approval the listing page carries, and a purchase is a
 * redirect to Stripe. What the button adds here is the state -- free, owned,
 * installed, or what it costs -- so a streamer knows what pressing it starts
 * before a page loads.
 */
function CardCta({
  listing,
  state,
  onClick,
}: {
  listing: CatalogListing;
  state?: ListingCardState;
  onClick: () => void;
}) {
  const press = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick();
  };

  if (listing.type === "emote") {
    return (
      <Button variant="outline" className="mt-auto w-full font-semibold" onClick={press}>
        View emotes
      </Button>
    );
  }
  if (state?.updateAvailable) {
    return (
      <Button className="mt-auto w-full gap-2 font-semibold" onClick={press}>
        <Download className="h-4 w-4" />
        Update
      </Button>
    );
  }
  if (state?.isInstalled) {
    return (
      <Button variant="outline" className="mt-auto w-full gap-2 font-semibold" onClick={press}>
        <Check className="h-4 w-4" />
        Installed
      </Button>
    );
  }
  if (listing.pricing === null) {
    // Nobody can install a listing that has no pricing. Its page says why.
    return (
      <Button variant="outline" className="mt-auto w-full font-semibold" onClick={press}>
        Unavailable
      </Button>
    );
  }
  const paid = listing.pricing.mode === "paid";
  if (paid && !state?.isOwned) {
    return (
      <Button className="mt-auto w-full font-semibold" onClick={press}>
        Buy · {pricingLabel(listing.pricing)}
      </Button>
    );
  }
  return (
    <Button variant={paid ? "outline" : "default"} className="mt-auto w-full gap-2 font-semibold" onClick={press}>
      <Download className="h-4 w-4" />
      {paid ? "Install — owned" : "Install — Free"}
    </Button>
  );
}
