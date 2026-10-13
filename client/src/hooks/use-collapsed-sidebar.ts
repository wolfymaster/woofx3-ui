import { useEffect } from "react";
import { $sidebarCollapsed } from "@/lib/stores";

/**
 * Collapses the section sidebar while the calling page is open, for editors that need
 * the width. A sidebar this collapsed is expanded again when the page closes; one that
 * was already collapsed is left as it was.
 */
export function useCollapsedSidebar(): void {
  useEffect(() => {
    if ($sidebarCollapsed.get()) {
      return;
    }
    $sidebarCollapsed.set(true);
    return () => {
      $sidebarCollapsed.set(false);
    };
  }, []);
}
