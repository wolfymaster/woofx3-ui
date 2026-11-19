import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

interface AdvancedDisclosureProps {
  children: ReactNode;
  testId?: string;
  /** When given, the disclosure is controlled so a phrase can open it directly. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * The single collapsed drawer of secondary settings at the bottom of an alert's editor.
 * Inline in the document: opening it grows the page, nothing floats over the sentence.
 */
export function AdvancedDisclosure({
  children,
  testId = "trigger-advanced",
  open: controlledOpen,
  onOpenChange,
}: AdvancedDisclosureProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(next);
    }
    onOpenChange?.(next);
  };
  return (
    <div className="flex flex-col gap-3 border-t pt-3" data-testid={testId}>
      <button
        type="button"
        className="flex items-center gap-1.5 self-start text-[13px] text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        data-testid="trigger-advanced-toggle"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
        Advanced
      </button>
      {open && <div className="flex flex-col gap-4">{children}</div>}
    </div>
  );
}
