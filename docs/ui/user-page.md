# User page editor

`/stream/page` ("Your page" under Stream) is where a streamer builds the public
page their viewers see at `<page origin>/u/<slug>`. The slug is the managed
engine's name, so only an engine with one can publish; any other engine can
still build a draft. The public page itself is served by a separate page app;
this screen only edits it.

It sits under Stream rather than Admin because every member of the account may
edit the draft, and the Admin section is hidden from members. Publishing and
unpublishing are admin-only, so those two buttons are shown to members disabled,
with the reason on hover or focus.

## What can be changed

Deliberately little, so every page renders well without its owner designing it:
everything comes from the shared registry in `shared/user-pages/`.

- **Layout**: one of `PAGE_LAYOUTS`, each a fixed list of regions. Switching
  layout moves sections out of a region the new layout lacks into its first
  region, so no section is ever left where it cannot render.
- **Accent**: one of `PAGE_ACCENTS`.
- **Banner and avatar**: https image URLs.
- **Sections**: ordered, each in one region with a visibility (everyone,
  signed-in viewers, followers, subscribers, or a minimum subscriber tier). The
  editor lists sections under their region; dragging reorders within a region
  and the region select moves one to another.
- **Widgets**: added from `PAGE_WIDGETS` (the menu is built from the registry,
  never a list of its own), each with its registry `defaultConfig`. Every widget
  type has a settings form in `components/user-page/widget-config-form.tsx`; the
  switch there is exhaustive, so a new registry type does not type-check until
  it has one. Counter and timer widgets bind a resource through a picker of the
  instance's resources of the kind the registry entry binds.

## Submissions

The **Submissions** tab on the same screen lists what visitors sent through the page's forms, newest first: the status, when it was sent, who sent it (a viewer's name, or "Anonymous visitor"), the answers and, for a failed one, the reason with a **Retry** button. A note above the list says when answers are waiting because the engine can't be reached or needs an update, and when the page's forms have stopped accepting because too many are waiting. The editor stays mounted behind the tab, so unsaved edits survive a look at it.

Each form widget's settings show its **Form ID**, for the optional `form` field of the workflow trigger, which matches on it. Each question shows the reference that reads its answer in a workflow, `${trigger.data.answers.<fieldId>}`. [User pages](./user-pages.md#forms) covers delivery.

## Validation

The editor runs `checkPageContent`, the same check `userPages.saveDraft`
refuses with, on every edit. Each problem carries a path into the content
(`sections[0].widgets[2].config.links[1].url`), and each field shows the
problems at its own path (`lib/page-problems.ts`); cards count the problems
anywhere inside them. Whether a bound resource still exists is checked only by
the server; an `invalid_content` refusal's problems are shown the same way,
until the content changes.

## Saving and publishing

Saving is explicit (Save draft), not automatic. A draft is refused whole when it
has any problem, and a page mid-edit usually has one (a counter not chosen yet,
a link with no address), so autosave would either fail most of the time or need
to hold back silently. An explicit save also keeps the revision history
meaningful for `baseRevision`: each save sends the draft revision it started
from, and the server refuses with `stale_draft` when another member saved in
between. The page warns before closing the tab with unsaved changes.

The editor's state (`lib/user-page-editor.ts`) is the saved draft plus the
edits on top of it. `userPages.forEditing` is reactive: a newer draft from
someone else is taken in at once when nothing is unsaved, and otherwise only
noted, with a prompt to reload, so nobody's edits vanish.

Publish puts the saved draft live, so it waits for a save; the conditions, in
the order their reasons are shown, are in `lib/user-page-publishing.ts`.
Refusals map to messages in `lib/user-page-refusal.ts`.

"View page" opens the published page in a new tab. Its origin is
`VITE_USER_PAGE_BASE_URL`, defaulting to the production page origin
(`lib/user-page-url.ts`).

There is no in-editor preview: it would render from the page app's own
presentational components, so the two cannot drift.
