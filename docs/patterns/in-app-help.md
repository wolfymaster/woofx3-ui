# In-app help

## Context

woofx3 uses words a new streamer has not met in this sense: workflow, trigger, module, browser source, engine. Explanations need to read the same everywhere, work on a phone, and not get in the way of someone who already knows.

## Decision

- **Glossary** — `client/src/lib/glossary.ts` holds one entry per term: a short definition written for a streamer, a category, and optionally the page where the thing lives. Every explanation of a term comes from here. `/help/learning` lists the whole glossary, grouped by category, with an anchor per term.
- **`HelpTip`** — `client/src/components/common/help-tip.tsx` is an info icon that opens a popover. Pass `term` for a glossary entry, with `children` for context specific to that spot (for example, what to type into a URL field). Pass `label` and `children` for a one-off explanation that isn't a glossary term; `ConfigFieldLabel` uses this form for field hints. A term's popover links to its Learning entry.
  - It is a popover, not a hover tooltip, so a tap opens it on touch screens.
- **Tooltips on icon buttons** — icon-only controls use the shadcn `Tooltip` plus an `aria-label` with the same text. Native `title=` is kept only where it shows the full value of truncated text, on chart marks, and on `<iframe>`.
- **First-visit intros** — `PageIntro` (`client/src/components/common/page-intro.tsx`) shows a two-sentence card with a "try it" button at the top of Workflows, Scenes and Modules. Content lives in `client/src/lib/page-intros.ts`. Closing the card, or pressing its button, records a row in `pageIntroDismissals` (`convex/pageIntros.ts`), per user rather than per instance, so the card never returns on another device or account.

## Consequences

- Adding a term: add a `GLOSSARY` entry, then use `<HelpTip term="…" />`. The Learning page picks it up.
- Adding an intro: add its id to `pageIntroIdValidator` in `convex/schema.ts` and its content to `PAGE_INTROS`; the two must list the same ids.
- Don't write a term's definition inline in a component. If a spot needs more than the glossary says, add it as `children`.
