/**
 * The slug a user page path names: `<base><slug>`, with or without a trailing
 * slash. Null for the bare base, a deeper path, or a slug that is not valid
 * percent-encoding, all of which show the not-found page. `base` is the page
 * build's base (`import.meta.env.BASE_URL`, "/u/").
 */
export function slugFromPath(pathname: string, base: string): string | null {
  if (!pathname.startsWith(base)) {
    return null;
  }
  const rest = pathname.slice(base.length).replace(/\/$/, "");
  if (rest === "" || rest.includes("/")) {
    return null;
  }
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}
