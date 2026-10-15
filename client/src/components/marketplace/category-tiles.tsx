import type { CatalogCounts, CatalogListing, ListingType } from "@convex/lib/marketplaceCatalog";
import { LISTING_TYPES } from "@convex/lib/marketplaceCatalog";
import { ListingArt } from "@/components/marketplace/listing-art";
import { Card } from "@/components/ui/card";
import { listingTypeIcon, listingTypeMeta } from "@/lib/listing-type";

// The five listing types, as a shelf.
//
// All five always render, including a type with nothing in it: the tiles are
// the storefront's statement of what the marketplace sells, and a type that
// disappears when its last listing is retired makes the store look smaller
// than it is. A type with no listings says "0 listed" and still opens.

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
            className="group relative flex min-h-[128px] cursor-pointer items-end overflow-hidden rounded-2xl bg-neutral-950 p-0 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl"
            onClick={() => onSelect(type)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(type);
              }
            }}
          >
            <ListingArt
              listing={sample[type] ?? { type, images: {}, name: meta.plural }}
              sizes="(min-width: 1024px) 260px, 50vw"
              scale={0.7}
              className="transition-transform duration-500 group-hover:scale-[1.06]"
            />
            <span className="absolute left-3.5 top-3 flex h-8 w-8 items-center justify-center rounded-xl bg-white/15 text-white backdrop-blur-sm">
              {listingTypeIcon(type, "h-4 w-4")}
            </span>
            <div className="relative z-10 w-full bg-gradient-to-t from-black/85 to-transparent px-4 py-3">
              <div className="text-[15px] font-semibold tracking-tight text-white">{meta.plural}</div>
              <div className="text-xs text-white/65">{count} listed</div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
