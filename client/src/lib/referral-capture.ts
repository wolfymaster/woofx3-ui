const STORAGE_KEY = "woofx3.referral";
/** Matches the server's accepted code shape closely enough to drop junk before storing it. */
const CODE_SHAPE = /^[a-z0-9]{1,64}$/;

/** Remembers the `?ref=` code on a sign-up link until the new user is signed in. */
export function rememberReferral(search: string): void {
  const code = new URLSearchParams(search).get("ref");
  if (code === null || !CODE_SHAPE.test(code)) {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Storage can be blocked; the referral is then simply not captured.
  }
}

/** The remembered code, removed so it is sent once. */
export function takeReferral(): string | null {
  try {
    const code = window.localStorage.getItem(STORAGE_KEY);
    window.localStorage.removeItem(STORAGE_KEY);
    return code;
  } catch {
    return null;
  }
}
