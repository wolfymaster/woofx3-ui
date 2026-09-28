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
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { actionErrorMessage } from "@/lib/action-error";
import { CapabilityNote, SectionHeading } from "./moderation-shared";

/** Modes can be changed from Twitch itself or by another mod, and nothing is pushed, so they are polled. */
const SETTINGS_REFRESH_MS = 60_000;

const DEFAULT_FOLLOWER_MINUTES = 10;
const DEFAULT_SLOW_SECONDS = 30;

export function ChatLockdownSection({ instanceId, status }: { instanceId: Id<"instances">; status: CapabilityStatus }) {
  const getChatSettings = useAction(api.moderation.getChatSettings);
  const updateChatSettings = useAction(api.moderation.updateChatSettings);

  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The duration pickers keep a choice while their mode is off, so turning the
  // mode on uses what was picked rather than Twitch's default.
  const [followerMinutes, setFollowerMinutes] = useState(DEFAULT_FOLLOWER_MINUTES);
  const [slowSeconds, setSlowSeconds] = useState(DEFAULT_SLOW_SECONDS);

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
    getChatSettings({ instanceId })
      .then(adopt)
      .catch((err: unknown) => setError(actionErrorMessage(err)));
  }, [instanceId, getChatSettings, adopt]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useVisibleInterval(refresh, SETTINGS_REFRESH_MS);

  const apply = async (patch: ChatSettingsPatch) => {
    setBusy(true);
    setError(null);
    try {
      adopt(await updateChatSettings({ instanceId, patch }));
    } catch (err) {
      setError(actionErrorMessage(err));
    } finally {
      setBusy(false);
    }
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
        onCheckedChange={(on) => void apply({ subscriberMode: on })}
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
      {error && <p className="text-xs text-destructive">{error}</p>}
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
