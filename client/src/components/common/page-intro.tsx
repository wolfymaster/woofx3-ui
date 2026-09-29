import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Lightbulb, X } from "lucide-react";
import { HelpTip } from "@/components/common/help-tip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PAGE_INTROS, type PageIntroId } from "@/lib/page-intros";

interface PageIntroProps {
  introId: PageIntroId;
  /** Starts the page's main task, e.g. opens the create flow. */
  onTry: () => void;
}

/**
 * A short explanation of a page, shown until the user closes it or tries the
 * page's main task. Nothing renders while dismissals load, so the card never
 * flashes for someone who already closed it.
 */
export function PageIntro({ introId, onTry }: PageIntroProps) {
  const dismissed = useQuery(api.pageIntros.listDismissed);
  const dismiss = useMutation(api.pageIntros.dismiss).withOptimisticUpdate((store, { introId: closed }) => {
    const current = store.getQuery(api.pageIntros.listDismissed, {});
    if (current !== undefined && !current.includes(closed)) {
      store.setQuery(api.pageIntros.listDismissed, {}, [...current, closed]);
    }
  });

  if (dismissed === undefined || dismissed.includes(introId)) {
    return null;
  }

  const intro = PAGE_INTROS[introId];

  return (
    <Card className="mb-6 border-primary/30 bg-primary/5" data-testid={`page-intro-${introId}`}>
      <CardContent className="flex gap-3 p-4">
        <Lightbulb className="h-5 w-5 shrink-0 text-primary mt-0.5" />
        <div className="flex-1 space-y-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <p className="font-medium">{intro.title}</p>
              <HelpTip term={intro.term} />
            </div>
            <p className="text-sm text-muted-foreground">{intro.body}</p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              void dismiss({ introId });
              onTry();
            }}
            data-testid={`button-page-intro-try-${introId}`}
          >
            {intro.tryLabel}
          </Button>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label="Dismiss"
              onClick={() => void dismiss({ introId })}
              data-testid={`button-page-intro-dismiss-${introId}`}
            >
              <X className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Dismiss</TooltipContent>
        </Tooltip>
      </CardContent>
    </Card>
  );
}
