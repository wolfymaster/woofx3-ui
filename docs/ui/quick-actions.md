# Quick actions

**Opened with:** ⌘K / Ctrl+K anywhere in the shell, or the header's *Quick actions* button  
**Primary files:** `client/src/components/command-palette/`, ranking in `client/src/lib/command-palette.ts`

## Purpose

One keyboard-first way to reach every page, find any item on the instance by name, and
run the things a streamer does mid-stream without leaving the page they are on. Anything
a power user repeats should be a few keystrokes from ⌘K.

## What it holds

| Source | File | Entries |
|--------|------|---------|
| Navigation | `navigation-commands.ts` | Every destination in `nav-config.ts` (read from it, not listed again), plus Command groups and the *Create* entries: new workflow, command, command group, module upload, asset upload, teammate invite |
| Items | `use-item-commands.ts` | Workflows, chat commands, command groups, counters, timers, queues, scenes, installed modules, recent stream recaps, alert sections, macros and stream-info presets |
| Actions | `use-action-commands.ts` | Clip, marker, stream title, snooze ad, skip / clear alerts; chat message, announcement, pin, shoutout; timeout, ban, unban, chat modes; theme, sidebar, command bar, rename / switch instance, copy instance id, sign out |

Items carry their own actions as `children`: enable / disable a workflow or command,
step / set / reset a counter, start / pause / add time to a timer, next / add / remove /
clear on a queue, fire a test event for each trigger in an alert section. They run the
same backend calls as the pages. Counters, timers and queues go through
`useResourceActionRunner` (`hooks/use-resource-action.ts`), the request the resource
pages send.

Macros that ask for variables, or that call a URL from the browser, stay on the macro
pad: the palette has no form for their inputs.

The palette's content mounts only while it is open, so its queries (about fifteen,
instance-scoped) run only while it is in use.

## Using it

- **Enter** runs the selected entry: an item opens its page, an action runs, and an
  entry ending in `…` opens a nested list or a text prompt.
- **Tab** (or the chevron) opens an item's actions. **Backspace** on an empty input, or
  **Esc**, goes back one level; Esc at the top closes.
- A leading **`>`** searches actions only, **`/`** pages only, **`#`** items only. A
  scoped search lists every match; an unscoped one caps each heading at five.
- An item's actions are also found from the top: *reset deaths* matches the Reset action
  under the Deaths counter, because every word of the query must appear somewhere on the
  entry (its title, subtitle, keywords or heading), in any order.
- Prompts with aliases can be filled in without opening them: *so ninja*, *title Late
  night speedruns*, *timeout ninja 10m*, *say hi chat*, *marker boss fight*.
- Entries with `confirm` (reset, clear queue, clear alerts, sign out) ask for a second
  Enter. Counter steps, timer additions and queue moves keep the palette open, so they
  can be repeated.

With nothing typed, the list opens on **On this page** (the actions of the item the
open page shows, e.g. the workflow being edited) and **Recent** (the last eight entries
chosen, kept per browser in `$paletteRecents`). The pages and actions follow. Items and
nested actions wait for a search.

## Ranking

`rankEntries` scores each entry against the query: exact title, then title prefix, then
a word start, then substring, then a tight subsequence ("nw" → *New workflow*).
Keywords count for less than the title, and subtitles less again. Headings are ordered
by their best match, so the likeliest answer is always first. It is pure and covered by
`command-palette.test.ts`.

## Adding an entry

Return a `PaletteCommand` (`types.ts`) from the source it belongs to. Its `id` must be
stable across sessions, because recents store it. Give it `keywords` for the words
people will reach for that the title lacks. An item action's run should throw on
failure and resolve to the confirmation line to toast. Resolve to nothing when the
change shows for itself.
