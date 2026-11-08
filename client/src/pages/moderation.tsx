import type {
  BannedPhrasesParams,
  FilterId,
  LinksParams,
  ModerationAction,
  ModerationActionKind,
  ModerationConfig,
  ModerationRule,
  RepetitionParams,
  ShareParams,
} from "@woofx3/api/moderation-config";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useModerationConfig, useRecentModerationActions } from "@/engine/hooks/use-chat-moderation";
import { useToast } from "@/hooks/use-toast";
import { useTwitchIntegration } from "@/hooks/use-twitch-integration";
import {
  ACTION_NAMES,
  actionsMissingScope,
  canSaveConfig,
  configActionsMissingScope,
  configProblem,
  FILTER_COPY,
  FILTER_ORDER,
  needsBanConfirm,
  OUTCOME_LABELS,
  parseNameList,
  phraseProblem,
  RECONNECT_MESSAGES,
  ruleOf,
  TIMEOUT_CHOICES,
  toggleAction,
  withRule,
} from "@/lib/chat-moderation-form";
import { useLogger } from "@/lib/logger-context";

/** The chat moderation page: what the engine filters in chat, and what it does about it. */
export default function Moderation() {
  const { read, save } = useModerationConfig();
  const { toast } = useToast();
  const logger = useLogger().scoped("moderation");
  const { twitchLink } = useTwitchIntegration();
  // Unknown until the link loads, so no prompt flashes before it does.
  const granted = twitchLink?.scopes ?? null;
  const [draft, setDraft] = useState<ModerationConfig | null>(null);
  const [saving, setSaving] = useState(false);

  const stored = read.data?.kind === "ready" ? read.data.config : null;
  useEffect(() => {
    setDraft(stored);
  }, [stored]);

  if (read.error !== null) {
    return (
      <Page>
        <p className="text-sm text-destructive">Could not load chat moderation: {read.error}</p>
      </Page>
    );
  }
  if (read.data?.kind === "unsupported") {
    return (
      <Page>
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground" data-testid="moderation-unsupported">
            Your engine needs an update before it can moderate chat.
          </CardContent>
        </Card>
      </Page>
    );
  }
  if (draft === null || stored === null) {
    return (
      <Page>
        <Skeleton className="h-40 w-full" />
      </Page>
    );
  }

  const problem = configProblem(draft);
  const changed = JSON.stringify(draft) !== JSON.stringify(stored);
  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      toast({ title: "Chat moderation saved" });
    } catch (error) {
      // The engine's words name the config's paths, so they go to the log, not the streamer.
      logger.error("Couldn't save chat moderation", { error });
      toast({
        title: "Could not save chat moderation",
        description: "Your changes are still on this page. Try saving again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page
      actions={
        <Button onClick={onSave} disabled={!changed || !canSaveConfig(draft) || saving} data-testid="moderation-save">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
      }
    >
      {problem !== null ? (
        <p className="mb-4 text-sm text-destructive" data-testid="moderation-problem">
          {problem}
        </p>
      ) : null}
      <div className="space-y-4">
        {granted !== null ? <ReconnectBanner missing={configActionsMissingScope(draft, granted)} /> : null}
        <GeneralCard config={draft} onChange={setDraft} />
        {FILTER_ORDER.map((filter) => (
          <FilterCard
            key={filter}
            filter={filter}
            rule={ruleOf(draft, filter)}
            granted={granted}
            onChange={(rule) => setDraft(withRule(draft, filter, rule))}
          />
        ))}
        <RecentActionsCard />
      </div>
    </Page>
  );
}

function Page({ actions, children }: { actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <PageHeader
        title="Chat moderation"
        description="Filters that run on every chat message. A caught message is removed within about a second of being posted."
        actions={actions}
      />
      {children}
    </div>
  );
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} data-testid={id} />
    </div>
  );
}

