import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatUserCode, normalizeUserCode } from "@convex/lib/companionCodes";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Loader2, MonitorPlay, ShieldAlert, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Approving a companion app's pairing request (/companion/pair?code=…).
 *
 * Sits under AuthGuard but outside BroadcastShell and OnboardingGuard: a
 * streamer whose engine will run on this PC has no registered instance yet,
 * and the companion is how they get one.
 */

function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    return String(error.data);
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Milliseconds left on a pending code, counted down without the browser's
 * wall clock. `timeLeft` answers once, by the server's clock, when the code
 * loads; from then on `performance.now()` (monotonic) measures the time
 * passed. A skewed browser clock therefore cannot show a live code as
 * expired or the reverse. Undefined until the server answers, null when the
 * code is not pending. The server still enforces expiry on approve and deny.
 */
function useTimeLeft(code: string): number | null | undefined {
  const timeLeft = useAction(api.companionPairing.timeLeft);
  const [deadline, setDeadline] = useState<number | null | undefined>(undefined);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    let cancelled = false;
    setDeadline(undefined);
    const askedAt = performance.now();
    timeLeft({ userCode: code })
      .then((remaining) => {
        if (!cancelled) {
          setDeadline(remaining === null ? null : askedAt + remaining);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDeadline(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, timeLeft]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  if (deadline === undefined || deadline === null) {
    return deadline;
  }
  return Math.max(0, deadline - now);
}

function PairShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-primary-foreground">
            <MonitorPlay className="h-5 w-5" />
          </div>
          <span className="font-bold text-2xl tracking-tight">woofx3</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function CodeEntry({ invalidCode }: { invalidCode: boolean }) {
  const [, navigate] = useLocation();
  const [value, setValue] = useState("");
  const normalized = normalizeUserCode(value);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!normalized) {
      return;
    }
    navigate(`/companion/pair?code=${formatUserCode(normalized)}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pair the companion</CardTitle>
        <CardDescription>Enter the code shown in the woofx3 companion on your computer.</CardDescription>
      </CardHeader>
      <form onSubmit={submit}>
        <CardContent className="space-y-3">
          {invalidCode && (
            <p className="text-sm text-destructive" data-testid="text-invalid-code">
              That link does not carry a valid pairing code.
            </p>
          )}
          <Label htmlFor="pairing-code">Pairing code</Label>
          <Input
            id="pairing-code"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="XXXX-XXXX"
            autoComplete="off"
            className="font-mono text-lg tracking-widest uppercase"
            data-testid="input-pairing-code"
          />
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={!normalized} data-testid="button-continue">
            Continue
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function Outcome({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        {icon}
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function ExpiredOutcome() {
  return (
    <Outcome
      icon={<XCircle className="h-10 w-10 text-muted-foreground" />}
      title="Code expired"
      description="This code has expired. Start pairing again from the companion."
    />
  );
}

interface PendingPairing {
  deviceName?: string;
  companionVersion?: string;
  createdAt?: number;
}

function PendingApproval({ code, pairing, msLeft }: { code: string; pairing: PendingPairing; msLeft: number | null }) {
  const instances = useQuery(api.companionPairing.approvableInstances);
  const approve = useMutation(api.companionPairing.approve);
  const deny = useMutation(api.companionPairing.deny);
  const [chosen, setChosen] = useState<Id<"instances"> | null>(null);
  const [codeMatches, setCodeMatches] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onlyInstance = instances?.length === 1 ? instances[0].instanceId : null;
  const instanceId = chosen ?? onlyInstance;

  // An instance has one companion, so approving may replace another device.
  // The confirmation is keyed to the companion it was given for, so choosing
  // another instance, or the companion changing meanwhile, asks again.
  const replacement = useQuery(
    api.companionPairing.replacementForApproval,
    instanceId ? { userCode: code, instanceId } : "skip"
  );
  const replacementKey = replacement && instanceId ? `${instanceId}:${replacement.pairedAt}` : null;
  const [replaceConfirmedFor, setReplaceConfirmedFor] = useState<string | null>(null);
  const replaceSettled = replacement === null || (replacementKey !== null && replaceConfirmedFor === replacementKey);

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    try {
      const refusal = await action();
      if (refusal) {
        setError(refusal);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (instances === undefined) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const secondsLeft = msLeft === null ? null : Math.ceil(msLeft / 1000);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pair a companion</CardTitle>
        <CardDescription>A woofx3 companion is asking to connect to one of your instances.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/40 py-4 text-center">
          <p className="font-mono text-3xl font-semibold tracking-[0.2em]" data-testid="text-pairing-code">
            {code}
          </p>
          {secondsLeft !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
            </p>
          )}
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Device</dt>
          <dd className="break-all" data-testid="text-device-name">
            {pairing.deviceName}
            <span className="block text-xs text-muted-foreground">Reported by the device</span>
          </dd>
          <dt className="text-muted-foreground">Version</dt>
          <dd>{pairing.companionVersion}</dd>
          {pairing.createdAt !== undefined && (
            <>
              <dt className="text-muted-foreground">Started</dt>
              <dd>{formatDistanceToNow(new Date(pairing.createdAt), { addSuffix: true })}</dd>
            </>
          )}
        </dl>

        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>
            Only approve this if you started pairing on your own computer just now. An approved companion can act on
            this instance.
          </AlertDescription>
        </Alert>

        {instances.length === 0 ? (
          <div className="space-y-2 text-sm" data-testid="text-no-instances">
            <p>You need to be an admin of an instance to pair a companion.</p>
            <p className="text-muted-foreground">
              No instance yet?{" "}
              <Link href="/setup" className="text-primary hover:underline">
                Set one up
              </Link>
              .
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <Label htmlFor="pair-instance">Instance</Label>
              <Select value={instanceId ?? undefined} onValueChange={(value) => setChosen(value as Id<"instances">)}>
                <SelectTrigger id="pair-instance" data-testid="select-instance">
                  <SelectValue placeholder="Choose an instance" />
                </SelectTrigger>
                <SelectContent>
                  {instances.map((instance) => (
                    <SelectItem key={instance.instanceId} value={instance.instanceId}>
                      {instance.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="code-matches"
                checked={codeMatches}
                onCheckedChange={(checked) => setCodeMatches(checked === true)}
                data-testid="checkbox-code-matches"
              />
              <Label htmlFor="code-matches" className="text-sm font-normal leading-snug">
                This matches the code shown in the companion on my computer
              </Label>
            </div>
            {replacement && replacementKey && (
              <Alert variant="destructive" data-testid="alert-replaces-companion">
                <AlertDescription className="space-y-3">
                  <p>
                    This replaces the companion on <strong>{replacement.deviceName}</strong>, last seen{" "}
                    {replacement.lastSeenAt === null
                      ? "never"
                      : formatDistanceToNow(new Date(replacement.lastSeenAt), { addSuffix: true })}
                    . An instance has one companion; that computer is unpaired at once.
                  </p>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="replace-companion"
                      checked={replaceConfirmedFor === replacementKey}
                      onCheckedChange={(checked) => setReplaceConfirmedFor(checked === true ? replacementKey : null)}
                      data-testid="checkbox-replace-companion"
                    />
                    <Label htmlFor="replace-companion" className="text-sm font-normal leading-snug">
                      Replace the companion on {replacement.deviceName}
                    </Label>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const result = await deny({ userCode: code });
              return result.ok ? null : result.message;
            })
          }
          data-testid="button-decline"
        >
          Decline
        </Button>
        {instances.length > 0 && (
          <Button
            className="flex-1"
            disabled={busy || !instanceId || !codeMatches || !replaceSettled}
            onClick={() => {
              if (instanceId) {
                void run(async () => {
                  await approve({ userCode: code, instanceId });
                  return null;
                });
              }
            }}
            data-testid="button-approve"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function PairingForCode({ code }: { code: string }) {
  const pairing = useQuery(api.companionPairing.getForApproval, { userCode: code });
  const msLeft = useTimeLeft(code);

  if (pairing === undefined) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (pairing === null) {
    return <CodeEntry invalidCode />;
  }
  switch (pairing.status) {
    case "approved":
      return (
        <Outcome
          icon={<CheckCircle2 className="h-10 w-10 text-primary" />}
          title="Approved"
          description="Confirm the pairing in the companion on your computer. You can close this tab."
        />
      );
    case "denied":
      return (
        <Outcome
          icon={<XCircle className="h-10 w-10 text-muted-foreground" />}
          title="Declined"
          description="You declined this pairing."
        />
      );
    case "cancelled":
      return (
        <Outcome
          icon={<XCircle className="h-10 w-10 text-muted-foreground" />}
          title="Cancelled"
          description="Pairing was cancelled in the companion. Start pairing again from the companion."
        />
      );
    case "unknown":
      return <ExpiredOutcome />;
    case "pending":
      if (msLeft === 0) {
        return <ExpiredOutcome />;
      }
      return <PendingApproval code={code} pairing={pairing} msLeft={msLeft ?? null} />;
  }
}

export default function CompanionPair() {
  const search = useSearch();
  const rawCode = new URLSearchParams(search).get("code");
  const normalized = rawCode ? normalizeUserCode(rawCode) : null;

  return (
    <PairShell>
      {normalized ? <PairingForCode code={formatUserCode(normalized)} /> : <CodeEntry invalidCode={rawCode !== null} />}
    </PairShell>
  );
}
