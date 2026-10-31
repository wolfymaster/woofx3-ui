/**
 * How much one page may hold. A revision is one Convex document, so these
 * bound it well under the 1 MiB document limit: the worst case is
 * MAX_WIDGETS_PER_PAGE text widgets at TEXT_MAX_LENGTH characters (up to 4
 * bytes each in UTF-8), about 640 KiB, and every other widget is far smaller.
 */
export const USER_PAGE_LIMITS = {
  sections: 12,
  widgetsPerSection: 8,
  widgetsPerPage: 32,
  sectionTitleLength: 80,
  /** Ids are client-chosen, so they are kept short and plain. */
  idLength: 64,
  urlLength: 2048,
  textLength: 5000,
  labelLength: 80,
  imageAltLength: 300,
  links: 20,
  formFields: 20,
  formSelectOptions: 50,
  /** The longest answer any form field may be configured to accept. */
  formTextAnswerLength: 500,
  formTextareaAnswerLength: 5000,
  /**
   * Answers waiting to reach one page's engine. At this many its forms stop
   * accepting, so an engine that stays offline cannot grow the queue forever.
   */
  pendingSubmissionsPerPage: 1000,
  /**
   * The largest submit request, which must match the edge Worker's limit. The
   * longest answers a form can be configured to take can add up to more than
   * this, so the page checks it before sending.
   */
  formSubmissionBytes: 64 * 1024,
  /**
   * What the engine takes for a delivery's labels, title and viewer name, and
   * for the viewer's platform id; it refuses more for good. Must match
   * SUBMISSION_LIMITS in the engine's api/src/routes/user-pages.ts, as must
   * every id, count and answer limit above, which sit at or under its own.
   */
  deliveredTextLength: 255,
  deliveredPlatformUserIdLength: 100,
} as const;
