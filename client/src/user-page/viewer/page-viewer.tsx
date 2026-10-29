import { createContext, type ReactNode, useContext } from "react";
import type { RoleCheck, ViewerSession } from "./use-viewer";

/** What a locked section needs to know about the viewer to offer the right next step. */
export interface PageViewer {
  session: ViewerSession;
  /** False off the user-pages origin, where a sign-in could not return. */
  canSignIn: boolean;
  /** This page on the user-pages origin, where a visitor elsewhere can sign in. */
  canonicalUrl: string;
  roleCheck: RoleCheck;
  signIn: () => void;
}

const PageViewerContext = createContext<PageViewer | null>(null);

export function PageViewerProvider({ viewer, children }: { viewer: PageViewer; children: ReactNode }) {
  return <PageViewerContext.Provider value={viewer}>{children}</PageViewerContext.Provider>;
}

export function usePageViewer(): PageViewer {
  const viewer = useContext(PageViewerContext);
  if (viewer === null) {
    throw new Error("usePageViewer needs a PageViewerProvider");
  }
  return viewer;
}
