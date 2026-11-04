import { WidgetOverlay } from "@/components/dashboard/widget-overlay";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useRaids } from "@/engine/hooks/use-raids";

export function RaidHistoryWidget({ editing, onCloseEditor }: { editing: boolean; onCloseEditor: () => void }) {
  const raids = useRaids();
  const latest = raids[0];

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <p className="text-sm">{latest ? `${latest.from} raided with ${latest.viewers}` : "No raids yet"}</p>
      <WidgetOverlay trigger={`History · ${raids.length}`} title="Raid history" testId="raid-history">
        <ul>
          {raids.map((raid) => (
            <li key={raid.id}>{raid.from}</li>
          ))}
        </ul>
      </WidgetOverlay>
      <Dialog open={editing} onOpenChange={onCloseEditor}>
        <DialogContent>Raid widget settings</DialogContent>
      </Dialog>
    </div>
  );
}
