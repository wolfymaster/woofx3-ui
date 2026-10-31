import type { ListingCredit } from "@shared/marketplace-catalog";
import { ExternalLink, Heart } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";

interface CreditsCardProps {
  credits: ListingCredit[];
  /** Named in the heading, so the card reads as a sentence about this thing. */
  listingName: string;
}

/**
 * Who a listing was inspired by.
 *
 * A showcase, not metadata: the streamers whose ideas a module borrows are the
 * reason it exists, and the point of the card is that they are seen. So it
 * gets a real heading, avatars, and a link out to each of them — the whole
 * credit is clickable where there is somewhere to go.
 */
export function CreditsCard({ credits, listingName }: CreditsCardProps) {
  if (credits.length === 0) {
    return null;
  }

  return (
    <Card className="overflow-hidden border-amber-500/25 bg-gradient-to-br from-amber-500/[0.07] via-transparent to-transparent">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Heart className="h-3.5 w-3.5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold leading-tight">Inspired by</h3>
            <p className="text-xs text-muted-foreground">
              {listingName} exists because of {credits.length === 1 ? "this streamer" : "these streamers"}.
            </p>
          </div>
        </div>

        <ul className="grid gap-2 sm:grid-cols-2">
          {credits.map((credit) => (
            <li key={`${credit.name}-${credit.url ?? ""}`}>
              <CreditEntry credit={credit} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CreditEntry({ credit }: { credit: ListingCredit }) {
  const body = (
    <>
      <Avatar className="h-9 w-9 shrink-0 border border-amber-500/20">
        {credit.avatarUrl && <AvatarImage src={credit.avatarUrl} alt="" />}
        <AvatarFallback className="bg-amber-500/15 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
          {credit.name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-sm font-medium">
          <span className="truncate">{credit.name}</span>
          {credit.url && <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />}
        </span>
        {credit.role && (
          <span className="block text-[11px] uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80">
            {credit.role}
          </span>
        )}
        {credit.note && <span className="block text-xs text-muted-foreground line-clamp-2">{credit.note}</span>}
      </span>
    </>
  );

  const className = "flex items-start gap-3 rounded-lg border border-transparent bg-background/60 p-2.5";

  if (!credit.url) {
    return <div className={className}>{body}</div>;
  }
  return (
    <a
      href={credit.url}
      target="_blank"
      rel="noreferrer noopener"
      className={`${className} transition-colors hover:border-amber-500/30 hover:bg-background`}
    >
      {body}
    </a>
  );
}
