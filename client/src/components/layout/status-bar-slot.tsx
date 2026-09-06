import { createContext, type ReactNode, useContext, useState } from "react";
import { createPortal } from "react-dom";

// Lets a page render controls into the persistent bottom status bar's center
// (e.g. dashboard page tabs) without BroadcastShell needing to know about
// per-page state. StatusBarCenterMount renders the DOM node once, inside
// StatusBar; any page can portal into it via StatusBarCenterPortal, and the
// content disappears automatically when that page unmounts.

const StatusBarSlotContext = createContext<{
  node: HTMLDivElement | null;
  setNode: (node: HTMLDivElement | null) => void;
} | null>(null);

export function StatusBarSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  return <StatusBarSlotContext.Provider value={{ node, setNode }}>{children}</StatusBarSlotContext.Provider>;
}

export function StatusBarCenterMount({ className }: { className?: string }) {
  const ctx = useContext(StatusBarSlotContext);
  return <div ref={ctx?.setNode} className={className} />;
}

export function StatusBarCenterPortal({ children }: { children: ReactNode }) {
  const ctx = useContext(StatusBarSlotContext);
  if (!ctx?.node) {
    return null;
  }
  return createPortal(children, ctx.node);
}
