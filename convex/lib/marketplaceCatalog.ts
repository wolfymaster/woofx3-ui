/**
 * The marketplace catalog's wire shapes, and the parsers that narrow them.
 *
 * The marketplace API is a separate service with its own release cycle, so
 * nothing here trusts the shape it sends: every field is checked, and an entry
 * that cannot be parsed is dropped rather than rendered half-formed. This
 * mirrors how `marketplace.ts` has always treated module listings.
 */

import { type MarketplaceImages, parseFeaturedRank, parseMarketplaceImages } from "./marketplaceImages";

/**
 * A kind of marketplace listing.
 *
 * `module` and `theme` are module archives and install through the module
 * path. `emote` is an image pack with no behaviour at all. `overlay` and
 * `alert` are prepackaged scene and alert-composition bundles.
 */
export type ListingType = "module" | "theme" | "emote" | "overlay" | "alert";

export const LISTING_TYPES: readonly ListingType[] = ["module", "theme", "emote", "overlay", "alert"];

function isListingType(value: unknown): value is ListingType {
  return typeof value === "string" && (LISTING_TYPES as readonly string[]).includes(value);
}

/** What a paid listing costs. Absent means free. */
export interface ListingPrice {
  amountCents: number;
  currency: string;
}

/** A streamer a listing credits as its inspiration. */
export interface ListingCredit {
  name: string;
  role?: string;
  url?: string;
  avatarUrl?: string;
  note?: string;
}

/** A way to see a listing before installing it. */
export interface ListingPreview {
  kind: "image" | "video" | "live";
  url: string;
  caption?: string;
}

/** One emote, with each rendition resolved to a URL. */
export interface ListingEmote {
  id: string;
  name: string;
  animated: boolean;
  sizes: { sm: string; md: string; lg: string };
  /** The source bytes. An animated emote only animates from this. */
  original: string;
}

/** One listing of any type, as the catalog grid shows it. */
export interface CatalogListing {
  id: string;
  type: ListingType;
  name: string;
  description: string;
  version: string;
  author: string;
  /** Address of the author's page. Absent when the listing names no author. */
  authorSlug?: string;
  category: string;
  tags: string[];
  images: MarketplaceImages;
  featuredRank?: number;
  tier: "public" | "dev";
  /** The module a theme needs installed first. */
  baseModuleId?: string;
  price?: ListingPrice;
  credits: ListingCredit[];
  updatedAt?: string;
  /**
   * Total installs, all time. 0 both for a listing nobody has installed and
   * for an API too old to count them, so the card treats 0 as "say nothing".
   */
  installCount: number;
  /**
   * How many of those installs landed in the last seven days, which is what
   * the storefront's trending rail ranks by. 0 both for a listing nobody
   * installed this week and for an API that does not count the window.
   */
  weeklyInstallCount: number;
  /**
   * Average rating, 1-5, or undefined when the listing is unrated -- which is
   * every listing until the ratings capability exists. The card reserves the
   * line rather than inventing a score.
   */
  rating?: number;
  ratingCount: number;
  /**
   * The author's avatar, denormalised onto the listing by the marketplace so a
   * grid of cards does not need a query per author. Absent means initials.
   */
  authorAvatarUrl?: string;
}

/** A module's own detail, as the listing page's lower half shows it. */
export interface CatalogModuleDetail {
  readme?: string;
  triggers: { id: string; name: string; description: string }[];
  actions: { id: string; name: string; description: string }[];
  functions: { id: string; name: string; runtime?: string }[];
  widgets: { id: string; name: string; description: string }[];
  /** Widgets of this module that accept themes. */
  themeable: { widgetId: string; contractVersion: number }[];
  /** What a theme pack reskins. */
  themes: { id: string; name: string; description?: string; target: string }[];
  requires: Record<string, string>;
}

/** One listing with everything its page needs. */
export interface CatalogListingDetail extends CatalogListing {
  previews: ListingPreview[];
  emotes?: ListingEmote[];
  license?: string;
  /** The scene or alert composition an overlay or alert listing installs. */
  bundle?: Record<string, unknown>;
  /** Modules a bundle's widgets come from. */
  requires?: string[];
  module?: CatalogModuleDetail;
}

export interface CatalogPage {
  listings: CatalogListing[];
  total: number;
  limit: number;
  offset: number;
}

/** How many ready listings the catalog holds, per type. */
export type CatalogCounts = Record<ListingType, number>;

export interface MarketplaceAuthorLink {
  label: string;
  url: string;
}

export interface MarketplaceAuthor {
  slug: string;
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  links: MarketplaceAuthorLink[];
  /** False when the page is built from the author string on their listings. */
  claimed: boolean;
}

