import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  type CapabilityStatus,
  type ChatSettings,
  type ChatSettingsPatch,
  FOLLOWER_MODE_OPTIONS,
  SLOW_MODE_OPTIONS,
} from "@convex/lib/moderation";
import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToastAction } from "@/components/ui/toast";
import { useAttendedInterval } from "@/hooks/use-attended-interval";
import { useToast } from "@/hooks/use-toast";
import { actionErrorMessage } from "@/lib/action-error";
import { createWriteFence } from "@/lib/write-fence";
import { CapabilityNote, SectionHeading } from "./moderation-shared";

/** Modes can be changed from Twitch itself or by another mod, and nothing is pushed, so they are polled. */
const SETTINGS_REFRESH_MS = 60_000;

const DEFAULT_FOLLOWER_MINUTES = 10;
const DEFAULT_SLOW_SECONDS = 30;

export function ChatLockdownSection({ instanceId, status }: { instanceId: Id<"instances">; status: CapabilityStatus }) {
  const { toast } = useToast();
  const getChatSettings = useAction(api.moderation.getChatSettings);
  const updateChatSettings = useAction(api.moderation.updateChatSettings);

  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [busy, setBusy] = useState(false);
  /** Only a failed first read is shown; a failed poll keeps the last known modes quietly, as pinned.tsx does. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The duration pickers keep a choice while their mode is off, so turning the
  // mode on uses what was picked rather than Twitch's default.
  const [followerMinutes, setFollowerMinutes] = useState(DEFAULT_FOLLOWER_MINUTES);
  const [slowSeconds, setSlowSeconds] = useState(DEFAULT_SLOW_SECONDS);
  const fence = useRef(createWriteFence()).current;
  const loaded = useRef(false);
  const writing = useRef(false);

  const adopt = useCallback((next: ChatSettings) => {
    setSettings(next);
    if (next.followerMode && next.followerModeDuration !== null) {
      setFollowerMinutes(next.followerModeDuration);
    }
    if (next.slowMode && next.slowModeWaitTime !== null) {
      setSlowSeconds(next.slowModeWaitTime);
    }
  }, []);

  const refresh = useCallback(() => {
    // A read started mid-write could answer with the modes from before it.
    if (writing.current) {
      return;
    }
    const current = fence.read();
    getChatSettings({ instanceId })
      .then((next) => {
        loaded.current = true;
        setLoadError(null);
        if (current()) {
          adopt(next);
        }
      })
      .catch((err: unknown) => {
        if (!loaded.current) {
          setLoadError(actionErrorMessage(err));
        }
      });
  }, [instanceId, getChatSettings, adopt, fence]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useAttendedInterval(refresh, SETTINGS_REFRESH_MS);

  const apply = async (patch: ChatSettingsPatch): Promise<boolean> => {
    fence.write();
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      adopt(await updateChatSettings({ instanceId, patch }));
      return true;
    } catch (err) {
      setError(actionErrorMessage(err));
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };

  // Subscriber-only silences most of a small channel's chat at once, so it is
  // the one switch with an undo on hand rather than a confirmation in the way.
  const setSubscriberMode = async (on: boolean) => {
    const applied = await apply({ subscriberMode: on });
    if (!applied || !on) {
      return;
    }
    toast({
      title: "Subscriber-only chat is on",
      action: (
        <ToastAction altText="Turn subscriber-only off" onClick={() => void apply({ subscriberMode: false })}>
          Undo
        </ToastAction>
      ),
    });
  };

  const disabled = status !== "ready" || busy || settings === null;

  return (
    <section className="space-y-2" data-testid="moderation-chat-lockdown">
      <div className="flex items-center gap-1.5">
        <SectionHeading>Chat modes</SectionHeading>
        {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      <ModeRow
        id="mode-followers"
        label="Followers-only"
        checked={settings?.followerMode ?? false}
        disabled={disabled}
        onCheckedChange={(on) =>
          void apply(on ? { followerMode: true, followerModeDuration: followerMinutes } : { followerMode: false })
        }
      >
        <Select
          value={String(followerMinutes)}
          disabled={status !== "ready" || busy}
          onValueChange={(value) => {
            const minutes = Number(value);
            setFollowerMinutes(minutes);
            if (settings?.followerMode) {
              void apply({ followerMode: true, followerModeDuration: minutes });
            }
          }}
        >
          <SelectTrigger className="h-7 w-28 text-xs" data-testid="select-follower-duration">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FOLLOWER_MODE_OPTIONS.map((option) => (
              <SelectItem key={option.minutes} value={String(option.minutes)}>
                {option.label}
              </SelectItem>
            ))}
            {!FOLLOWER_MODE_OPTIONS.some((option) => option.minutes === followerMinutes) && (
              <SelectItem value={String(followerMinutes)}>{followerMinutes} minutes</SelectItem>
            )}
          </SelectContent>
        </Select>
      </ModeRow>

      <ModeRow
        id="mode-subscribers"
        label="Subscriber-only"
        checked={settings?.subscriberMode ?? false}
        disabled={disabled}
        onCheckedChange={(on) => void setSubscriberMode(on)}
      />

      <ModeRow
        id="mode-emotes"
        label="Emote-only"
        checked={settings?.emoteMode ?? false}
        disabled={disabled}
        onCheckedChange={(on) => void apply({ emoteMode: on })}
      />

      <ModeRow
        id="mode-slow"
        label="Slow mode"
        checked={settings?.slowMode ?? false}
        disabled={disabled}
        onCheckedChange={(on) =>
          void apply(on ? { slowMode: true, slowModeWaitTime: slowSeconds } : { slowMode: false })
        }
      >
        <Select
          value={String(slowSeconds)}
          disabled={status !== "ready" || busy}
          onValueChange={(value) => {
            const seconds = Number(value);
            setSlowSeconds(seconds);
            if (settings?.slowMode) {
              void apply({ slowMode: true, slowModeWaitTime: seconds });
            }
          }}
        >
          <SelectTrigger className="h-7 w-28 text-xs" data-testid="select-slow-seconds">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SLOW_MODE_OPTIONS.map((seconds) => (
              <SelectItem key={seconds} value={String(seconds)}>
                {seconds}s
              </SelectItem>
            ))}
            {!SLOW_MODE_OPTIONS.some((seconds) => seconds === slowSeconds) && (
              <SelectItem value={String(slowSeconds)}>{slowSeconds}s</SelectItem>
            )}
          </SelectContent>
        </Select>
      </ModeRow>

      <CapabilityNote status={status} capability="chatSettings" />
      {(error ?? loadError) && <p className="text-xs text-destructive">{error ?? loadError}</p>}
    </section>
  );
}

function ModeRow({
  id,
  label,
  checked,
  disabled,
  onCheckedChange,
  children,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} data-testid={id} />
      <Label htmlFor={id} className="flex-1 text-xs font-normal">
        {label}
      </Label>
      {children}
    </div>
  );
}
