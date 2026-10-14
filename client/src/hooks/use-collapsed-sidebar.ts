import { useEffect } from "react";
import { $sidebarCollapsedOverride } from "@/lib/stores";

/**
 * Collapses the section sidebar while the calling page is open, for editors that need
 * the width. The collapse is an override, never the saved preference, so the sidebar
 * shows as the user left it once the page closes, however it closes.
 */
export function useCollapsedSidebar(): void {
  useEffect(() => {
    $sidebarCollapsedOverride.set(true);
    return () => {
      $sidebarCollapsedOverride.set(null);
    };
  }, []);
}
