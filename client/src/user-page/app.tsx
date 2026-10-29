import { api } from "@convex/_generated/api";
import type { PublicPageLookup } from "@shared/user-pages";
import { useAction, useQuery } from "convex/react";
import { type ReactNode, useEffect, useState } from "react";
import { documentTitle, UserPageView } from "./page-view";
import { PageViewerProvider } from "./viewer/page-viewer";
import { canonicalPageUrl } from "./viewer/sign-in";
import { SignInNotice } from "./viewer/sign-in-notice";
import { useRoleCheck, useViewerSession, type ViewerEnvironment } from "./viewer/use-viewer";
import { ViewerActions } from "./viewer/viewer-actions";

/** The whole user page app for one path. A path that names no slug is not found without asking Convex. */
export function UserPageApp({ slug, viewerEnv }: { slug: string | null; viewerEnv: ViewerEnvironment }) {
  if (slug === null) {
    return <UserPageScreen lookup={{ kind: "unavailable" }} claimable={false} />;
  }
  return <UserPageRoute slug={slug} viewerEnv={viewerEnv} />;
}

function UserPageRoute({ slug, viewerEnv }: { slug: string; viewerEnv: ViewerEnvironment }) {
  const viewer = useViewerSession(viewerEnv);
  const sessionToken = viewer.session.status === "signed_in" ? viewer.session.sessionToken : null;
  const lookup = useQuery(api.userPagesPublic.bySlug, sessionToken === null ? { slug } : { slug, sessionToken });
  const roles =
    lookup?.kind === "page"
      ? { rolesStale: lookup.rolesStale, rolesRenewAt: lookup.rolesRenewAt }
      : { rolesStale: false, rolesRenewAt: null };
  const roleCheck = useRoleCheck(viewerEnv, slug, sessionToken, roles, viewer.forgetSession);
  const claimable = useClaimable(slug, lookup?.kind === "unclaimed");
  return (
    <PageViewerProvider
      viewer={{
        session: viewer.session,
        canSignIn: viewerEnv.onUserPagesOrigin,
        canonicalUrl: canonicalPageUrl(viewerEnv.origin, viewerEnv.pageBase, slug),
        roleCheck,
        signIn: viewer.signIn,
      }}
    >
      <UserPageScreen
        lookup={lookup}
        claimable={claimable}
        actions={<ViewerActions onSignOut={viewer.signOut} />}
        notice={
          viewer.failure === null ? undefined : (
            <SignInNotice failure={viewer.failure} onDismiss={viewer.dismissFailure} />
          )
        }
      />
    </PageViewerProvider>
  );
}

function UserPageScreen({
  lookup,
  claimable,
  actions,
  notice,
}: {
  lookup: PublicPageLookup | undefined;
  claimable: boolean;
  actions?: ReactNode;
  notice?: ReactNode;
}) {
  useEffect(() => {
    document.title = documentTitle(lookup);
  }, [lookup]);
  return <UserPageView lookup={lookup} claimable={claimable} actions={actions} notice={notice} />;
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
