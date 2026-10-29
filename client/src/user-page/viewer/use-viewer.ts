import { api } from "@convex/_generated/api";
import type { RefreshRolesResult } from "@convex/viewerRoles";
import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useClock } from "../clock";
import { ROLE_REFRESH_RETRY, roleRefreshRetryDelay, roleRefreshStep } from "./role-refresh";
import { type SignInFailure, type SignInOutcome, signInStartUrl, type ViewerStorage } from "./sign-in";

/** What the viewer hooks need from outside React, built once by main.tsx. */
export interface ViewerEnvironment {
  storage: ViewerStorage;
  /** The user-pages origin (viewer/config.ts). */
  origin: string;
  /** The page build's base, "/u/". */
  pageBase: string;
  /** This page's URL, without any sign-in result. A sign-in returns here. */
  pageHref: string;
  /** A sign-in can return only to `origin`, so it can start only from a page on it. */
  onUserPagesOrigin: boolean;
  /** The sign-in the page URL carried when it loaded, already being finished; null when there was none. */
  pendingSignIn: Promise<SignInOutcome | null> | null;
  navigate: (url: string) => void;
  newNonce: () => string;
  /** In [0, 1), for retry jitter. */
  random: () => number;
}

export interface ViewerProfile {
  displayName: string;
  avatarUrl: string | null;
}

export type ViewerSession =
  | { status: "signed_out" }
  /** A returning sign-in is being exchanged for a session. */
  | { status: "signing_in" }
  /** `profile` is undefined until it loads. */
  | { status: "signed_in"; sessionToken: string; profile: ViewerProfile | undefined };

export interface ViewerSessionControls {
  session: ViewerSession;
  /** Why the last sign-in did not finish, until dismissed or a new sign-in starts. */
  failure: SignInFailure | null;
  dismissFailure: () => void;
  signIn: () => void;
  signOut: () => void;
  /** Forgets a session the server says has ended. */
  forgetSession: () => void;
}

/** The viewer signed in on this origin, and the actions that change it. */
export function useViewerSession(env: ViewerEnvironment): ViewerSessionControls {
  const [sessionToken, setSessionToken] = useState<string | null>(() => env.storage.sessionToken());
  const [signingIn, setSigningIn] = useState(env.pendingSignIn !== null);
  const [failure, setFailure] = useState<SignInFailure | null>(null);
  const signOutMutation = useMutation(api.viewerSession.signOut);
  const profile = useQuery(api.viewerSession.me, sessionToken === null ? "skip" : { sessionToken });

  useEffect(() => {
    if (env.pendingSignIn === null) {
      return;
    }
    let current = true;
    void env.pendingSignIn.then((outcome) => {
      if (!current) {
        return;
      }
      setSigningIn(false);
      if (outcome?.kind === "signed_in") {
        setSessionToken(outcome.sessionToken);
      } else if (outcome?.kind === "failed") {
        setFailure(outcome.failure);
      }
    });
    return () => {
      current = false;
    };
  }, [env.pendingSignIn]);

  const forgetSession = useCallback(() => {
    env.storage.clearSessionToken();
    setSessionToken(null);
  }, [env.storage]);

  useEffect(() => {
    if (sessionToken !== null && profile === null) {
      forgetSession();
    }
  }, [forgetSession, profile, sessionToken]);

  const signIn = useCallback(() => {
    const nonce = env.newNonce();
    env.storage.putNonce(nonce);
    setFailure(null);
    env.navigate(signInStartUrl(env.origin, env.pageBase, env.pageHref, nonce));
  }, [env]);

  const signOut = useCallback(() => {
    if (sessionToken === null) {
      return;
    }
    forgetSession();
    // The token is already gone from this browser, so a failed call leaves
    // only a session row nobody holds the token for, deleted at its expiry.
    signOutMutation({ sessionToken }).catch((error: unknown) => {
      console.warn("Could not end the viewer session on the server", error);
    });
  }, [forgetSession, sessionToken, signOutMutation]);

  let session: ViewerSession;
  if (sessionToken !== null) {
    session = { status: "signed_in", sessionToken, profile: profile ?? undefined };
  } else if (signingIn) {
    session = { status: "signing_in" };
  } else {
    session = { status: "signed_out" };
  }
  return { session, failure, dismissFailure: () => setFailure(null), signIn, signOut, forgetSession };
}

/**
 * Where the page is with the viewer's roles while the page read reports them
 * stale: `idle` when it does not, `checking` on the first ask, `retrying`
 * after Twitch or the rate limit said not now, `reauth` when only a new
 * sign-in helps, `stopped` when nothing the viewer does here helps.
 */
export type RoleCheck = "idle" | "checking" | "retrying" | "reauth" | "stopped";

/**
 * Asks `viewerRoles.refresh` whenever the page read reports `rolesStale` for
 * a signed-in viewer. A stored answer re-runs the page read, which clears
 * `rolesStale` and ends the loop; anything else retries with backoff or stops.
 */
export function useRoleCheck(
  env: ViewerEnvironment,
  slug: string,
  sessionToken: string | null,
  rolesStale: boolean,
  onSignedOut: () => void
): RoleCheck {
  const refresh = useAction(api.viewerRoles.refresh);
  const clock = useClock();
  const [check, setCheck] = useState<RoleCheck>("idle");
  const [retryTick, setRetryTick] = useState(0);
  const attempts = useRef(0);
  const halted = useRef<{ sessionToken: string; check: "reauth" | "stopped" } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryTick only re-runs the effect for the next attempt.
  useEffect(() => {
    if (!rolesStale || sessionToken === null) {
      attempts.current = 0;
      setCheck("idle");
      return;
    }
    if (halted.current?.sessionToken === sessionToken) {
      setCheck(halted.current.check);
      return;
    }
    let current = true;
    let cancelRetry = () => {};
    const retryLater = () => {
      const delay = roleRefreshRetryDelay(attempts.current, ROLE_REFRESH_RETRY, env.random);
      attempts.current += 1;
      cancelRetry = clock.after(delay, () => setRetryTick((tick) => tick + 1));
    };
    setCheck(attempts.current === 0 ? "checking" : "retrying");
    refresh({ sessionToken, slug })
      .catch((error: unknown): "error" => {
        console.warn("Could not refresh the viewer's roles", error);
        return "error";
      })
      .then((result: RefreshRolesResult | "error") => {
        if (!current) {
          return;
        }
        switch (roleRefreshStep(result)) {
          case "settled":
            // The page read re-runs and clears rolesStale, which cancels
            // this; the retry only matters if it somehow does not.
            attempts.current = 0;
            retryLater();
            return;
          case "retry":
            setCheck("retrying");
            retryLater();
            return;
          case "reauth":
            halted.current = { sessionToken, check: "reauth" };
            setCheck("reauth");
            return;
          case "stop":
            halted.current = { sessionToken, check: "stopped" };
            setCheck("stopped");
            return;
          case "signed_out":
            onSignedOut();
            return;
        }
      });
    return () => {
      current = false;
      cancelRetry();
    };
  }, [clock, env.random, onSignedOut, refresh, retryTick, rolesStale, sessionToken, slug]);

  return check;
}
