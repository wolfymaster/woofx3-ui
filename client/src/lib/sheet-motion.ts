/**
 * Timing for the app's side sheets, passed to `SheetContent`'s className. The shared
 * sheet opens in 500ms with ease-in-out, slow enough to feel like waiting on a panel
 * that was asked for; this opens in 300ms decelerating and closes in 200ms.
 */
export const SHEET_MOTION =
  "data-[state=open]:duration-300 data-[state=open]:ease-out data-[state=closed]:duration-200 data-[state=closed]:ease-in";
