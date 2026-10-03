/**
 * A creator's woofx3 username. It is shown as `woofx3.tv/<username>`, and
 * their managed engine is served on the subdomain of the same name,
 * `<username>.woofx3.tv`.
 *
 * The maintenance API is the authority on whether a slug may be used — it
 * owns the reserved words and knows what is taken. These are only the format
 * rules, kept here so the field can answer while the user is still typing
 * instead of waiting for a round trip per keystroke, and mirrored from
 * `validateSlug` in the maintenance API's `src/engines/slug.ts`.
 */

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

export const ENGINE_DOMAIN = "woofx3.tv";

/** What the username field shows in front of the name. */
export const USERNAME_PREFIX = `${ENGINE_DOMAIN}/`;

export const SLUG_FORMAT_HINT =
  "3–30 lowercase letters, digits or single hyphens, starting and ending with a letter or digit";

/** The public address a slug would be served at. */
export function engineHostname(slug: string): string {
  return `${slug}.${ENGINE_DOMAIN}`;
}

/** A username as people see it: `woofx3.tv/<username>`. */
export function usernameAddress(slug: string): string {
  return `${USERNAME_PREFIX}${slug}`;
}

/**
 * A name turned into a candidate slug: lowercased, anything else replaced by
 * a hyphen, runs collapsed and the ends trimmed. Returns "" when nothing
 * usable survives, which the field treats as "no suggestion" rather than an
 * error the user has to clear.
 */
export function suggestSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30)
    // Slicing can leave a trailing hyphen, which the pattern rejects.
    .replace(/-$/, "");
  return SLUG_PATTERN.test(slug) ? slug : "";
}

/** The reason this slug cannot be used at all, or null when it is worth asking the server about. */
export function slugFormatError(slug: string): string | null {
  if (slug.length === 0) {
    return null;
  }
  if (!SLUG_PATTERN.test(slug) || slug.includes("--")) {
    return SLUG_FORMAT_HINT;
  }
  return null;
}
