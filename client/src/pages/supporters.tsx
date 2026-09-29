import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { SupporterMetric, SupporterStream } from "@convex/lib/supporters";
import { useAction, useMutation, useQuery } from "convex/react";
import { Copy, Gem, Gift, Loader2, Megaphone, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EngineFeatureGate } from "@/components/engine/engine-feature-gate";
import { PageHeader } from "@/components/layout/page-header";
import { TwitchUserCard } from "@/components/twitch/twitch-user-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useEngineCapabilities } from "@/hooks/use-engine-capabilities";
import { useInstance } from "@/hooks/use-instance";
import { toast } from "@/hooks/use-toast";
import { SUPPORTER_CAPABILITIES } from "@/lib/engine-capabilities";
import {
  formatMetricEvents,
  formatMetricTotal,
  LIFETIME,
  METRIC_LABELS,
  matchSupporters,
  parseMinTotal,
  parseRangeValue,
  type RankedSupporter,
  rangeSessionId,
  rangeValue,
  rankSupporters,
  reconcileRange,
  type SupporterRange,
  streamLabel,
  supporterErrorText,
  supporterName,
  thankYouLine,
} from "@/lib/supporters";

type InstanceId = Id<"instances">;

const MIN_TOTAL_DEBOUNCE_MS = 300;

interface SelectedViewer {
  platformUserId: string;
  userName: string | null;
}

interface Loaded<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
}

/**
 * The result of a Convex action, re-run whenever `key` changes. Actions have
 * no reactive subscription, and a slower answer to an older key must not
 * overwrite a newer one, so each run checks it is still current before
 * storing. A null key loads nothing.
 */
function useActionResult<T>(key: string | null, load: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: undefined, error: null, loading: key !== null });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names everything `load` reads.
  useEffect(() => {
    if (key === null) {
      setState({ data: undefined, error: null, loading: false });
      return;
    }
    let current = true;
    setState({ data: undefined, error: null, loading: true });
    load().then(
      (data) => {
        if (current) {
          setState({ data, error: null, loading: false });
        }
      },
      (err: unknown) => {
        if (current) {
          setState({ data: undefined, error: supporterErrorText(err), loading: false });
        }
      }
    );
    return () => {
      current = false;
    };
  }, [key]);

  return state;
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: text });
  } catch {
    toast({ title: "Could not copy", description: text, variant: "destructive" });
  }
}

export default function Supporters() {
  const { instance } = useInstance();
  const capabilities = useEngineCapabilities(instance?._id);

  return (
    <div className="p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader
        title="Supporters"
        description="The viewers who cheer and gift subs, all time or for one stream. Look anyone up before a thank-you or a VIP decision."
      />
      {instance ? (
        <EngineFeatureGate
          support={capabilities.support(...SUPPORTER_CAPABILITIES)}
          state={capabilities.state}
          feature="Supporter stats"
          onRetry={capabilities.refresh}
        >
          <SupportersView instanceId={instance._id} />
        </EngineFeatureGate>
      ) : (
        <p className="text-sm text-muted-foreground">No instance available yet.</p>
      )}
    </div>
  );
}

