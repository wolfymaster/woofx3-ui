import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface WebhookEventPayloadDialogProps {
  eventType: string;
  payload: string;
}

function formatPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

export function WebhookEventPayloadDialog({ eventType, payload }: WebhookEventPayloadDialogProps) {
  const { toast } = useToast();
  const formatted = formatPayload(payload);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(formatted);
    toast({ title: "Copied", description: "Payload JSON copied to clipboard." });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          View JSON
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{eventType}</DialogTitle>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-4 text-xs">{formatted}</pre>
        <Button variant="secondary" size="sm" onClick={handleCopy} className="w-fit">
          <Copy className="h-3.5 w-3.5" />
          Copy JSON
        </Button>
      </DialogContent>
    </Dialog>
  );
}
