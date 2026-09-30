import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { formatDuration, parseDuration, validateTimeoutSeconds } from "@convex/lib/moderation";
import { useStore } from "@nanostores/react";
import { useAction, useMutation } from "convex/react";
import {
  Ban,
  BellOff,
  Bookmark,
  Clapperboard,
  Clock,
  Copy,
  LogOut,
  Megaphone,
  MessageCircle,
  Monitor,
  Moon,
  Palette,
  PanelLeft,
  PanelTop,
  Pencil,
  Pin,
  Server,
  Shield,
  ShieldCheck,
  SkipForward,
  Sun,
  TimerOff,
  Type,
  UserCheck,
} from "lucide-react";
import { useAuthActions } from "@/hooks/use-convex-auth";
import { useTheme } from "@/hooks/use-theme";
import { $commandBarHidden, $sidebarCollapsed } from "@/lib/stores";
import { themePalettes } from "@/lib/theme/palettes";
import { CUSTOM_PALETTE_ID } from "@/lib/theme/resolve";
import type { PaletteCommand } from "./types";

const STREAM_GROUP = "Stream";
const CHAT_GROUP = "Chat";
const MODERATION_GROUP = "Moderation";
const APP_GROUP = "App";

/** What a timeout lasts when the prompt names no duration: Twitch's own default. */
const DEFAULT_TIMEOUT_SECONDS = 600;

/**
 * "ninja 10m" as a login and a duration in seconds, the duration read as the moderation
 * widget reads it. Without a duration, Twitch's default.
 */
function parseTimeoutInput(text: string): { login: string; seconds: number } | { error: string } {
  const [login, ...rest] = stripAt(text).split(/\s+/);
  if (!login) {
    return { error: "Type a login, then optionally a duration such as 30s, 10m or 1h" };
  }
  if (rest.length === 0) {
    return { login, seconds: DEFAULT_TIMEOUT_SECONDS };
  }
  const seconds = parseDuration(rest.join(""));
  if (seconds === null) {
    return { error: "Type the duration as 90, 30s, 10m, 1h30m or 1d" };
  }
  const validated = validateTimeoutSeconds(seconds);
  return validated.ok ? { login, seconds: validated.value } : { error: validated.error };
}

function stripAt(login: string): string {
  return login.trim().replace(/^@/, "");
}

interface ChatMode {
  id: string;
  label: string;
  on: Record<string, boolean>;
  off: Record<string, boolean>;
  keywords: string[];
}

const CHAT_MODES: readonly ChatMode[] = [
  { id: "emote", label: "Emote-only", on: { emoteMode: true }, off: { emoteMode: false }, keywords: ["emotes"] },
  {
    id: "subscriber",
    label: "Subscriber-only",
    on: { subscriberMode: true },
    off: { subscriberMode: false },
    keywords: ["subs only"],
  },
  {
    id: "follower",
    label: "Follower-only",
    on: { followerMode: true },
    off: { followerMode: false },
    keywords: ["followers only"],
  },
  { id: "slow", label: "Slow mode", on: { slowMode: true }, off: { slowMode: false }, keywords: ["slow chat"] },
];

