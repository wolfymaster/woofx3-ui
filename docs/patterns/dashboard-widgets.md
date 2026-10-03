# Dashboard widgets keep a fixed height

## Context

A dashboard widget lives in a zone of a panel (`client/src/components/dashboard/dashboard-canvas.tsx`). The zone's size comes from the panel's layout and the user's resize handles, never from the widget's content. A widget whose content grows does not get a taller zone. Its own content scrolls or overflows instead, and whatever was at the bottom of the widget is pushed out of view.

A collapsible section shows the problem. The pinned-message widget used to unfold its history under the pin box. Opening it pushed the box the user came to use off the bottom of the zone, and the widget's layout changed every time someone clicked the fold.

## Decision

**A dashboard widget has one layout for as long as it is on screen.** Nothing the user does inside it (opening a list, showing more detail, starting a task) changes how its space is divided.

- **Secondary content opens in an overlay.** A history, a queue, a full list or extra settings go in a dialog over the dashboard, as the macro pad's button editor does. `WidgetOverlay` (`client/src/components/dashboard/widget-overlay.tsx`) is the standard trigger and dialog. Its trigger is one fixed row, and it carries the count, so the hidden content never vanishes entirely (`History · 4`, `3 queued · 2m apart`).
- **No `Collapsible`, `Accordion` or "show more" inside a widget.** If a section is worth folding, it is worth an overlay.
- **Lists that belong in the widget scroll inside a fixed area.** A live event feed or a queue's line is the widget's main content. It fills the space the widget has and scrolls; it does not grow the widget.
- **Transient states take the space of what they replace.** A confirmation, a loading state or an error replaces a section in place, at about the same height, rather than being inserted above it.

## Consequences

- A widget looks the same in edit mode, where the user sizes it, as it does in use, so the size chosen is the size that works.
- Content in an overlay is one click further away. That is the trade: the widget shows what is used most, and the rest is a click away instead of a scroll.
- Widgets in the rail's flyout follow the same rule. The flyout has a fixed height too.

Widgets that follow this: `pinned` (history), `shoutout` (queue) and `moderation` (blocked terms) open their lists with `WidgetOverlay`, and `macro-pad` opens its editor as a dialog.