export interface AuthorPage {
  author: MarketplaceAuthor;
  listings: CatalogListing[];
  total: number;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * A rating is only shown when it is a number inside the scale. Anything else
 * -- null from an API with no ratings yet, a 0 from a buggy aggregate, a
 * string -- means "unrated", which the card renders as no stars at all rather
 * than as a zero-star listing.
 */
function parseRating(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 5) {
    return undefined;
  }
  return value;
}

/** A count that cannot be negative and is 0 when the API sends nothing. */
function asCount(value: unknown): number {
  const n = asNumber(value, 0);
  return n > 0 ? Math.floor(n) : 0;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function parsePrice(value: unknown): ListingPrice | undefined {
  const obj = asObject(value);
  const amountCents = asNumber(obj.amountCents, -1);
  // A zero or negative amount is not a price. The marketplace refuses one, so
  // seeing it here means a shape we do not understand -- better to render the
  // listing as free than to show a "Buy for $0.00" button.
  if (amountCents <= 0) {
    return undefined;
  }
  return { amountCents, currency: asString(obj.currency, "usd") };
}

function parseCredits(value: unknown): ListingCredit[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: ListingCredit[] = [];
  for (const raw of value) {
    const obj = asObject(raw);
    const name = asString(obj.name);
    if (!name) {
      continue;
    }
    const credit: ListingCredit = { name };
    credit.role = optionalString(obj.role);
    credit.url = optionalString(obj.url);
    credit.avatarUrl = optionalString(obj.avatarUrl);
    credit.note = optionalString(obj.note);
    out.push(credit);
  }
  return out;
}

function parsePreviews(value: unknown): ListingPreview[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: ListingPreview[] = [];
  for (const raw of value) {
    const obj = asObject(raw);
    const kind = asString(obj.kind);
    const url = asString(obj.url);
    if (!url || (kind !== "image" && kind !== "video" && kind !== "live")) {
      continue;
    }
    const preview: ListingPreview = { kind, url };
    preview.caption = optionalString(obj.caption);
    out.push(preview);
  }
  return out;
}

function parseEmotes(value: unknown): ListingEmote[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: ListingEmote[] = [];
  for (const raw of value) {
    const obj = asObject(raw);
    const id = asString(obj.id);
    const sizes = asObject(obj.sizes);
    const sm = asString(sizes.sm);
    const md = asString(sizes.md);
    const lg = asString(sizes.lg);
    // Every size or nothing: a grid that falls back per-emote would render at
    // mismatched resolutions.
    if (!id || !sm || !md || !lg) {
      continue;
    }
    out.push({
      id,
      name: asString(obj.name, id),
      animated: obj.animated === true,
      sizes: { sm, md, lg },
      original: asString(obj.original, lg),
    });
  }
  return out;
}

export function parseCatalogListing(raw: unknown): CatalogListing | null {
  const obj = asObject(raw);
  const id = asString(obj.id);
  if (!id || !isListingType(obj.type)) {
    return null;
  }
  const listing: CatalogListing = {
    id,
    type: obj.type,
    name: asString(obj.name, id),
    description: asString(obj.description),
    version: asString(obj.version, "0.0.0"),
    author: asString(obj.author),
    category: asString(obj.category, defaultCategoryFor(obj.type)),
    tags: asStringArray(obj.tags),
    images: parseMarketplaceImages(obj.images),
    tier: obj.tier === "dev" ? "dev" : "public",
    credits: parseCredits(obj.credits),
    installCount: asCount(obj.installCount),
    weeklyInstallCount: asCount(obj.weeklyInstallCount),
    ratingCount: asCount(obj.ratingCount),
  };
  listing.rating = parseRating(obj.rating);
  listing.authorAvatarUrl = optionalString(obj.authorAvatarUrl);
  listing.authorSlug = optionalString(obj.authorSlug);
  listing.baseModuleId = optionalString(obj.baseModuleId);
  listing.price = parsePrice(obj.price);
  listing.updatedAt = optionalString(obj.updatedAt);
  const featuredRank = parseFeaturedRank(obj.featuredRank);
  if (featuredRank !== undefined) {
    listing.featuredRank = featuredRank;
  }
  return listing;
}

/**
 * The category a listing falls into when it declares none.
 *
 * The non-module types have no manifest to carry a category, so their type
 * doubles as one -- which is also what puts Emotes, Themes, Overlays and
 * Alerts in the storefront's category list beside the module categories.
 */
function defaultCategoryFor(type: ListingType): string {
  switch (type) {
    case "emote":
      return "Emotes";
    case "overlay":
      return "Overlays";
    case "alert":
      return "Alerts";
    case "theme":
      return "Themes";
    default:
      return "Utilities";
  }
}

function parseModuleDetail(raw: unknown): CatalogModuleDetail | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const obj = asObject(raw);
  const named = (value: unknown) => {
    if (!Array.isArray(value)) {
      return [];
    }
    const out: { id: string; name: string; description: string }[] = [];
    for (const entry of value) {
      const item = asObject(entry);
      const id = asString(item.id);
      if (!id) {
        continue;
      }
      out.push({ id, name: asString(item.name, id), description: asString(item.description) });
    }
    return out;
  };

  const functions: CatalogModuleDetail["functions"] = [];
  for (const entry of Array.isArray(obj.functions) ? obj.functions : []) {
    const item = asObject(entry);
    const id = asString(item.id);
    if (!id) {
      continue;
    }
    functions.push({ id, name: asString(item.name, id), runtime: optionalString(item.runtime) });
  }

  const themeable: CatalogModuleDetail["themeable"] = [];
  for (const entry of Array.isArray(obj.themeable) ? obj.themeable : []) {
    const item = asObject(entry);
    const widgetId = asString(item.widgetId);
    if (!widgetId) {
      continue;
    }
    themeable.push({ widgetId, contractVersion: asNumber(item.contractVersion, 1) });
  }

  const themes: CatalogModuleDetail["themes"] = [];
  for (const entry of Array.isArray(obj.themes) ? obj.themes : []) {
    const item = asObject(entry);
    const id = asString(item.id);
    const target = asString(item.target);
    if (!id || !target) {
      continue;
    }
    themes.push({ id, name: asString(item.name, id), description: optionalString(item.description), target });
  }

  const requires: Record<string, string> = {};
  for (const [key, value] of Object.entries(asObject(obj.requires))) {
    if (typeof value === "string") {
      requires[key] = value;
    }
  }

  return {
    readme: optionalString(obj.readme),
    triggers: named(obj.triggers),
    actions: named(obj.actions),
    functions,
    widgets: named(obj.widgets),
    themeable,
    themes,
    requires,
  };
}

