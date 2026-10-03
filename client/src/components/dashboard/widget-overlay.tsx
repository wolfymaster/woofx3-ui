import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface WidgetOverlayProps {
  /** The trigger's text, e.g. "History · 4". Carries any count, so the list is never out of sight entirely. */
  trigger: ReactNode;
  title: string;
  description?: string;
  testId: string;
  children: ReactNode;
}

/**
 * Secondary content of a dashboard widget (a history, a queue, a full list),
 * opened over the dashboard instead of expanded inside the widget. A widget
 * keeps one height for as long as it is on screen, because its zone has a
 * fixed size and an expanding section would push the rest of the widget out
 * of view. See docs/patterns/dashboard-widgets.md.
 */
export function WidgetOverlay({ trigger, title, description, testId, children }: WidgetOverlayProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1 text-[10px] uppercase tabular-nums tracking-wider text-muted-foreground hover:text-foreground"
        data-testid={`button-open-${testId}`}
      >
        {trigger}
        <ChevronRight className="ml-auto h-3 w-3" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col" data-testid={`overlay-${testId}`}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}