/** Things to do on the stream, in chat and in the app — none of them tied to one item. */
export function useActionCommands(
  instance: Doc<"instances"> | null,
  instances: readonly Doc<"instances">[],
  setInstance: (id: string) => void
): PaletteCommand[] {
  const instanceId = instance?._id;
  const createClip = useAction(api.twitchClips.createClip);
  const createMarker = useAction(api.streamInfo.createMarker);
  const updateChannelInfo = useAction(api.streamInfo.updateChannelInfo);
  const snoozeNextAd = useAction(api.adBreaks.snoozeNextAd);
  const skipCurrentAlert = useAction(api.alertActions.skipCurrent);
  const clearAlertQueue = useAction(api.alertActions.clearQueue);
  const sendChatMessage = useAction(api.twitchBroadcast.sendChatMessage);
  const sendAnnouncement = useAction(api.twitchBroadcast.sendAnnouncement);
  const sendShoutout = useAction(api.twitchBroadcast.sendShoutout);
  const pinNewMessage = useAction(api.pins.pinNewMessage);
  const timeoutUser = useAction(api.moderation.timeoutUser);
  const banUser = useAction(api.moderation.banUser);
  const unbanUser = useAction(api.moderation.unbanUser);
  const updateChatSettings = useAction(api.moderation.updateChatSettings);
  const renameInstance = useMutation(api.instances.update);
  const { signOut } = useAuthActions();
  const { mode, modePreference, paletteId, setMode, toggleMode, selectPalette } = useTheme();
  const sidebarCollapsed = useStore($sidebarCollapsed);
  const commandBarHidden = useStore($commandBarHidden);

  const commands: PaletteCommand[] = [];

  if (instanceId) {
    commands.push(...streamCommands(instanceId), ...chatCommands(instanceId), ...moderationCommands(instanceId));
  }
  commands.push(...appCommands());
  return commands;

  function streamCommands(id: Id<"instances">): PaletteCommand[] {
    return [
      {
        id: "stream:clip",
        title: "Create clip",
        kind: "action",
        group: STREAM_GROUP,
        keywords: ["clip that", "highlight"],
        icon: Clapperboard,
        action: {
          type: "run",
          run: async () => {
            const { editUrl } = await createClip({ instanceId: id });
            // A new clip is a draft until it is trimmed and published in Twitch's editor.
            window.open(editUrl, "_blank", "noopener,noreferrer");
            return "Clip created — opened Twitch's editor";
          },
        },
      },
      {
        id: "stream:marker",
        title: "Add stream marker…",
        kind: "action",
        group: STREAM_GROUP,
        keywords: ["bookmark", "vod", "highlight"],
        icon: Bookmark,
        action: {
          type: "prompt",
          prompt: {
            placeholder: "Description (optional)",
            aliases: ["marker", "mark"],
            allowEmpty: true,
            submitLabel: (text) => (text ? `Add marker “${text}”` : "Add marker"),
            run: async (text) => {
              await createMarker({ instanceId: id, description: text });
              return "Marker added";
            },
          },
        },
      },
      {
        id: "stream:title",
        title: "Set stream title…",
        kind: "action",
        group: STREAM_GROUP,
        keywords: ["rename stream", "stream info"],
        icon: Type,
        action: {
          type: "prompt",
          prompt: {
            placeholder: "New stream title",
            aliases: ["title"],
            submitLabel: (text) => `Set title to “${text}”`,
            run: async (text) => {
              const { unapplied } = await updateChannelInfo({ instanceId: id, title: text });
              return unapplied.includes("title") ? "Twitch kept the old title" : "Title updated";
            },
          },
        },
      },
      {
        id: "stream:snooze-ad",
        title: "Snooze next ad",
        kind: "action",
        group: STREAM_GROUP,
        keywords: ["ads", "delay ad", "commercial"],
        icon: TimerOff,
        action: {
          type: "run",
          run: async () => {
            const result = await snoozeNextAd({ instanceId: id });
            return `Ad snoozed — ${result.snoozeCount} snooze${result.snoozeCount === 1 ? "" : "s"} left`;
          },
        },
      },
      {
        id: "stream:skip-alert",
        title: "Skip current alert",
        kind: "action",
        group: STREAM_GROUP,
        keywords: ["stop alert", "overlay", "silence"],
        icon: SkipForward,
        action: {
          type: "run",
          run: async () => {
            const result = await skipCurrentAlert({ instanceId: id });
            if (!result.ok) {
              throw new Error(result.reason ?? "The engine refused to skip");
            }
            return result.skipped > 0 ? "Alert skipped" : "No alert was playing";
          },
        },
      },
      {
        id: "stream:clear-alerts",
        title: "Clear alert queue",
        kind: "action",
        group: STREAM_GROUP,
        keywords: ["drop alerts", "overlay"],
        icon: BellOff,
        confirm: true,
        action: {
          type: "run",
          run: async () => {
            const result = await clearAlertQueue({ instanceId: id });
            if (!result.ok) {
              throw new Error(result.reason ?? "The engine refused to clear the queue");
            }
            return `Dropped ${result.cleared} waiting alert${result.cleared === 1 ? "" : "s"}`;
          },
        },
      },
    ];
  }

  function chatCommands(id: Id<"instances">): PaletteCommand[] {
    return [
      {
        id: "chat:message",
        title: "Send chat message…",
        kind: "action",
        group: CHAT_GROUP,
        keywords: ["say", "write"],
        icon: MessageCircle,
        action: {
          type: "prompt",
          prompt: {
            placeholder: "Message",
            aliases: ["say", "chat"],
            submitLabel: (text) => `Send “${text}”`,
            run: async (text) => {
              await sendChatMessage({ instanceId: id, message: text });
              return "Sent to chat";
            },
          },
        },
      },
      {
        id: "chat:announce",
        title: "Send announcement…",
        kind: "action",
        group: CHAT_GROUP,
        keywords: ["announce", "highlight message"],
        icon: Megaphone,
        action: {
          type: "prompt",
          prompt: {
            placeholder: "Announcement",
            aliases: ["announce"],
            submitLabel: (text) => `Announce “${text}”`,
            run: async (text) => {
              await sendAnnouncement({ instanceId: id, message: text, color: "primary" });
              return "Announcement sent";
            },
          },
        },
      },
      {
        id: "chat:pin",
        title: "Pin message…",
        kind: "action",
        group: CHAT_GROUP,
        keywords: ["pinned"],
        icon: Pin,
        action: {
          type: "prompt",
          prompt: {
            placeholder: "Message to pin",
            aliases: ["pin"],
            submitLabel: (text) => `Pin “${text}”`,
            run: async (text) => {
              await pinNewMessage({ instanceId: id, text });
              return "Message pinned";
            },
          },
        },
      },
      {
        id: "chat:shoutout",
        title: "Shout out…",
        kind: "action",
        group: CHAT_GROUP,
        keywords: ["so", "shoutout", "raid", "streamer"],
        icon: Megaphone,
        action: {
          type: "prompt",
          prompt: {
            placeholder: "Twitch login",
            aliases: ["so", "shoutout", "shout out"],
            submitLabel: (text) => `Shout out ${stripAt(text)}`,
            run: async (text) => {
              await sendShoutout({ instanceId: id, targetLogin: stripAt(text) });
              return `Shouted out ${stripAt(text)}`;
            },
          },
        },
      },
    ];
  }

  function moderationCommands(id: Id<"instances">): PaletteCommand[] {
    const modes: PaletteCommand[] = CHAT_MODES.flatMap((chatMode) =>
      (["on", "off"] as const).map((state) => ({
        id: `moderation:mode:${chatMode.id}:${state}`,
        title: `${chatMode.label} ${state}`,
        kind: "action" as const,
        group: MODERATION_GROUP,
        subtitle: "Chat modes",
        keywords: [...chatMode.keywords, "chat mode", state === "on" ? "enable" : "disable"],
        icon: state === "on" ? ShieldCheck : Shield,
        hiddenUntilSearch: true,
        action: {
          type: "run" as const,
          run: async () => {
            await updateChatSettings({ instanceId: id, patch: chatMode[state] });
            return `${chatMode.label} ${state}`;
          },
        },
      }))
    );

    return [
      {
        id: "moderation:timeout",
        title: "Timeout user…",
        kind: "action",
        group: MODERATION_GROUP,
        keywords: ["mute", "purge"],
        icon: Clock,
        action: {
          type: "prompt",
          prompt: {
            placeholder: "login and duration, e.g. ninja 10m",
            aliases: ["timeout", "to"],
            submitLabel: (text) => {
              const parsed = parseTimeoutInput(text);
              return "error" in parsed
                ? "Time out …"
                : `Time out ${parsed.login} for ${formatDuration(parsed.seconds)}`;
            },
            run: async (text) => {
              const parsed = parseTimeoutInput(text);
              if ("error" in parsed) {
                throw new Error(parsed.error);
              }
              await timeoutUser({ instanceId: id, login: parsed.login, seconds: parsed.seconds });
              return `Timed out ${parsed.login}`;
            },
          },
        },
      },
      {
        id: "moderation:ban",
        title: "Ban user…",
        kind: "action",
        group: MODERATION_GROUP,
        icon: Ban,
        action: {
          type: "prompt",
          prompt: {
            placeholder: "Twitch login",
            aliases: ["ban"],
            submitLabel: (text) => `Ban ${stripAt(text)}`,
            run: async (text) => {
              await banUser({ instanceId: id, login: stripAt(text) });
              return `Banned ${stripAt(text)}`;
            },
          },
        },
      },
      {
        id: "moderation:unban",
        title: "Unban user…",
        kind: "action",
        group: MODERATION_GROUP,
        keywords: ["pardon", "untimeout"],
        icon: UserCheck,
        action: {
          type: "prompt",
          prompt: {
            placeholder: "Twitch login",
            aliases: ["unban"],
            submitLabel: (text) => `Unban ${stripAt(text)}`,
            run: async (text) => {
              await unbanUser({ instanceId: id, login: stripAt(text) });
              return `Unbanned ${stripAt(text)}`;
            },
          },
        },
      },
      {
        id: "moderation:modes",
        title: "Chat modes…",
        kind: "action",
        group: MODERATION_GROUP,
        keywords: ["emote only", "sub only", "follower only", "slow mode", "lockdown"],
        icon: ShieldCheck,
        action: { type: "menu", children: modes },
      },
      ...modes,
    ];
  }

  function appCommands(): PaletteCommand[] {
    const themeModes: PaletteCommand[] = (
      [
        { value: "light", label: "Light", icon: Sun },
        { value: "dark", label: "Dark", icon: Moon },
        { value: "system", label: "System", icon: Monitor },
      ] as const
    ).map(({ value, label, icon }) => ({
      id: `app:theme-mode:${value}`,
      title: `${label} mode`,
      kind: "action",
      group: APP_GROUP,
      subtitle: "Theme",
      keywords: ["theme", "appearance"],
      meta: modePreference === value ? "Current" : undefined,
      icon,
      hiddenUntilSearch: true,
      action: {
        type: "run",
        run: async () => {
          setMode(value);
          return undefined;
        },
      },
    }));
    const palettes: PaletteCommand[] = [
      ...themePalettes.map((palette) => ({ id: palette.id, name: palette.name })),
      { id: CUSTOM_PALETTE_ID, name: "Custom" },
    ].map((palette) => ({
      id: `app:palette:${palette.id}`,
      title: `${palette.name} palette`,
      kind: "action",
      group: APP_GROUP,
      subtitle: "Theme",
      keywords: ["theme", "colors", "appearance"],
      meta: paletteId === palette.id ? "Current" : undefined,
      icon: Palette,
      hiddenUntilSearch: true,
      action: {
        type: "run",
        run: async () => {
          selectPalette(palette.id);
          return undefined;
        },
        keepOpen: true,
      },
    }));

    const result: PaletteCommand[] = [
      {
        id: "app:toggle-theme",
        title: mode === "dark" ? "Switch to light mode" : "Switch to dark mode",
        kind: "action",
        group: APP_GROUP,
        keywords: ["theme", "dark mode", "light mode", "toggle"],
        icon: mode === "dark" ? Sun : Moon,
        action: {
          type: "run",
          run: async () => {
            toggleMode();
            return undefined;
          },
        },
      },
      {
        id: "app:theme",
        title: "Theme…",
        kind: "action",
        group: APP_GROUP,
        keywords: ["appearance", "colors", "palette", "mode"],
        icon: Palette,
        action: { type: "menu", children: [...themeModes, ...palettes] },
      },
      ...themeModes,
      ...palettes,
      {
        id: "app:toggle-sidebar",
        title: sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar",
        kind: "action",
        group: APP_GROUP,
        keywords: ["menu", "navigation", "toggle"],
        icon: PanelLeft,
        action: {
          type: "run",
          run: async () => {
            $sidebarCollapsed.set(!sidebarCollapsed);
            return undefined;
          },
        },
      },
      {
        id: "app:toggle-command-bar",
        title: commandBarHidden ? "Show dashboard command bar" : "Hide dashboard command bar",
        kind: "action",
        group: APP_GROUP,
        keywords: ["toolbar", "toggle"],
        icon: PanelTop,
        action: {
          type: "run",
          run: async () => {
            $commandBarHidden.set(!commandBarHidden);
            return undefined;
          },
        },
      },
    ];

    if (instance) {
      const current = instance;
      result.push(
        {
          id: "app:rename-instance",
          title: "Rename instance…",
          kind: "action",
          group: APP_GROUP,
          keywords: ["instance name"],
          icon: Pencil,
          action: {
            type: "prompt",
            prompt: {
              placeholder: current.name,
              submitLabel: (text) => `Rename to “${text}”`,
              run: async (text) => {
                await renameInstance({ instanceId: current._id, name: text.trim() });
                return "Instance renamed";
              },
            },
          },
        },
        {
          id: "app:copy-instance-id",
          title: "Copy instance ID",
          kind: "action",
          group: APP_GROUP,
          keywords: ["clipboard", "debug", "support"],
          icon: Copy,
          action: {
            type: "run",
            run: async () => {
              await navigator.clipboard.writeText(current._id);
              return "Instance ID copied";
            },
          },
        }
      );
    }

    if (instances.length > 1) {
      const switchTo: PaletteCommand[] = instances.map((candidate) => ({
        id: `app:instance:${candidate._id}`,
        title: candidate.name,
        kind: "action",
        group: APP_GROUP,
        subtitle: "Switch instance",
        keywords: ["instance", "switch", "workspace"],
        meta: candidate._id === instanceId ? "Current" : undefined,
        icon: Server,
        hiddenUntilSearch: true,
        action: {
          type: "run",
          run: async () => {
            setInstance(candidate._id);
            return `Switched to ${candidate.name}`;
          },
        },
      }));
      result.push(
        {
          id: "app:switch-instance",
          title: "Switch instance…",
          kind: "action",
          group: APP_GROUP,
          keywords: ["workspace", "engine", "account"],
          icon: Server,
          action: { type: "menu", children: switchTo },
        },
        ...switchTo
      );
    }

    result.push({
      id: "app:sign-out",
      title: "Sign out",
      kind: "action",
      group: APP_GROUP,
      keywords: ["log out", "logout", "exit"],
      icon: LogOut,
      confirm: true,
      action: {
        type: "run",
        run: async () => {
          await signOut();
          return undefined;
        },
      },
    });

    return result;
  }
}
