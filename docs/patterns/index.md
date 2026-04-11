# Patterns & design notes

Use this section to record decisions that are easy to lose in chat or PR threads: auth flows, Convex boundaries, instance vs application IDs, transport usage, and UI conventions.

For a **tour of screens and data paths** (Convex vs transport vs stubs), see **[UI areas](/ui/overview)**.

## Suggested format for new pages

- **Context** — what problem or area this covers  
- **Decision** — what we chose  
- **Consequences** — tradeoffs and what to avoid  

Add new files under `docs/patterns/` and link them from the sidebar in `.vitepress/config.mts`.

## Related sources in-repo

- `CLAUDE.md` — high-level architecture and rules for this repository  
- `convex/_generated/ai/guidelines.md` — Convex patterns  
