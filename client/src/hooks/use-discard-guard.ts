import { useCallback, useState } from "react";

export interface DiscardGuard {
  /** Runs `go` at once when nothing is unsaved; otherwise holds it until `discard`. */
  leaveTo: (go: () => void) => void;
  /** Whether a departure is waiting for the user to confirm throwing the edits away. */
  isAsking: boolean;
  /** Runs the held departure. */
  discard: () => void;
  /** Drops the held departure: the user chose to keep editing. */
  keepEditing: () => void;
}

/** Asks before a departure throws away unsaved edits. */
export function useDiscardGuard(isDirty: boolean): DiscardGuard {
  // A function is state here, so it is wrapped to keep setState from calling it.
  const [pending, setPending] = useState<{ go: () => void } | null>(null);
  const leaveTo = useCallback(
    (go: () => void) => {
      if (isDirty) {
        setPending({ go });
        return;
      }
      go();
    },
    [isDirty]
  );
  const discard = useCallback(() => pending?.go(), [pending]);
  const keepEditing = useCallback(() => setPending(null), []);
  return { leaveTo, isAsking: pending !== null, discard, keepEditing };
}
