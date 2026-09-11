import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { Loader2, Megaphone, Pin, Radio } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export function BroadcastControlsWidget() {
  const { instance } = useInstance();
  const { toast } = useToast();

  // Token-free view of the link — enough to know whether Twitch is connected
  // and which scopes it was granted.
  const platformLinks = useQuery(api.instances.getPlatformLinks, instance ? { instanceId: instance._id } : "skip");
  const pinned = useQuery(api.activityPanel.listPinned, instance ? { instanceId: instance._id } : "skip");
  const sendAnnouncement = useAction(api.twitchBroadcast.sendAnnouncement);
  const sendShoutout = useAction(api.twitchBroadcast.sendShoutout);

  const [message, setMessage] = useState("");
  const [color, setColor] = useState<AnnouncementColor>("primary");
  const [shoutoutTarget, setShoutoutTarget] = useState("");
  const [busy, setBusy] = useState<"announce" | "shoutout" | null>(null);

  const twitchLink = platformLinks?.find((link) => link.platform === "twitch");
  // A link created before the announcement scope was added keeps working for
  // everything else, so say why the button is off rather than letting Twitch
  // 401 at send time.
  const canAnnounce = !!twitchLink?.scopes.includes(ANNOUNCEMENT_SCOPE);
  const latestPin = pinned?.[0];

  const report = (error: unknown, title: string) => {
    toast({
      title,
      description: error instanceof Error ? error.message : String(error),
      variant: "destructive",
    });
  };

  const handleAnnounce = async () => {
    if (!instance || !message.trim()) {
      return;
    }
    setBusy("announce");
    try {
      await sendAnnouncement({ instanceId: instance._id, message, color });
      setMessage("");
      toast({ title: "Announcement sent" });
    } catch (error) {
      report(error, "Couldn't send that announcement");
    } finally {
      setBusy(null);
    }
  };

  const handleShoutout = async () => {
    if (!instance || !shoutoutTarget.trim()) {
      return;
    }
    setBusy("shoutout");
    try {
      await sendShoutout({ instanceId: instance._id, targetLogin: shoutoutTarget });
      setShoutoutTarget("");
      toast({ title: "Shoutout sent" });
    } catch (error) {
      report(error, "Couldn't send that shoutout");
    } finally {
      setBusy(null);
    }
  };

  if (platformLinks !== undefined && !twitchLink) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <Radio className="h-8 w-8 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">Connect Twitch in Settings to use broadcast controls</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-auto p-3 gap-4">
      <section className="space-y-2">
        <Label htmlFor="announcement-message">Announcement</Label>
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
          disabled={busy !== null || !message.trim() || !canAnnounce}
          data-testid="button-send-announcement"
        >
          {busy === "announce" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
          Announce
        </Button>
        {!canAnnounce && platformLinks !== undefined && (
          <p className="text-xs text-muted-foreground">
            Reconnect Twitch in Settings → Integrations to grant the announcement permission.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <Label htmlFor="shoutout-target">Shoutout</Label>
        <div className="flex items-center gap-2">
          <Input
            id="shoutout-target"
            value={shoutoutTarget}
            onChange={(e) => setShoutoutTarget(e.target.value)}
            placeholder="channel name"
            className="text-sm"
            data-testid="input-shoutout-target"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleShoutout()}
            disabled={busy !== null || !shoutoutTarget.trim()}
            data-testid="button-send-shoutout"
          >
            {busy === "shoutout" ? <Loader2 className="h-4 w-4" /> : "Send"}
          </Button>
        </div>
      </section>

      <section className="space-y-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Currently pinned</span>
        {latestPin ? (
          <div className="flex items-start gap-2 rounded-md border border-border p-2" data-testid="broadcast-pinned">
            <Pin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-xs whitespace-pre-wrap break-words">{latestPin.content}</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nothing pinned — pin something from the Activity panel.</p>
        )}
      </section>
    </div>
  );
}
