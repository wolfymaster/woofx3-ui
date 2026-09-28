import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Copy } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

interface WebhookEventPayloadDialogProps {
  logId: Id<"engineEventLog">;
  eventType: string;
}

function formatPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

// Mounted only while the dialog is open (Radix renders DialogContent's children
// on open), so a closed dialog neither subscribes to the payload nor parses it.
function PayloadBody({ logId }: { logId: Id<"engineEventLog"> }) {
  const { toast } = useToast();
  const payload = useQuery(api.engineEventLog.getPayload, { logId });
  const formatted = useMemo(() => (typeof payload === "string" ? formatPayload(payload) : null), [payload]);

  if (payload === undefined) {
    return <Skeleton className="h-40 w-full" />;
  }
  if (formatted === null) {
    return <p className="text-sm text-muted-foreground">This event is no longer available.</p>;
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(formatted);
    toast({ title: "Copied", description: "Payload JSON copied to clipboard." });
  };

  return (
    <>
      <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-4 text-xs">{formatted}</pre>
      <Button variant="secondary" size="sm" onClick={handleCopy} className="w-fit">
        <Copy className="h-3.5 w-3.5" />
        Copy JSON
      </Button>
    </>
  );
}

export function WebhookEventPayloadDialog({ logId, eventType }: WebhookEventPayloadDialogProps) {
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
        <PayloadBody logId={logId} />
      </DialogContent>
    </Dialog>
  );
}
