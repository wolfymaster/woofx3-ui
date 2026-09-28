import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { macroTriggerUrl } from "@convex/lib/macroTrigger";
import { useAction, useMutation, useQuery } from "convex/react";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CONVEX_SITE_URL } from "@/lib/convexSiteUrl";
import { extractMacroVariables, type MacroButton } from "@/lib/macro-pad";
import { macroTriggerExamples, macroTriggerStatusLabel } from "@/lib/macro-trigger-examples";

interface MacroRemoteTriggerProps {
  instanceId: Id<"instances">;
  /** The saved macro. A trigger fires what is stored, not unsaved edits in the form. */
  macro: MacroButton;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 px-2 shrink-0"
      onClick={() => void copy()}
      aria-label={label}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

/**
 * The URL, shown once right after it is minted: only a hash is stored, so
 * closing the editor loses it for good and the answer is to rotate.
 */
function RevealedTrigger({ url, variables, allowGet }: { url: string; variables: string[]; allowGet: boolean }) {
  const examples = macroTriggerExamples(url, variables, allowGet);
  return (
    <div
      className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3"
      data-testid="macro-trigger-revealed"
    >
      <p className="text-xs font-medium">Copy this URL now. It will not be shown again.</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 break-all rounded bg-muted px-2 py-1 text-xs">{url}</code>
        <CopyButton text={url} label="Copy trigger URL" />
      </div>
      {examples.map((example) => (
        <div key={example.id} className="space-y-1">
          <p className="text-[11px] text-muted-foreground">{example.label}</p>
          <div className="flex items-start gap-2">
            <pre className="flex-1 min-w-0 overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 text-[11px]">
              {example.text}
            </pre>
            <CopyButton text={example.text} label={`Copy ${example.label} example`} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A macro's remote trigger: a secret URL any device can call to press the
 * button. Owners and admins manage it; other members see its status only.
 */
export function MacroRemoteTrigger({ instanceId, macro }: MacroRemoteTriggerProps) {
  const status = useQuery(api.macroTriggers.listForInstance, { instanceId });
  const issueToken = useAction(api.macroTriggers.issueToken);
  const revoke = useMutation(api.macroTriggers.revoke);
  const setAllowGet = useMutation(api.macroTriggers.setAllowGet);

  const macroId = macro.id as Id<"macros">;
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"rotate" | "revoke" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A token belongs to the macro it was minted for; opening another macro in
  // the same editor must not show it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: macroId is the deliberate reset trigger
  useEffect(() => {
    setRevealedToken(null);
    setConfirming(null);
    setError(null);
  }, [macroId]);

  if (macro.type === "http-request") {
    return (
      <p className="text-xs text-muted-foreground" data-testid="macro-trigger-unavailable">
        HTTP request macros run from your browser, so they have no remote trigger. Point the device at that URL directly
        instead.
      </p>
    );
  }
  if (status === undefined) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  const trigger = status.triggers.find((row) => row.macroId === macroId);
  const variables = extractMacroVariables(macro.config);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  const mint = () =>
    run(async () => {
      const { token } = await issueToken({ instanceId, macroId });
      setRevealedToken(token);
    });

  const turnOff = () =>
    run(async () => {
      await revoke({ instanceId, macroId });
      setRevealedToken(null);
    });

  return (
    <div className="space-y-3" data-testid="macro-remote-trigger">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor="macro-remote-trigger-switch">Remote trigger</Label>
          <p className="text-xs text-muted-foreground">
            {trigger
              ? macroTriggerStatusLabel(trigger)
              : "A secret URL that presses this button from a Stream Deck, Companion or phone shortcut."}
          </p>
        </div>
        <Switch
          id="macro-remote-trigger-switch"
          checked={trigger !== undefined}
          disabled={!status.canManage || busy}
          onCheckedChange={(checked) => {
            if (checked) {
              void mint();
            } else {
              setConfirming("revoke");
            }
          }}
          data-testid="switch-macro-remote-trigger"
        />
      </div>

      {!status.canManage && (
        <p className="text-xs text-muted-foreground">Only an owner or admin of this instance can change it.</p>
      )}

      {confirming && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-2">
          <p className="flex-1 text-xs">
            {confirming === "rotate"
              ? "Make a new URL? The current one stops working immediately."
              : "Turn off the remote trigger? The URL stops working immediately."}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => void (confirming === "rotate" ? mint() : turnOff())}
            data-testid="button-confirm-macro-trigger"
          >
            {confirming === "rotate" ? "Rotate" : "Turn off"}
          </Button>
        </div>
      )}

      {trigger && revealedToken && (
        <RevealedTrigger
          url={macroTriggerUrl(CONVEX_SITE_URL, revealedToken)}
          variables={variables}
          allowGet={trigger.allowGet}
        />
      )}

      {trigger && status.canManage && (
        <div className="space-y-3">
          {!revealedToken && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">Lost the URL? Rotate to get a new one.</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirming("rotate")}
                data-testid="button-rotate-macro-trigger"
              >
                <RefreshCw className="mr-1.5 h-3 w-3" />
                Rotate
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="macro-trigger-allow-get">Also accept GET</Label>
              <p className="text-xs text-muted-foreground">
                For devices that can only open a URL. A GET link also fires if a chat app or browser previews it, so
                never paste it anywhere.
              </p>
            </div>
            <Switch
              id="macro-trigger-allow-get"
              checked={trigger.allowGet}
              disabled={busy}
              onCheckedChange={(allowGet) =>
                void run(async () => {
                  await setAllowGet({ instanceId, macroId, allowGet });
                })
              }
              data-testid="switch-macro-trigger-allow-get"
            />
          </div>
        </div>
      )}

      {variables.length > 0 && trigger && (
        <p className="text-xs text-muted-foreground">
          Send {variables.map((name) => `"${name}"`).join(", ")} as JSON body fields or query parameters; a request
          missing any of them is refused.
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
