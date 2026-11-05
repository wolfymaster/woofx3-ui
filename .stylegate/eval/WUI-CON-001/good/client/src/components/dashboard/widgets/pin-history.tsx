import { useEffect, useRef, useState } from "react";
import { useEngineGateway } from "@/engine/context";
import type { PinRecord } from "@/engine/types";

export function usePinHistory(open: boolean): PinRecord[] {
  const loadHistory = useEngineGateway().pins.useHistoryRequest();
  const [history, setHistory] = useState<PinRecord[]>([]);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const controller = new AbortController();
    void loadHistory({ signal: controller.signal }).then((rows) => {
      loadedFor.current = rows[0]?.id ?? null;
      setHistory(rows);
    });
    return () => controller.abort();
  }, [open, loadHistory]);

  return history;
}
