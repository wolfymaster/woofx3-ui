// The value a `media` / `asset` config field stores. Every renderer of these
// values (the engine's widget host, the module SDK's widget bindings, the
// alert previews here) reads only `.url`, so a file from the asset library and
// a file hosted elsewhere share one object shape and differ only in where the
// URL came from. A bare URL string is also accepted on read, because those
// renderers accept one too and a setting may hold one.

export type MediaKind = "image" | "video" | "audio" | "other";

/** A file chosen from the instance's asset library; `id` is its engine resource id. */
export interface LibraryMediaValue {
  id: string;
  name: string;
  url: string;
  type: string;
}

/** A file hosted outside the asset library, entered as a URL. It has no resource id. */
export interface ExternalMediaValue {
  source: "url";
  name: string;
  url: string;
  type: string;
}

export type MediaValue = LibraryMediaValue | ExternalMediaValue;

const EXTENSION_KINDS: Record<string, MediaKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  apng: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  ogv: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  oga: "audio",
  m4a: "audio",
  aac: "audio",
  flac: "audio",
  opus: "audio",
};

export function isExternalMediaValue(value: MediaValue): value is ExternalMediaValue {
  return "source" in value && value.source === "url";
}

/**
 * The URL when `input` is an absolute http(s) URL, otherwise null. Other
 * schemes are refused: `javascript:` and `data:` have no place in a setting
 * that an overlay loads, and a relative path would resolve against whichever
 * page happens to render it.
 */
export function parseMediaUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (trimmed === "") {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (url.hostname === "") {
    return null;
  }
  return url;
}

/** The media kind a URL's file extension implies, or "other" when it implies none. */
export function mediaKindFromUrl(url: URL): MediaKind {
  const lastSegment = url.pathname.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  if (dot < 0) {
    return "other";
  }
  return EXTENSION_KINDS[lastSegment.slice(dot + 1).toLowerCase()] ?? "other";
}

/** A readable label for a URL: its file name, or its host when the path names no file. */
export function mediaNameFromUrl(url: URL): string {
  const lastSegment = url.pathname.split("/").filter(Boolean).pop();
  if (!lastSegment) {
    return url.hostname;
  }
  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
}

/**
 * The stored value for an external URL. A field that declares a media type
 * knows what it is getting; otherwise the extension decides.
 */
export function externalMediaValue(url: URL, fieldMediaType?: MediaKind): ExternalMediaValue {
  return {
    source: "url",
    name: mediaNameFromUrl(url),
    url: url.toString(),
    type: fieldMediaType ?? mediaKindFromUrl(url),
  };
}

/** Reads a stored field value into a MediaValue, or null when it holds no usable URL. */
export function toMediaValue(raw: unknown): MediaValue | null {
  if (typeof raw === "string") {
    const url = parseMediaUrl(raw);
    return url ? externalMediaValue(url) : null;
  }
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const candidate = raw as Partial<Record<keyof LibraryMediaValue | "source", unknown>>;
  if (typeof candidate.url !== "string" || candidate.url === "") {
    return null;
  }
  const name = typeof candidate.name === "string" && candidate.name !== "" ? candidate.name : candidate.url;
  const type = typeof candidate.type === "string" ? candidate.type : "other";
  if (candidate.source === "url" || typeof candidate.id !== "string" || candidate.id === "") {
    return { source: "url", name, url: candidate.url, type };
  }
  return { id: candidate.id, name, url: candidate.url, type };
}