function CheckRow({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
        data-testid={id}
      />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

function GeneralCard({ config, onChange }: { config: ModerationConfig; onChange: (config: ModerationConfig) => void }) {
  const exempt = config.exempt;
  const [names, setNames] = useState(exempt.allowLogins.join("\n"));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">General</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <SwitchRow
          id="moderation-enabled"
          label="Moderate chat"
          checked={config.enabled}
          onChange={(enabled) => onChange({ ...config, enabled })}
        />
        <SwitchRow
          id="moderation-dry-run"
          label="Test mode"
          description="Record what would have been caught, but do nothing in chat."
          checked={config.dryRun}
          onChange={(dryRun) => onChange({ ...config, dryRun })}
        />
        <div className="space-y-2">
          <p className="text-sm font-medium">Never moderate</p>
          <p className="text-sm text-muted-foreground">You are never moderated.</p>
          <CheckRow
            id="exempt-moderators"
            label="Moderators"
            checked={exempt.moderators}
            onChange={(moderators) => onChange({ ...config, exempt: { ...exempt, moderators } })}
          />
          <CheckRow
            id="exempt-vips"
            label="VIPs"
            checked={exempt.vips}
            onChange={(vips) => onChange({ ...config, exempt: { ...exempt, vips } })}
          />
          <CheckRow
            id="exempt-subscribers"
            label="Subscribers"
            checked={exempt.subscribers}
            onChange={(subscribers) => onChange({ ...config, exempt: { ...exempt, subscribers } })}
          />
          <Label htmlFor="exempt-names">These viewers, one name per line</Label>
          <Textarea
            id="exempt-names"
            value={names}
            onChange={(event) => {
              setNames(event.target.value);
              onChange({ ...config, exempt: { ...exempt, allowLogins: parseNameList(event.target.value) } });
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

const ACTION_LABELS: Record<ModerationActionKind, string> = {
  delete: "Remove the message",
  warn: "Warn the viewer",
  timeout: "Time the viewer out",
  ban: "Ban the viewer",
};

function ReconnectLink() {
  return (
    <Link href="/admin/integrations" className="text-primary underline-offset-2 hover:underline">
      Reconnect Twitch
    </Link>
  );
}

function ReconnectBanner({ missing }: { missing: readonly ModerationActionKind[] }) {
  if (missing.length === 0) {
    return null;
  }
  return (
    <Card className="border-amber-500/50" data-testid="moderation-reconnect">
      <CardContent className="space-y-1 py-4 text-sm">
        {missing.map((kind) => (
          <p key={kind}>{RECONNECT_MESSAGES[kind]}</p>
        ))}
        <p className="text-muted-foreground">
          Until then those steps are skipped and the rest still run. <ReconnectLink />
        </p>
      </CardContent>
    </Card>
  );
}

function FilterCard({
  filter,
  rule,
  granted,
  onChange,
}: {
  filter: FilterId;
  rule: ModerationRule;
  /** The Twitch link's scopes; null while unknown. */
  granted: readonly string[] | null;
  onChange: (rule: ModerationRule) => void;
}) {
  const copy = FILTER_COPY[filter];
  return (
    <Card data-testid={`filter-${filter}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-lg">{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </div>
        <Switch
          checked={rule.enabled}
          onCheckedChange={(enabled) => onChange({ ...rule, enabled })}
          aria-label={`${copy.title} on or off`}
          data-testid={`filter-${filter}-enabled`}
        />
      </CardHeader>
      {rule.enabled ? (
        <CardContent className="space-y-4">
          <FilterParams filter={filter} params={rule.params} onChange={(params) => onChange({ ...rule, params })} />
          <ActionsEditor
            filter={filter}
            actions={rule.actions}
            missingScope={granted === null ? [] : actionsMissingScope(rule.actions, granted)}
            onChange={(actions) => onChange({ ...rule, actions })}
          />
        </CardContent>
      ) : null}
    </Card>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        className="w-32"
        value={Number.isNaN(value) ? "" : value}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    </div>
  );
}

/** Each filter's own settings. The params arrive as the shared parser shaped them for that filter. */
function FilterParams({
  filter,
  params,
  onChange,
}: {
  filter: FilterId;
  params: unknown;
  onChange: (params: unknown) => void;
}) {
  switch (filter) {
    case "links": {
      return <LinksParamsEditor params={params as LinksParams} onChange={onChange} />;
    }
    case "banned_phrases": {
      return <PhrasesEditor params={params as BannedPhrasesParams} onChange={onChange} />;
    }
    case "repetition": {
      const value = params as RepetitionParams;
      return (
        <div className="flex flex-wrap gap-4">
          <NumberField
            id="repetition-repeats"
            label="Same message allowed this many times"
            value={value.maxRepeats}
            onChange={(maxRepeats) => onChange({ ...value, maxRepeats })}
          />
          <NumberField
            id="repetition-window"
            label="Within this many seconds"
            value={value.windowSeconds}
            onChange={(windowSeconds) => onChange({ ...value, windowSeconds })}
          />
          <NumberField
            id="repetition-length"
            label="Ignore messages shorter than"
            value={value.minLength}
            onChange={(minLength) => onChange({ ...value, minLength })}
          />
        </div>
      );
    }
    case "caps":
    case "symbols": {
      const value = params as ShareParams;
      return (
        <div className="flex flex-wrap gap-4">
          <NumberField
            id={`${filter}-percent`}
            label="Catch above this percent"
            value={value.maxPercent}
            onChange={(maxPercent) => onChange({ ...value, maxPercent })}
          />
          <NumberField
            id={`${filter}-length`}
            label="Ignore messages shorter than"
            value={value.minLength}
            onChange={(minLength) => onChange({ ...value, minLength })}
          />
        </div>
      );
    }
  }
}

function LinksParamsEditor({ params, onChange }: { params: LinksParams; onChange: (params: LinksParams) => void }) {
  const [sites, setSites] = useState(params.allowDomains.join("\n"));
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="links-allowed">Allowed websites, one per line</Label>
        <p className="text-sm text-muted-foreground">
          A website also allows its subdomains: allowing example.com allows clips.example.com.
        </p>
        <Textarea
          id="links-allowed"
          value={sites}
          onChange={(event) => {
            setSites(event.target.value);
            onChange({ ...params, allowDomains: parseNameList(event.target.value) });
          }}
        />
      </div>
      <NumberField
        id="links-permit"
        label="Seconds a viewer may post links after a moderator types !permit and their name"
        value={params.permitSeconds}
        onChange={(permitSeconds) => onChange({ ...params, permitSeconds })}
      />
    </div>
  );
}

function PhrasesEditor({
  params,
  onChange,
}: {
  params: BannedPhrasesParams;
  onChange: (params: BannedPhrasesParams) => void;
}) {
  const set = (index: number, phrase: BannedPhrasesParams["phrases"][number]) =>
    onChange({ phrases: params.phrases.map((existing, at) => (at === index ? phrase : existing)) });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Phrases ignore capitals, accents written in other forms, and hidden characters. Use * for any letters within a
        word, ? for exactly one letter, [ab] for one of a set of letters, and \b for the edge of a word.
      </p>
      {params.phrases.map((phrase, index) => {
        const problem = phraseProblem(phrase.pattern);
        return (
          // Phrases have no id of their own; their position is what the editor changes.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <div key={index} className="space-y-1" data-testid={`phrase-${index}`}>
            <div className="flex items-center gap-2">
              <Input
                value={phrase.pattern}
                aria-label="Banned phrase"
                onChange={(event) => set(index, { ...phrase, pattern: event.target.value })}
              />
              <CheckRow
                id={`phrase-${index}-whole`}
                label="Whole word"
                checked={phrase.wholeWord}
                onChange={(wholeWord) => set(index, { ...phrase, wholeWord })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove phrase"
                onClick={() => onChange({ phrases: params.phrases.filter((_, at) => at !== index) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {problem !== null ? <p className="text-sm text-destructive">{problem}</p> : null}
          </div>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange({ phrases: [...params.phrases, { pattern: "", wholeWord: true }] })}
      >
        <Plus className="mr-1 h-4 w-4" />
        Add phrase
      </Button>
    </div>
  );
}

function ActionsEditor({
  filter,
  actions,
  missingScope,
  onChange,
}: {
  filter: FilterId;
  actions: ModerationAction[];
  /** Chosen actions the Twitch link cannot perform yet. */
  missingScope: readonly ModerationActionKind[];
  onChange: (actions: ModerationAction[]) => void;
}) {
  const [confirmingBan, setConfirmingBan] = useState(false);
  const has = (kind: ModerationActionKind) => actions.some((action) => action.kind === kind);
  const toggle = (kind: ModerationActionKind, on: boolean) => {
    if (needsBanConfirm(actions, kind, on)) {
      setConfirmingBan(true);
      return;
    }
    onChange(toggleAction(actions, kind, on));
  };
  const update = (next: ModerationAction) =>
    onChange(actions.map((action) => (action.kind === next.kind ? next : action)));

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">When a message is caught</p>
      {(["delete", "warn", "timeout", "ban"] as const).map((kind) => (
        <div key={kind} className="space-y-1">
          <CheckRow
            id={`${filter}-action-${kind}`}
            label={ACTION_LABELS[kind]}
            checked={has(kind)}
            onChange={(on) => toggle(kind, on)}
          />
          {missingScope.includes(kind) ? (
            <p className="ml-6 text-sm text-amber-600" data-testid={`${filter}-action-${kind}-reconnect`}>
              {RECONNECT_MESSAGES[kind]} <ReconnectLink />
            </p>
          ) : null}
          {actions.map((action) => {
            if (action.kind !== kind) {
              return null;
            }
            if (action.kind === "warn") {
              return (
                <Input
                  key="reason"
                  className="ml-6 w-auto"
                  value={action.reason}
                  aria-label="What the warning tells the viewer"
                  onChange={(event) => update({ kind: "warn", reason: event.target.value })}
                />
              );
            }
            if (action.kind === "timeout") {
              return (
                <div key="duration" className="ml-6 w-48">
                  <Select
                    value={String(action.durationSeconds)}
                    onValueChange={(value) => update({ kind: "timeout", durationSeconds: Number(value) })}
                  >
                    <SelectTrigger aria-label="How long">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEOUT_CHOICES.map((choice) => (
                        <SelectItem key={choice.seconds} value={String(choice.seconds)}>
                          {choice.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            }
            return null;
          })}
        </div>
      ))}
      <p className="text-sm text-muted-foreground">A timeout and a ban cannot both be chosen.</p>
      <AlertDialog open={confirmingBan} onOpenChange={setConfirmingBan}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ban viewers caught by this filter?</AlertDialogTitle>
            <AlertDialogDescription>
              A ban lasts until you lift it. Try test mode first to see what this filter would catch.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onChange(toggleAction(actions, "ban", true))}
              data-testid={`${filter}-confirm-ban`}
            >
              Ban
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** How many moderated lines the table shows. */
const RECENT_ACTIONS_SHOWN = 50;

function RecentActionsCard() {
  const recent = useRecentModerationActions(RECENT_ACTIONS_SHOWN);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-lg">Recent actions</CardTitle>
          <CardDescription>The latest messages chat moderation caught, newest first.</CardDescription>
        </div>
        <Button variant="ghost" size="icon" aria-label="Refresh" onClick={recent.refetch}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {recent.error !== null ? <p className="text-sm text-destructive">{recent.error}</p> : null}
        {recent.data === undefined && recent.error === null ? <Skeleton className="h-20 w-full" /> : null}
        {recent.data?.length === 0 ? <p className="text-sm text-muted-foreground">Nothing caught yet.</p> : null}
        {recent.data !== undefined && recent.data.length > 0 ? (
          <Table data-testid="moderation-recent">
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Viewer</TableHead>
                <TableHead>Why</TableHead>
                <TableHead>What happened</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.data.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="whitespace-nowrap">{new Date(record.time).toLocaleString()}</TableCell>
                  <TableCell>
                    <div>{record.chatterLogin}</div>
                    <div className="max-w-xs truncate text-xs text-muted-foreground">{record.text}</div>
                  </TableCell>
                  <TableCell>
                    {FILTER_COPY[record.filter].title}: {record.reason}
                  </TableCell>
                  <TableCell>
                    {record.steps.map((step) => (
                      <div key={step.kind}>
                        {ACTION_NAMES[step.kind]}: {OUTCOME_LABELS[step.outcome]}
                      </div>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
