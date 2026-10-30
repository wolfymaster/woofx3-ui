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
} as const;
