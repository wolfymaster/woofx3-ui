import type { CatalogCounts, CatalogListing, ListingType } from "@shared/marketplace-catalog";
import { LISTING_TYPES } from "@shared/marketplace-catalog";
import { ListingArt } from "@/components/marketplace/listing-art";
import { Card } from "@/components/ui/card";
import { listingTypeIcon, listingTypeMeta } from "@/lib/listing-type";
import { BANNER_ASPECT } from "@/lib/marketplace-banner";
import { cn } from "@/lib/utils";

// The five listing types, as a shelf.
//
// All five always render, including a type with nothing in it: the tiles are
// the storefront's statement of what the marketplace sells, and a type that
// disappears when its last listing is retired makes the store look smaller
// than it is. A type with no listings says "0 listed" and still opens.
//
// Each tile is a card-rendition art area over a label strip, so the banner is
// shown whole and the label never covers its own text.

interface CategoryTilesProps {
  counts: CatalogCounts;
  /** A listing of each type, so a tile can show real art when there is some. */
  sample: Partial<Record<ListingType, CatalogListing>>;
  onSelect: (type: ListingType) => void;
}

export function CategoryTiles({ counts, sample, onSelect }: CategoryTilesProps) {
  return (
    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
      {LISTING_TYPES.map((type) => {
        const meta = listingTypeMeta(type);
        const count = counts[type] ?? 0;
        return (
          <Card
            key={type}
            role="button"
            tabIndex={0}
            aria-label={`Browse ${meta.plural.toLowerCase()}`}
            title={meta.blurb}
            className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-neutral-950 p-0 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl"
            onClick={() => onSelect(type)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(type);
              }
            }}
          >
            <div className={cn("relative w-full overflow-hidden", BANNER_ASPECT.card)}>
              <ListingArt
                listing={sample[type] ?? { type, images: {}, name: meta.plural }}
                rendition="card"
                scale={0.7}
                className="transition-transform duration-500 group-hover:scale-[1.06]"
              />
              <span className="absolute left-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-xl bg-black/45 text-white backdrop-blur-sm">
                {listingTypeIcon(type, "h-4 w-4")}
              </span>
            </div>
            <div className="bg-card px-4 py-3 text-card-foreground">
              <div className="text-[15px] font-semibold tracking-tight">{meta.plural}</div>
              <div className="text-xs text-muted-foreground">{count} listed</div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