export function parseCatalogDetail(raw: unknown): CatalogListingDetail | null {
  const listing = parseCatalogListing(raw);
  if (!listing) {
    return null;
  }
  const obj = asObject(raw);
  const detail: CatalogListingDetail = { ...listing, previews: parsePreviews(obj.previews) };
  if (listing.type === "emote") {
    detail.emotes = parseEmotes(obj.emotes);
    detail.license = optionalString(obj.license);
  }
  if (listing.type === "overlay" || listing.type === "alert") {
    const bundle = obj.bundle;
    if (bundle && typeof bundle === "object") {
      detail.bundle = bundle as Record<string, unknown>;
    }
    detail.requires = asStringArray(obj.requires);
  }
  detail.module = parseModuleDetail(obj.module);
  return detail;
}

export function parseCatalogPage(payload: unknown): CatalogPage {
  const obj = asObject(payload);
  const raw = Array.isArray(obj.listings) ? obj.listings : [];
  const listings = raw.map(parseCatalogListing).filter((l): l is CatalogListing => l !== null);
  return {
    listings,
    // The marketplace's own total, not the parsed length: an entry dropped as
    // unparseable should not make "showing 48 of 312" lie about the catalog.
    total: asNumber(obj.total, listings.length),
    limit: asNumber(obj.limit, listings.length),
    offset: asNumber(obj.offset),
  };
}

/**
 * `GET /catalog/counts`, narrowed to a count per type.
 *
 * Every type is present whatever the API sent, so the category tiles render
 * all five rather than hiding a type because its count was missing: a type
 * with nothing in it is a true "0 listed", not an absent tile.
 */
export function parseCatalogCounts(payload: unknown): CatalogCounts {
  const obj = asObject(asObject(payload).counts ?? payload);
  const counts = {} as CatalogCounts;
  for (const type of LISTING_TYPES) {
    counts[type] = asCount(obj[type]);
  }
  return counts;
}

export function parseAuthorPage(payload: unknown): AuthorPage | null {
  const obj = asObject(payload);
  const authorObj = asObject(obj.author);
  const slug = asString(authorObj.slug);
  if (!slug) {
    return null;
  }
  const links: MarketplaceAuthorLink[] = [];
  for (const entry of Array.isArray(authorObj.links) ? authorObj.links : []) {
    const item = asObject(entry);
    const url = asString(item.url);
    if (!url) {
      continue;
    }
    links.push({ label: asString(item.label, url), url });
  }
  const raw = Array.isArray(obj.listings) ? obj.listings : [];
  const listings = raw.map(parseCatalogListing).filter((l): l is CatalogListing => l !== null);
  return {
    author: {
      slug,
      displayName: asString(authorObj.displayName, slug),
      bio: optionalString(authorObj.bio),
      avatarUrl: optionalString(authorObj.avatarUrl),
      links,
      claimed: authorObj.claimed === true,
    },
    listings,
    total: asNumber(obj.total, listings.length),
  };
}

/** Whether a listing installs through the module path. */
export function isModuleListing(type: ListingType): boolean {
  return type === "module" || type === "theme";
}

/** Whether a listing installs by writing a scene or alert composition. */
export function isBundleListing(type: ListingType): boolean {
  return type === "overlay" || type === "alert";
}
