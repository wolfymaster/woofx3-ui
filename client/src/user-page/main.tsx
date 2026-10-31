import { api } from "@convex/_generated/api";
import { generateOpaqueToken } from "@convex/lib/oauthHandoff";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { UserPageApp } from "./app";
import { slugFromPath } from "./slug";
import { turnstileSiteKey, userPagesOrigin } from "./viewer/config";
import { browserViewerStorage, finishSignIn, readSignInReturn } from "./viewer/sign-in";
import type { ViewerEnvironment } from "./viewer/use-viewer";
import type { FormEnvironment } from "./widgets/form-environment";
import { formSubmitUrl, postFormSubmission } from "./widgets/form-submit";
import { preloadMarkdown } from "./widgets/text-widget";
import { loadTurnstileScript } from "./widgets/turnstile";
import "./styles.css";

// No Convex Auth: a viewer signs in with a session token of their own
// (viewer/sign-in.ts), which page functions take as an argument.
const convexUrl: unknown = import.meta.env.VITE_CONVEX_URL;
if (typeof convexUrl !== "string" || convexUrl === "") {
  throw new Error("VITE_CONVEX_URL must be set to build the user page");
}
const origin = userPagesOrigin(import.meta.env.VITE_USER_PAGES_BASE_URL);
const siteKey = turnstileSiteKey(import.meta.env.VITE_TURNSTILE_SITE_KEY);
const root = document.getElementById("root");
if (root === null) {
  throw new Error("The user page's HTML has no #root element");
}

/** Browser storage access throws where the site's storage is blocked; the page then keeps nothing. */
function storageOrNull(pick: () => Storage): Storage | null {
  try {
    return pick();
  } catch (error: unknown) {
    console.warn("Browser storage is unavailable; sign-in will not be remembered", error);
    return null;
  }
}

const client = new ConvexReactClient(convexUrl);
const storage = browserViewerStorage(
  storageOrNull(() => window.sessionStorage),
  storageOrNull(() => window.localStorage)
);

// Take any sign-in result off the address bar before anything renders, so
// the one-time code is never left in history or a copied link.
const { signInReturn, cleanHref } = readSignInReturn(window.location.href);
if (signInReturn.kind !== "none") {
  window.history.replaceState(window.history.state, "", cleanHref);
}
const viewerEnv: ViewerEnvironment = {
  storage,
  origin,
  pageBase: import.meta.env.BASE_URL,
  pageHref: cleanHref,
  onUserPagesOrigin: window.location.origin === origin,
  pendingSignIn:
    signInReturn.kind === "none"
      ? null
      : finishSignIn(signInReturn, storage, (args) => client.action(api.viewerSession.exchangeHandoff, args)),
  navigate: (url) => window.location.assign(url),
  newNonce: generateOpaqueToken,
  random: Math.random,
};

const formSubmitAddress = formSubmitUrl(origin, import.meta.env.BASE_URL);
const formEnv: FormEnvironment = {
  submit: (request) => postFormSubmission(formSubmitAddress, request, window.fetch.bind(window)),
  turnstileSiteKey: siteKey,
  loadTurnstile: loadTurnstileScript,
  newIdempotencyKey: generateOpaqueToken,
  reload: () => window.location.reload(),
};

preloadMarkdown();
const slug = slugFromPath(window.location.pathname, import.meta.env.BASE_URL);
createRoot(root).render(
  <StrictMode>
    <ConvexProvider client={client}>
      <UserPageApp slug={slug} viewerEnv={viewerEnv} formEnv={formEnv} />
    </ConvexProvider>
  </StrictMode>
);
