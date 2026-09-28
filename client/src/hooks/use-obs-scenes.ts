import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ObsSceneListing } from "@convex/lib/obsScenes";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * How long a listing is reused before the next field to mount asks again. A form
 * holding two OBS fields, or a step opened twice in a row, then costs one engine
 * round trip; a scene added in OBS shows up within this long, or at once with
 * the picker's refresh button.
 */
const OBS_LISTING_TTL_MS = 30_000;

interface ObsListingEntry {
  listing: ObsSceneListing | null;
  fetchedAt: number;
  loading: boolean;
  /** Set when the request itself failed, e.g. the caller lost access to the instance. */
  error: string | null;
}

const EMPTY_ENTRY: ObsListingEntry = { listing: null, fetchedAt: 0, loading: false, error: null };

// Shared across every picker on the page so they agree on one listing per instance.
const entries = new Map<string, ObsListingEntry>();
const listeners = new Map<string, Set<() => void>>();

function setEntry(instanceId: string, entry: ObsListingEntry): void {
  entries.set(instanceId, entry);
  listeners.get(instanceId)?.forEach((listener) => {
    listener();
  });
}

function subscribe(instanceId: string, listener: () => void): () => void {
  let set = listeners.get(instanceId);
  if (!set) {
    set = new Set();
    listeners.set(instanceId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(instanceId);
    }
  };
}

/**
 * The message for a failed request. `listScenes` throws its expected failures as
 * ConvexError; anything else reaches production as a masked "Server Error", so
 * it gets a short message of its own rather than that.
 */
function requestErrorMessage(err: unknown): string {
  if (err instanceof ConvexError) {
    const data = err.data as { message?: unknown } | undefined;
    if (typeof data?.message === "string") {
      return data.message;
    }
  }
  return "the request failed";
}

function load(instanceId: string, fetchListing: () => Promise<ObsSceneListing>, force: boolean): void {
  const current = entries.get(instanceId) ?? EMPTY_ENTRY;
  if (current.loading) {
    return;
  }
  const fresh = current.listing !== null && Date.now() - current.fetchedAt < OBS_LISTING_TTL_MS;
  if (fresh && !force) {
    return;
  }
  setEntry(instanceId, { ...current, loading: true, error: null });
  fetchListing().then(
    (listing) => {
      setEntry(instanceId, { listing, fetchedAt: Date.now(), loading: false, error: null });
    },
    (err: unknown) => {
      setEntry(instanceId, { ...current, loading: false, error: requestErrorMessage(err) });
    }
  );
}

export interface ObsScenesState extends ObsListingEntry {
  /** Ask OBS again now, ignoring the cached listing. */
  refresh: () => void;
  /** Ask OBS again only when the cached listing is older than the TTL. */
  revalidate: () => void;
}

/** OBS's scenes for the instance, as the engine last reported them. */
export function useObsScenes(instanceId: Id<"instances"> | undefined): ObsScenesState {
  const listScenes = useAction(api.obsScenes.listScenes);
  const key = instanceId ?? "";

  const entry = useSyncExternalStore(
    useCallback((listener: () => void) => subscribe(key, listener), [key]),
    () => entries.get(key) ?? EMPTY_ENTRY
  );

  const fetchListing = useCallback(() => {
    if (!instanceId) {
      throw new Error("useObsScenes: fetch without an instance");
    }
    return listScenes({ instanceId });
  }, [instanceId, listScenes]);

  const revalidate = useCallback(() => {
    if (instanceId) {
      load(instanceId, fetchListing, false);
    }
  }, [instanceId, fetchListing]);

  useEffect(() => {
    revalidate();
  }, [revalidate]);

  const refresh = useCallback(() => {
    if (instanceId) {
      load(instanceId, fetchListing, true);
    }
  }, [instanceId, fetchListing]);

  return { ...entry, refresh, revalidate };
}
