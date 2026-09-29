import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";

type HelpTipProps = {
  className?: string;
  align?: "start" | "center" | "end";
} & (
  | {
      /** Explains a glossary term; `children` add context specific to this spot. */
      term: GlossaryKey;
      children?: ReactNode;
    }
  | {
      /** What is being explained, for the button's accessible name. */
      label: string;
      children: ReactNode;
    }
);

/** Element id of a term's entry on the Learning page. */
export function glossaryAnchor(term: GlossaryKey): string {
  return `term-${term}`;
}

/**
 * An info icon that opens an explanation. A popover rather than a hover
 * tooltip, so it opens with a tap on touch screens.
 */
export function HelpTip(props: HelpTipProps) {
  const term = "term" in props ? props.term : null;
  const entry = term ? GLOSSARY[term] : null;
  const label = entry ? entry.term : "label" in props ? props.label : "";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            props.className
          )}
          aria-label={`About ${label}`}
          data-testid={term ? `help-tip-${term}` : undefined}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-sm text-sm space-y-2" align={props.align ?? "start"}>
        {entry && (
          <>
            <p className="font-medium">{entry.term}</p>
            <p className="text-muted-foreground">{entry.definition}</p>
          </>
        )}
        {props.children && <div className="text-muted-foreground space-y-2">{props.children}</div>}
        {term && (
          <Link
            href={`/help/learning#${glossaryAnchor(term)}`}
            className="inline-block text-xs font-medium text-primary hover:underline"
          >
            More in Learning
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}
