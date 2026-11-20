import type { CommandResult } from "@woofx3/scene/editor";
import { useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

/**
 * Where a composition editor's refusals surface: a command the editor will not
 * run (a locked layer, a size that is not positive) answers with a reason the
 * user has to see, because the gesture or field that sent it already moved on.
 */
export function useRefusedToast(): (result: CommandResult) => void {
  const { toast } = useToast();
  return useCallback(
    (result: CommandResult) => {
      if (!result.ok) {
        toast({ title: "This change couldn't be made", description: result.detail, variant: "destructive" });
      }
    },
    [toast]
  );
}
