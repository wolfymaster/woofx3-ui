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

# Each mode has its own widget catalog

## Context

The dashboard runs in two modes: the hosted app, with Convex, and the desktop app's local mode, which reaches one engine directly and has no Convex client. Some widgets are built on data only Convex keeps (pin history, macros' remote trigger URLs). Loading one of them in local mode would throw, and `client/src/desktop/local-routes.test.ts` fails if anything local mode imports reaches Convex.

## Decision

**The dashboard takes its widgets from the catalog of the mode it runs in.** `DashboardView` (`client/src/components/dashboard/dashboard-view.tsx`) reads a `DashboardCatalog` from context (`client/src/lib/dashboard-widgets/catalog.tsx`), and each mode's dashboard route provides one:

- `client/src/pages/dashboard.tsx` provides `hostedDashboardCatalog` (`hosted-catalog.tsx`): every widget, the getting started checklist as the rail's pinned entry, and the starter packs nudge.
- `client/src/desktop/LocalDashboard.tsx` provides `localDashboardCatalog` (`local-catalog.ts`): the widgets a lone engine serves, with no pinned entry or notice.
- `gateway-widgets.ts` holds the widgets that reach the engine only through the gateway and that every gateway serves. Both catalogs list them; a widget that needs Convex, or a gateway member the direct gateway leaves unsupported, is defined in `hosted-catalog.tsx` only.

Each catalog module is imported only by its route, which is its own lazily loaded chunk, so a mode loads only the widgets it can run.

**A saved widget the catalog lacks shows a placeholder.** Layouts are shared data, and a layout saved with an account may name a hosted-only widget. The zone or rail flyout renders `UnavailableWidget` ("This widget isn't available here") and the layout keeps the widget, so it comes back in a mode that has it.

## Consequences

- A new widget goes in `gateway-widgets.ts` when it reaches only gateway members every gateway serves, and in `hosted-catalog.tsx` otherwise. Adding it to the local catalog is what makes local mode offer it.
- A hosted-only widget joins local mode by moving its data behind the gateway, then its definition into `gateway-widgets.ts`.
- A widget with a hosted-only part takes that part from the catalog that mounts it. The macro pad is defined in `gateway-widgets.ts` without remote trigger URLs; `hosted-catalog.tsx` mounts it with them (`hosted-macro-pad.tsx`), so the pad itself loads nothing from Convex.
- The picker offers only the current mode's widgets, so local mode never places a widget it cannot render.
