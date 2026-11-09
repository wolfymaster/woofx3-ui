import { Lightbulb, X } from "lucide-react";
import { HelpTip } from "@/components/common/help-tip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDismissedPageIntros, useDismissPageIntroRequest } from "@/engine/hooks/use-page-intros";
import { useLogger } from "@/lib/logger-context";
import { PAGE_INTROS, type PageIntroId } from "@/lib/page-intros";

interface PageIntroProps {
  introId: PageIntroId;
}

/**
 * A short explanation of a page, shown until the user closes it. It has no button
 * of its own: the page's primary action sits right below it, and a second button
 * for the same task only asks which one to press. Nothing renders while dismissals
 * load, so the card never flashes for someone who already closed it.
 */
export function PageIntro({ introId }: PageIntroProps) {
  const logger = useLogger();
  const dismissed = useDismissedPageIntros();
  const dismissIntro = useDismissPageIntroRequest();
  const dismiss = ({ introId: closed }: { introId: PageIntroId }) =>
    dismissIntro(closed).catch((error: unknown) => {
      logger.error("dismissing a page intro failed", { error });
    });

  if (dismissed === undefined || dismissed.includes(introId)) {
    return null;
  }

  const intro = PAGE_INTROS[introId];

  return (
    <Card className="mb-6 border-primary/30 bg-primary/5" data-testid={`page-intro-${introId}`}>
      <CardContent className="flex gap-3 p-4">
        <Lightbulb className="h-5 w-5 shrink-0 text-primary mt-0.5" />
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-1.5">
            <p className="font-medium">{intro.title}</p>
            <HelpTip term={intro.term} />
          </div>
          <p className="text-sm text-muted-foreground">{intro.body}</p>
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
