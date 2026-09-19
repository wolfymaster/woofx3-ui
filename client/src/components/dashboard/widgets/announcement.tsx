import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { Loader2, Megaphone, Radio } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// Twitch accepts exactly these five announcement colors — a fixed swatch set,
// not a color picker. "primary" renders as the channel's own accent.
const ANNOUNCEMENT_COLORS = [
  { value: "primary", label: "Channel accent", swatch: "bg-primary" },
  { value: "blue", label: "Blue", swatch: "bg-blue-500" },
  { value: "green", label: "Green", swatch: "bg-green-500" },
  { value: "orange", label: "Orange", swatch: "bg-orange-500" },
  { value: "purple", label: "Purple", swatch: "bg-purple-500" },
] as const;

type AnnouncementColor = (typeof ANNOUNCEMENT_COLORS)[number]["value"];

const ANNOUNCEMENT_SCOPE = "moderator:manage:announcements";
const MAX_ANNOUNCEMENT_LENGTH = 500;

export function AnnouncementWidget() {
  const { instance } = useInstance();
  const { toast } = useToast();

  // Token-free view of the link — enough to know whether Twitch is connected
  // and which scopes it was granted.
  const platformLinks = useQuery(api.instances.getPlatformLinks, instance ? { instanceId: instance._id } : "skip");
  const sendAnnouncement = useAction(api.twitchBroadcast.sendAnnouncement);

  const [message, setMessage] = useState("");
  const [color, setColor] = useState<AnnouncementColor>("primary");
  const [busy, setBusy] = useState(false);

  const twitchLink = platformLinks?.find((link) => link.platform === "twitch");
  // A link created before the announcement scope was added keeps working for
  // everything else, so say why the button is off rather than letting Twitch
  // 401 at send time.
  const canAnnounce = !!twitchLink?.scopes.includes(ANNOUNCEMENT_SCOPE);

  const handleAnnounce = async () => {
    if (!instance || !message.trim()) {
      return;
    }
    setBusy(true);
    try {
      await sendAnnouncement({ instanceId: instance._id, message, color });
      setMessage("");
      toast({ title: "Announcement sent" });
    } catch (error) {
      toast({
        title: "Couldn't send that announcement",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  if (platformLinks !== undefined && !twitchLink) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <Radio className="h-8 w-8 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">Connect Twitch in Settings to send announcements</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-auto p-3 gap-2">
      {/* Kept for the textarea's accessible name, but not painted: the widget's
          title belongs in the registry, not on the card. */}
      <Label htmlFor="announcement-message" className="sr-only">
        Announcement
      </Label>
      <Textarea
        id="announcement-message"
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, MAX_ANNOUNCEMENT_LENGTH))}
        placeholder="Say something to chat…"
        rows={3}
        className="resize-none text-sm"
        data-testid="input-announcement-message"
      />
      <div className="flex items-center gap-1.5">
        {ANNOUNCEMENT_COLORS.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.label}
            aria-label={option.label}
            aria-pressed={color === option.value}
            className={cn(
              "h-5 w-5 rounded-full border-2 transition-colors",
              option.swatch,
              color === option.value ? "border-foreground" : "border-transparent"
            )}
            onClick={() => setColor(option.value)}
            data-testid={`swatch-announcement-${option.value}`}
          />
        ))}
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {message.length}/{MAX_ANNOUNCEMENT_LENGTH}
        </span>
      </div>
      <Button
        size="sm"
        className="w-full gap-1.5"
        onClick={() => void handleAnnounce()}
        disabled={busy || !message.trim() || !canAnnounce}
        data-testid="button-send-announcement"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
        Announce
      </Button>
      {!canAnnounce && platformLinks !== undefined && (
        <p className="text-xs text-muted-foreground">
          Reconnect Twitch in Settings → Integrations to grant the announcement permission.
        </p>
      )}
    </div>
  );
}
