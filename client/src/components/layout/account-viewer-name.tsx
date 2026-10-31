import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { ViewerNameProvider } from "@/lib/viewer-name";

/** The signed-in account's name, or its email when it has none, as the viewer's name. */
export function AccountViewerName({ children }: { children: ReactNode }) {
  const me = useQuery(api.users.getMe);
  const name = me === undefined ? undefined : (me?.name ?? me?.email ?? "");
  return <ViewerNameProvider name={name}>{children}</ViewerNameProvider>;
}