function SupportersView({ instanceId }: { instanceId: InstanceId }) {
  const listStreams = useAction(api.supporters.listStreams);
  const readLeaderboard = useAction(api.supporters.leaderboard);

  const [metric, setMetric] = useState<SupporterMetric>("bits");
  const [range, setRange] = useState<SupporterRange>(LIFETIME);
  const [minTotalInput, setMinTotalInput] = useState("");
  const [minTotal, setMinTotal] = useState(1);
  // Each keystroke would otherwise be a leaderboard read from the engine.
  const settledMinTotal = useDebouncedValue(minTotal, MIN_TOTAL_DEBOUNCE_MS);
  const [selected, setSelected] = useState<SelectedViewer | null>(null);

  const streams = useActionResult(instanceId, () => listStreams({ instanceId }));
  useEffect(() => {
    if (streams.data) {
      setRange((current) => reconcileRange(current, streams.data ?? []));
    }
  }, [streams.data]);

  const sessionId = rangeSessionId(range);
  const board = useActionResult(`${instanceId}|${metric}|${rangeValue(range)}|${settledMinTotal}`, () =>
    readLeaderboard({
      instanceId,
      metric,
      minTotal: settledMinTotal,
      ...(sessionId !== undefined ? { sessionId } : {}),
    })
  );
  const ranked = useMemo(() => rankSupporters(board.data ?? []), [board.data]);

  function changeMinTotal(input: string) {
    setMinTotalInput(input);
    const parsed = parseMinTotal(input);
    if (parsed !== null) {
      setMinTotal(parsed);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <LeaderboardCard
        metric={metric}
        onMetricChange={setMetric}
        range={range}
        onRangeChange={setRange}
        streams={streams}
        minTotalInput={minTotalInput}
        onMinTotalChange={changeMinTotal}
        board={board}
        ranked={ranked}
        onSelect={(supporter) =>
          setSelected({ platformUserId: supporter.platformUserId, userName: supporter.userName })
        }
        selectedId={selected?.platformUserId ?? null}
      />
      <ViewerCard instanceId={instanceId} ranked={ranked} selected={selected} onSelect={setSelected} />
    </div>
  );
}

function LeaderboardCard(props: {
  metric: SupporterMetric;
  onMetricChange: (metric: SupporterMetric) => void;
  range: SupporterRange;
  onRangeChange: (range: SupporterRange) => void;
  streams: Loaded<SupporterStream[]>;
  minTotalInput: string;
  onMinTotalChange: (input: string) => void;
  board: Loaded<unknown>;
  ranked: RankedSupporter[];
  onSelect: (supporter: RankedSupporter) => void;
  selectedId: string | null;
}) {
  const { metric, range, streams, board, ranked } = props;
  const scope = range.kind === "lifetime" ? "lifetime" : "stream";
  const minTotalInvalid = parseMinTotal(props.minTotalInput) === null;

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="space-y-1">
          <CardTitle>Top supporters</CardTitle>
          <CardDescription>
            Anonymous cheers and gifts count toward stream totals but never rank anyone.
          </CardDescription>
        </div>
        <Tabs value={metric} onValueChange={(value) => props.onMetricChange(value as SupporterMetric)}>
          <TabsList>
            <TabsTrigger value="bits" data-testid="tab-supporters-bits">
              <Gem className="h-4 w-4 mr-1.5" />
              {METRIC_LABELS.bits}
            </TabsTrigger>
            <TabsTrigger value="giftedSubs" data-testid="tab-supporters-gifted-subs">
              <Gift className="h-4 w-4 mr-1.5" />
              {METRIC_LABELS.giftedSubs}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="supporters-range">Range</Label>
            <Select value={rangeValue(range)} onValueChange={(value) => props.onRangeChange(parseRangeValue(value))}>
              <SelectTrigger id="supporters-range" className="w-64" data-testid="select-supporters-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={rangeValue(LIFETIME)}>Lifetime</SelectItem>
                {(streams.data ?? []).map((stream) => (
                  <SelectItem key={stream.id} value={rangeValue({ kind: "stream", sessionId: stream.id })}>
                    {streamLabel(stream)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supporters-min-total">{metric === "bits" ? "Cheered at least" : "Gifted at least"}</Label>
            <Input
              id="supporters-min-total"
              inputMode="numeric"
              placeholder="1"
              className="w-32"
              value={props.minTotalInput}
              onChange={(e) => props.onMinTotalChange(e.target.value)}
              aria-invalid={minTotalInvalid}
              data-testid="input-supporters-min-total"
            />
          </div>
        </div>
        {streams.error && <p className="text-sm text-destructive">{streams.error}</p>}
      </CardHeader>
      <CardContent>
        {board.error ? (
          <p className="text-sm text-destructive" data-testid="text-supporters-error">
            {board.error}
          </p>
        ) : board.loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading supporters
          </div>
        ) : ranked.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-supporters-empty">
            Nobody yet. Supporters appear here once they {metric === "bits" ? "cheer" : "gift a sub"}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Viewer</TableHead>
                  <TableHead className="text-right">{METRIC_LABELS[metric]}</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">
                    {metric === "bits" ? "Cheers" : "Gifts"}
                  </TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Copy thank-you</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranked.map((supporter) => {
                  const name = supporterName(supporter);
                  const line = thankYouLine(
                    name,
                    metric === "bits" ? { bits: supporter.total } : { giftedSubs: supporter.total },
                    scope
                  );
                  return (
                    <TableRow
                      key={supporter.platformUserId}
                      data-state={props.selectedId === supporter.platformUserId ? "selected" : undefined}
                      data-testid={`row-supporter-${supporter.platformUserId}`}
                    >
                      <TableCell className="tabular-nums text-muted-foreground">{supporter.rank}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="font-medium hover:underline underline-offset-4"
                          onClick={() => props.onSelect(supporter)}
                        >
                          {name}
                        </button>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{supporter.total.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground hidden sm:table-cell">
                        {formatMetricEvents(metric, supporter.events)}
                      </TableCell>
                      <TableCell>
                        {line && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title={`Copy a thank-you for ${formatMetricTotal(metric, supporter.total)}`}
                            aria-label={`Copy a thank-you for ${name}`}
                            onClick={() => void copyToClipboard(line)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ViewerCard({
  instanceId,
  ranked,
  selected,
  onSelect,
}: {
  instanceId: InstanceId;
  ranked: RankedSupporter[];
  selected: SelectedViewer | null;
  onSelect: (viewer: SelectedViewer) => void;
}) {
  const findTwitchViewer = useAction(api.supporters.findTwitchViewer);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const matches = useMemo(() => matchSupporters(ranked, query).slice(0, 5), [ranked, query]);

  async function lookUpLogin() {
    const login = query.trim();
    if (login === "") {
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const found = await findTwitchViewer({ instanceId, by: { login } });
      if (!found) {
        setSearchError(`No Twitch user called "${login.replace(/^@/, "")}".`);
        return;
      }
      onSelect({ platformUserId: found.twitchUserId, userName: found.displayName });
      setQuery("");
    } catch (err) {
      setSearchError(supporterErrorText(err));
    } finally {
      setSearching(false);
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="space-y-1">
          <CardTitle>Viewer lookup</CardTitle>
          <CardDescription>Pick a supporter, or look anyone up by their Twitch name.</CardDescription>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void lookUpLogin();
          }}
        >
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchError(null);
            }}
            placeholder="Twitch name"
            aria-label="Twitch name"
            data-testid="input-supporter-search"
          />
          <Button type="submit" variant="outline" disabled={searching || query.trim() === ""}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span className="sr-only">Look up on Twitch</span>
          </Button>
        </form>
        {matches.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {matches.map((supporter) => (
              <Button
                key={supporter.platformUserId}
                size="sm"
                variant="secondary"
                onClick={() => {
                  onSelect({ platformUserId: supporter.platformUserId, userName: supporter.userName });
                  setQuery("");
                }}
              >
                {supporterName(supporter)}
              </Button>
            ))}
          </div>
        )}
        {searchError && <p className="text-sm text-destructive">{searchError}</p>}
      </CardHeader>
      <CardContent>
        {selected ? (
          <ViewerDetail key={selected.platformUserId} instanceId={instanceId} viewer={selected} />
        ) : (
          <p className="text-sm text-muted-foreground">No viewer picked yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ViewerDetail({ instanceId, viewer }: { instanceId: InstanceId; viewer: SelectedViewer }) {
  const readViewerTotals = useAction(api.supporters.viewerTotals);
  const findTwitchViewer = useAction(api.supporters.findTwitchViewer);
  const enqueueShoutout = useMutation(api.shoutouts.enqueue);
  const canShoutOut = useQuery(api.supporters.canShoutOut, { instanceId });
  const [queueing, setQueueing] = useState(false);

  const totals = useActionResult(`${instanceId}|${viewer.platformUserId}`, () =>
    readViewerTotals({ instanceId, platformUserId: viewer.platformUserId })
  );
  const twitch = useActionResult(`${instanceId}|${viewer.platformUserId}`, () =>
    findTwitchViewer({ instanceId, by: { twitchUserId: viewer.platformUserId } })
  );

  const name =
    twitch.data?.displayName ?? totals.data?.userName ?? viewer.userName ?? `Viewer ${viewer.platformUserId}`;
  const lifetime = totals.data?.lifetime;
  const thanks = lifetime ? thankYouLine(name, lifetime, "lifetime") : null;

  const shoutOut = useCallback(async () => {
    const user = twitch.data;
    if (!user) {
      return;
    }
    setQueueing(true);
    try {
      await enqueueShoutout({
        instanceId,
        twitchUserId: user.twitchUserId,
        login: user.login,
        displayName: user.displayName,
        profileImageUrl: user.profileImageUrl,
        broadcasterType: user.broadcasterType,
      });
      toast({
        title: "Shoutout queued",
        description: `${user.displayName} is shouted out when Twitch's cooldown allows.`,
      });
    } catch (err) {
      toast({ title: "Could not queue the shoutout", description: supporterErrorText(err), variant: "destructive" });
    } finally {
      setQueueing(false);
    }
  }, [enqueueShoutout, instanceId, twitch.data]);

  return (
    <div className="space-y-5" data-testid="viewer-detail">
      {twitch.data ? (
        <TwitchUserCard user={twitch.data} />
      ) : (
        <div className="rounded-md border border-border p-3">
          <span className="text-sm font-semibold">{name}</span>
          {twitch.error && <p className="mt-1 text-xs text-muted-foreground">{twitch.error}</p>}
          {!twitch.loading && !twitch.error && twitch.data === null && (
            <p className="mt-1 text-xs text-muted-foreground">Twitch no longer has this account.</p>
          )}
        </div>
      )}

      {totals.error ? (
        <p className="text-sm text-destructive">{totals.error}</p>
      ) : totals.loading || !totals.data || !lifetime ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading totals
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Bits, lifetime" value={lifetime.bits} detail={formatMetricEvents("bits", lifetime.cheers)} />
            <Stat
              label="Gifted subs, lifetime"
              value={lifetime.giftedSubs}
              detail={formatMetricEvents("giftedSubs", lifetime.gifts)}
            />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Recent streams</h3>
            {totals.data.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No streams yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stream</TableHead>
                    <TableHead className="text-right">Bits</TableHead>
                    <TableHead className="text-right">Gifted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {totals.data.recent.map(({ stream, totals: streamTotals }) => (
                    <TableRow key={stream.id}>
                      <TableCell className="text-xs">{streamLabel(stream)}</TableCell>
                      <TableCell className="text-right tabular-nums">{streamTotals.bits.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {streamTotals.giftedSubs.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={thanks === null}
          onClick={() => thanks && void copyToClipboard(thanks)}
          data-testid="button-copy-thank-you"
        >
          <Copy className="h-4 w-4 mr-2" />
          Copy thank-you
        </Button>
        <Button
          disabled={!twitch.data || canShoutOut !== true || queueing}
          onClick={() => void shoutOut()}
          data-testid="button-shout-out"
        >
          {queueing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Megaphone className="h-4 w-4 mr-2" />}
          Shout out
        </Button>
      </div>
      {canShoutOut === false && (
        <p className="text-xs text-muted-foreground" data-testid="text-shoutout-unavailable">
          To shout out from here, reconnect Twitch in Settings → Integrations and grant the shoutout permission.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
