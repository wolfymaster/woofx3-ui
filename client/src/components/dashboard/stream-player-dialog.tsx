import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface StreamPlayerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Twitch login, lowercased. */
  channel: string;
  title?: string;
}

/**
 * The enlarged Twitch player, shared by the stream-preview widget and the
 * command bar's preview thumbnail so there's one embed to keep correct
 * (`parent` host, muted autoplay, mount-only iframe).
 */
export function StreamPlayerDialog({ open, onOpenChange, channel, title }: StreamPlayerDialogProps) {
  const parentHost = typeof window !== "undefined" ? window.location.hostname : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>{title ?? "Stream preview"}</DialogTitle>
        </DialogHeader>
        <div className="aspect-video w-full bg-black">
          {open && (
            <iframe
              src={`https://player.twitch.tv/?channel=${channel}&parent=${parentHost}&muted=true`}
              title="Twitch stream player"
              className="w-full h-full"
              allowFullScreen
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
