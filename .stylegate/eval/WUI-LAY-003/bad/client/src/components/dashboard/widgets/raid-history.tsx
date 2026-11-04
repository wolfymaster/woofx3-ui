import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useRaids } from "@/engine/hooks/use-raids";

export function RaidHistoryWidget() {
  const raids = useRaids();
  const [open, setOpen] = useState(false);
  const latest = raids[0];

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <p className="text-sm">{latest ? `${latest.from} raided with ${latest.viewers}` : "No raids yet"}</p>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-1 text-xs">
          <ChevronRight className="h-3 w-3" />
          History · {raids.length}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul>
            {raids.map((raid) => (
              <li key={raid.id}>{raid.from}</li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
