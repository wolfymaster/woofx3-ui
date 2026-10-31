import { createContext, type ReactNode, useContext } from "react";

// The name the viewer goes by where others can see them, such as other
// people editing the same scene. Each app root says where it comes from: the
// signed-in account, or nothing to look up on a lone computer.

/** Absent until a provider is mounted; `undefined` while the name loads. */
const ViewerNameContext = createContext<{ name: string | undefined } | null>(null);

export function ViewerNameProvider({ name, children }: { name: string | undefined; children: ReactNode }) {
  return <ViewerNameContext.Provider value={{ name }}>{children}</ViewerNameContext.Provider>;
}

/** The viewer's name, or undefined while it loads. Throws outside `ViewerNameProvider`. */
export function useViewerName(): string | undefined {
  const viewer = useContext(ViewerNameContext);
  if (viewer === null) {
    throw new Error("useViewerName: no ViewerNameProvider above this component");
  }
  return viewer.name;
}
