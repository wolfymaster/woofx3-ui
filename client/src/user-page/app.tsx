import { api } from "@convex/_generated/api";
import type { PublicPageLookup } from "@shared/user-pages";
import { useAction, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { documentTitle, UserPageView } from "./page-view";

/** The whole user page app for one path. A path that names no slug is not found without asking Convex. */
export function UserPageApp({ slug }: { slug: string | null }) {
  if (slug === null) {
    return <UserPageScreen lookup={{ kind: "unavailable" }} claimable={false} />;
  }
  return <UserPageRoute slug={slug} />;
}

function UserPageRoute({ slug }: { slug: string }) {
  const lookup = useQuery(api.userPagesPublic.bySlug, { slug });
  const claimable = useClaimable(slug, lookup?.kind === "unclaimed");
  return <UserPageScreen lookup={lookup} claimable={claimable} />;
}

function UserPageScreen({ lookup, claimable }: { lookup: PublicPageLookup | undefined; claimable: boolean }) {
  useEffect(() => {
    document.title = documentTitle(lookup);
  }, [lookup]);
  return <UserPageView lookup={lookup} claimable={claimable} />;
}

/**
 * Whether `slug` can still be claimed, asked once it is known to be
 * unclaimed. False until the answer arrives, and false if the check fails:
 * the invitation is an extra, and without it the visitor still gets the
 * plain not-found page.
 */
function useClaimable(slug: string, unclaimed: boolean): boolean {
  const checkClaimable = useAction(api.userPagesPublic.claimable);
  const [claimable, setClaimable] = useState(false);
  useEffect(() => {
    setClaimable(false);
    if (!unclaimed) {
      return;
    }
    let current = true;
    checkClaimable({ slug })
      .then((answer) => {
        if (current) {
          setClaimable(answer.claimable);
        }
      })
      .catch((error: unknown) => {
        console.warn("Could not check whether this page can be claimed", error);
      });
    return () => {
      current = false;
    };
  }, [checkClaimable, slug, unclaimed]);
  return claimable;
}
