import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  BAN_REASON_MAX_LENGTH,
  type CapabilityStatus,
  formatDuration,
  parseDuration,
  TIMEOUT_PRESETS,
  validateTimeoutSeconds,
} from "@convex/lib/moderation";
import { useAction } from "convex/react";
import { Clock, Gavel, Loader2, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { useChatters } from "@/hooks/use-chatters";
import { useToast } from "@/hooks/use-toast";
import { actionErrorMessage } from "@/lib/action-error";
import { matchChatters } from "@/lib/chatter-match";
import { CapabilityNote, SectionHeading } from "./moderation-shared";

type Pending = { kind: "timeout"; seconds: number } | { kind: "ban" } | { kind: "unban" };

export function UserActionsSection({
  instanceId,
  timeoutStatus,
  banStatus,
}: {
  instanceId: Id<"instances">;
  timeoutStatus: CapabilityStatus;
  banStatus: CapabilityStatus;
}) {
  const { toast } = useToast();
  const timeoutUser = useAction(api.moderation.timeoutUser);
  const banUser = useAction(api.moderation.banUser);
  const unbanUser = useAction(api.moderation.unbanUser);
  const { chatters } = useChatters();

  const [login, setLogin] = useState("");
  const [customDuration, setCustomDuration] = useState("");
  const [confirmingBan, setConfirmingBan] = useState(false);
  const [reason, setReason] = useState("");
  const [inFlight, setInFlight] = useState<Pending["kind"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canTimeout = timeoutStatus === "ready";
  const canBan = banStatus === "ready";
  const target = login.trim().replace(/^@/, "");
  const suggestions = useMemo(() => matchChatters(chatters, login), [chatters, login]);
  // Hidden once the box holds exactly a chatter's login: the pick is made, and
  // the list would otherwise sit over the buttons it was picked for.
  const showSuggestions =
    login.length > 0 && suggestions.length > 0 && !suggestions.some((c) => c.login === target.toLowerCase());

  const run = async (pending: Pending) => {
    if (!target) {
      setError("Type a username first");
      return;
    }
    setInFlight(pending.kind);
    setError(null);
    try {
      if (pending.kind === "timeout") {
        const user = await timeoutUser({ instanceId, login: target, seconds: pending.seconds });
        toast({ title: `Timed out ${user.displayName} for ${formatDuration(pending.seconds)}` });
      } else if (pending.kind === "ban") {
        const user = await banUser({ instanceId, login: target, reason });
        toast({ title: `Banned ${user.displayName}` });
        setConfirmingBan(false);
        setReason("");
      } else {
        const user = await unbanUser({ instanceId, login: target });
        toast({ title: `Unbanned ${user.displayName}` });
      }
      setLogin("");
    } catch (err) {
      setError(actionErrorMessage(err));
    } finally {
      setInFlight(null);
    }
  };

  const runCustomTimeout = () => {
    const seconds = parseDuration(customDuration);
    if (seconds === null) {
      setError('Durations look like "90", "90s", "10m", "1h30m" or "2d"');
      return;
    }
    const validated = validateTimeoutSeconds(seconds);
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    void run({ kind: "timeout", seconds: validated.value });
  };

  const busy = inFlight !== null;

  return (
    <section className="space-y-2" data-testid="moderation-user-actions">
      <SectionHeading>User</SectionHeading>
      {/* shouldFilter={false}: matchChatters ranks, as in the shoutout widget. */}
      <Command shouldFilter={false} className="h-auto rounded-md border border-border">
        <CommandInput
          placeholder="Username, or pick from chat"
          value={login}
          onValueChange={(value) => {
            setLogin(value);
            setConfirmingBan(false);
          }}
          data-testid="input-moderation-user"
        />
        {showSuggestions && (
          <CommandList className="max-h-32">
            <CommandEmpty>No one in chat matches.</CommandEmpty>
            {suggestions.map((chatter) => (
              <CommandItem key={chatter.userId} value={chatter.login} onSelect={() => setLogin(chatter.login)}>
                <span className="truncate">{chatter.displayName}</span>
              </CommandItem>
            ))}
          </CommandList>
        )}
      </Command>

      <div className="flex flex-wrap items-center gap-1.5">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        {TIMEOUT_PRESETS.map((preset) => (
          <Button
            key={preset.seconds}
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={!canTimeout || busy || !target}
            onClick={() => void run({ kind: "timeout", seconds: preset.seconds })}
            data-testid={`button-timeout-${preset.label}`}
          >
            {preset.label}
          </Button>
        ))}
        <form
          className="flex min-w-0 flex-1 gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            runCustomTimeout();
          }}
        >
          <Input
            value={customDuration}
            onChange={(event) => setCustomDuration(event.target.value)}
            placeholder="Custom, e.g. 5m"
            className="h-7 min-w-16 flex-1 text-xs"
            disabled={!canTimeout}
            data-testid="input-timeout-custom"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={!canTimeout || busy || !target || !customDuration.trim()}
            data-testid="button-timeout-custom"
          >
            {inFlight === "timeout" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Time out"}
          </Button>
        </form>
      </div>
      <CapabilityNote status={timeoutStatus} capability="timeout" />

      {confirmingBan ? (
        <div className="space-y-2 rounded-md border border-destructive/50 p-2" data-testid="moderation-ban-confirm">
          <p className="text-xs">
            Ban <span className="font-medium">{target}</span> from chat until someone unbans them?
          </p>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value.slice(0, BAN_REASON_MAX_LENGTH))}
            placeholder="Reason (optional)"
            className="h-7 text-xs"
            data-testid="input-ban-reason"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              className="h-7 flex-1 gap-1.5 text-xs"
              disabled={busy}
              // The confirm card opens from a click on Ban, so focus lands here
              // and a second deliberate press confirms.
              autoFocus
              onClick={() => void run({ kind: "ban" })}
              data-testid="button-confirm-ban"
            >
              {inFlight === "ban" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Gavel className="h-3.5 w-3.5" />
              )}
              Ban
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirmingBan(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 gap-1.5 text-xs text-destructive hover:text-destructive"
            disabled={!canBan || busy || !target}
            onClick={() => {
              setError(null);
              setConfirmingBan(true);
            }}
            data-testid="button-ban"
          >
            <Gavel className="h-3.5 w-3.5" />
            Ban…
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 gap-1.5 text-xs"
            disabled={!canBan || busy || !target}
            onClick={() => void run({ kind: "unban" })}
            data-testid="button-unban"
          >
            {inFlight === "unban" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Undo2 className="h-3.5 w-3.5" />
            )}
            Unban
          </Button>
        </div>
      )}
      <CapabilityNote status={banStatus} capability="ban" />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
