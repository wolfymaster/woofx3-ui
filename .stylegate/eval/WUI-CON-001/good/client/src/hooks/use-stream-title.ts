import { useEffect, useState } from "react";
import { useEngineGateway } from "@/engine/context";

export function useStreamTitleDraft(saved: string): [string, (next: string) => void] {
  const [draft, setDraft] = useState(saved);
  const [dirty, setDirty] = useState(false);
  const save = useEngineGateway().streamInfo.useSaveTitle();

  useEffect(() => {
    if (!dirty) {
      setDraft(saved);
    }
  }, [saved, dirty]);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    const timer = setTimeout(() => {
      void save(draft).then(() => setDirty(false));
    }, 800);
    return () => clearTimeout(timer);
  }, [draft, dirty, save]);

  return [draft, (next) => {
    setDraft(next);
    setDirty(true);
  }];
}
