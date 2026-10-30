import { type Infer, v } from "convex/values";
import { USER_PAGE_LIMITS } from "./limits";
import type { ProblemReport } from "./problems";

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Section, widget and form field ids: chosen by the editor, unique within their scope, never shown. */
export function checkId(id: string, report: ProblemReport): void {
  if (id.length === 0 || id.length > USER_PAGE_LIMITS.idLength || !ID_PATTERN.test(id)) {
    report.add(`Id must be 1 to ${USER_PAGE_LIMITS.idLength} letters, digits, "-" or "_"`);
  }
}

/** Reports every id in `ids` that appears more than once, at the index of each repeat. */
export function checkUniqueIds(ids: readonly string[], report: ProblemReport): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      report.item(index).field("id").add(`Id "${id}" is used more than once`);
    }
    seen.add(id);
  });
}

/**
 * A link a visitor follows. Only http and https: anything else (`javascript:`,
 * `data:`) would run or load something on the page's own origin.
 */
export function checkLinkUrl(url: string, report: ProblemReport): void {
  checkUrl(url, report, ["http:", "https:"]);
}

/** An image the page loads. https only, so a published page never mixes in insecure content. */
export function checkImageUrl(url: string, report: ProblemReport): void {
  checkUrl(url, report, ["https:"]);
}

function checkUrl(url: string, report: ProblemReport, protocols: readonly string[]): void {
  if (url.length > USER_PAGE_LIMITS.urlLength) {
    report.add(`URL is longer than ${USER_PAGE_LIMITS.urlLength} characters`);
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    report.add("Not a valid URL");
    return;
  }
  if (!protocols.includes(parsed.protocol)) {
    report.add(`URL must start with ${protocols.map((protocol) => `${protocol}//`).join(" or ")}`);
  }
}

/**
 * Where an image comes from. A union of one today so an uploaded asset can be
 * added as another kind without rewriting stored pages.
 */
export const pageImageValidator = v.union(v.object({ kind: v.literal("url"), url: v.string() }));

export type PageImage = Infer<typeof pageImageValidator>;

export function checkImage(image: PageImage, report: ProblemReport): void {
  switch (image.kind) {
    case "url":
      checkImageUrl(image.url, report.field("url"));
      return;
  }
}
