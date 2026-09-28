import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  fieldTokenNames,
  STARTER_FEATURES,
  STARTER_PACKS,
  type StarterFieldValues,
  type StarterPack,
  type StarterPackField,
  starterFieldWarning,
  starterPackDefaults,
  validateStarterValues,
} from "@convex/lib/starterPacks";
import type { StarterInstallOutcome } from "@convex/starterPacks";
import { useAction, useQuery } from "convex/react";
import {
  Check,
  Clapperboard,
  Gem,
  Heart,
  Loader2,
  type LucideIcon,
  MessageSquare,
  Package,
  PartyPopper,
  Rocket,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import {
  type StarterItemView,
  type StarterPackSummary,
  starterItemTitle,
  starterItemTrigger,
  starterItemView,
  starterPackSummary,
  starterStepLabel,
} from "@/lib/starter-pack-view";

const PACK_ICONS: Record<string, LucideIcon> = {
  "raid-welcome": Rocket,
  "follower-thanks": Heart,
  "sub-hype": PartyPopper,
  "cheer-thanks": Gem,
  "handy-commands": MessageSquare,
  "brb-scene": Clapperboard,
};

type PackViews = { pack: StarterPack; views: StarterItemView[]; summary: StarterPackSummary };

export default function StarterPacks() {
  const { instance, catalogTriggers, catalogActions, loading: catalogLoading } = useWorkflowCatalog();
  const states = useQuery(api.starterPacks.status, instance ? { instanceId: instance._id } : "skip");
  const [openPackId, setOpenPackId] = useState<string | null>(null);

  const packs = useMemo<PackViews[]>(() => {
    const catalog = { triggers: catalogTriggers, actions: catalogActions };
    return STARTER_PACKS.map((pack) => {
      const views = pack.items.map((item) => starterItemView(pack, item, catalog, states ?? {}));
      return { pack, views, summary: starterPackSummary(views) };
    });
  }, [catalogTriggers, catalogActions, states]);

  const loading = catalogLoading || (!!instance && states === undefined);
  const open = packs.find((entry) => entry.pack.id === openPackId) ?? null;

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Starter Packs"
        description="Ready-made workflows and chat commands for the things every stream does. Adjust the wording, install in one click, and edit them later like any other."
      />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {STARTER_PACKS.map((pack) => (
            <Skeleton key={pack.id} className="h-56" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {packs.map((entry) => (
            <PackCard key={entry.pack.id} entry={entry} onOpen={() => setOpenPackId(entry.pack.id)} />
          ))}
        </div>
      )}

      {open && instance && (
        <InstallDialog key={open.pack.id} instanceId={instance._id} entry={open} onClose={() => setOpenPackId(null)} />
      )}
    </div>
  );
}

function PackStatusBadge({ summary }: { summary: StarterPackSummary }) {
  if (summary.installed === summary.total) {
    return (
      <Badge variant="secondary" className="gap-1">
        <Check className="h-3 w-3" />
        Installed
      </Badge>
    );
  }
  if (summary.blockedReason) {
    return <Badge variant="outline">{summary.blockedReason}</Badge>;
  }
  if (summary.installed > 0) {
    return (
      <Badge variant="outline">
        {summary.installed} of {summary.total} installed
      </Badge>
    );
  }
  return null;
}

function PackCard({ entry, onOpen }: { entry: PackViews; onOpen: () => void }) {
  const { pack, summary } = entry;
  const Icon = PACK_ICONS[pack.id] ?? Package;
  const fullyInstalled = summary.installed === summary.total;

  return (
    <Card className="p-5 flex flex-col gap-4" data-testid={`card-starter-pack-${pack.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5" />
          </div>
          <h2 className="font-semibold">{pack.name}</h2>
        </div>
        <PackStatusBadge summary={summary} />
      </div>
      <p className="text-sm text-muted-foreground flex-1">{pack.why}</p>
      <ul className="text-sm space-y-1">
        {pack.items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-muted-foreground">
            {item.kind === "workflow" ? (
              <WorkflowIcon className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{starterItemTitle(item)}</span>
          </li>
        ))}
      </ul>
      <Button
        variant={fullyInstalled ? "outline" : "default"}
        onClick={onOpen}
        disabled={summary.blockedReason !== null && summary.installed === 0}
        data-testid={`button-open-starter-pack-${pack.id}`}
      >
        {fullyInstalled ? "View" : summary.blockedReason && summary.installed === 0 ? summary.blockedReason : "Set up"}
      </Button>
    </Card>
  );
}

function ItemStateBadge({ view }: { view: StarterItemView }) {
  switch (view.state) {
    case "installed":
      return (
        <Badge variant="secondary" className="gap-1">
          <Check className="h-3 w-3" />
          Installed
        </Badge>
      );
    case "installing":
      return <Badge variant="outline">Installing</Badge>;
    case "ready":
      return <Badge variant="outline">Will be created</Badge>;
    case "conflict":
    case "unavailable":
      return <Badge variant="outline">{view.reason}</Badge>;
  }
}

type DraftValues = Record<string, string | number>;

function FieldInput({
  pack,
  field,
  value,
  error,
  onChange,
}: {
  pack: StarterPack;
  field: StarterPackField;
  value: string | number;
  error: string | undefined;
  onChange: (value: string | number) => void;
}) {
  const inputId = `starter-field-${pack.id}-${field.id}`;
  const tokens = field.type === "text" ? fieldTokenNames(pack, field.id) : [];
  const unsupported = field.requires !== undefined && !STARTER_FEATURES[field.requires];
  const warning = starterFieldWarning(field, value);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>{field.label}</Label>
      {field.type === "number" ? (
        <Input
          id={inputId}
          type="number"
          min={field.min}
          max={field.max}
          value={Number.isNaN(value) ? "" : value}
          onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
          disabled={unsupported}
          className="max-w-[10rem]"
        />
      ) : tokens.length > 0 ? (
        <Textarea id={inputId} rows={2} value={String(value)} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={inputId} value={String(value)} onChange={(e) => onChange(e.target.value)} />
      )}
      {tokens.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>Placeholders:</span>
          {tokens.map((token) => (
            <button
              key={token}
              type="button"
              className="rounded border px-1.5 py-0.5 font-mono hover:bg-muted"
              onClick={() => onChange(`${String(value)}{${token}}`)}
            >
              {`{${token}}`}
            </button>
          ))}
        </div>
      )}
      {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
      {unsupported && <p className="text-xs text-muted-foreground">Requires engine update.</p>}
      {warning && <p className="text-xs text-amber-600 dark:text-amber-400">{warning}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ItemPreview({ entry, values }: { entry: PackViews; values: StarterFieldValues }) {
  return (
    <ul className="space-y-2">
      {entry.pack.items.map((item, index) => {
        const steps = item.steps
          .map((step) => starterStepLabel(step, values))
          .filter((label): label is string => label !== null);
        return (
          <li key={item.id} className="rounded-md border p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-medium text-sm">
                {item.kind === "workflow" ? (
                  <WorkflowIcon className="h-3.5 w-3.5" />
                ) : (
                  <MessageSquare className="h-3.5 w-3.5" />
                )}
                {item.kind === "workflow" ? "Workflow" : "Command"}: {starterItemTitle(item)}
              </span>
              <ItemStateBadge view={entry.views[index]} />
            </div>
            <p className="text-xs text-muted-foreground">
              {starterItemTrigger(item)}
              {" → "}
              {steps.join(" → ")}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

interface OutcomeSummary {
  title: string;
  /** Items that did not install. */
  problems: string[];
  /** Items the engine is still confirming. */
  notices: string[];
}

function outcomeSummary(pack: StarterPack, results: StarterInstallOutcome[]): OutcomeSummary {
  const describe = (result: StarterInstallOutcome) => {
    const item = pack.items.find((candidate) => candidate.id === result.itemId);
    return `${item ? starterItemTitle(item) : result.itemId}: ${result.message ?? result.outcome}`;
  };
  const installed = results.filter((result) => result.outcome === "installed").length;
  const problems = results.filter((result) => result.outcome === "failed" || result.outcome === "busy").map(describe);
  const notices = results.filter((result) => result.outcome === "pending").map(describe);
  if (installed === 0) {
    const title =
      problems.length > 0
        ? "Nothing was installed"
        : notices.length > 0
          ? "Waiting on the engine"
          : "Already installed";
    return { title, problems, notices };
  }
  return { title: `Installed ${installed} item${installed === 1 ? "" : "s"}`, problems, notices };
}

function InstallDialog({
  instanceId,
  entry,
  onClose,
}: {
  instanceId: Id<"instances">;
  entry: PackViews;
  onClose: () => void;
}) {
  const { pack, summary } = entry;
  const { toast } = useToast();
  const install = useAction(api.starterPacks.install);
  const [draft, setDraft] = useState<DraftValues>(() => starterPackDefaults(pack));
  const [installing, setInstalling] = useState(false);

  const checked = useMemo(() => validateStarterValues(pack, draft, STARTER_FEATURES), [pack, draft]);
  const errors = checked.ok ? {} : checked.errors;
  const previewValues: StarterFieldValues = checked.ok ? checked.values : draft;

  async function handleInstall() {
    if (!checked.ok) {
      return;
    }
    setInstalling(true);
    try {
      const { results } = await install({ instanceId, packId: pack.id, values: checked.values });
      const { title, problems, notices } = outcomeSummary(pack, results);
      const lines = [...problems, ...notices];
      toast({
        title,
        description: lines.length > 0 ? lines.join("; ") : undefined,
        variant: problems.length > 0 ? "destructive" : undefined,
      });
      if (problems.length === 0) {
        onClose();
      }
    } catch (err) {
      toast({
        title: "Failed to install",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{pack.name}</DialogTitle>
          <DialogDescription>{pack.why}</DialogDescription>
        </DialogHeader>

        {pack.note && <p className="text-sm text-muted-foreground">{pack.note}</p>}

        {summary.ready > 0 && (
          <div className="space-y-4">
            {pack.fields.map((field) => (
              <FieldInput
                key={field.id}
                pack={pack}
                field={field}
                value={draft[field.id]}
                error={errors[field.id]}
                onChange={(value) => setDraft((current) => ({ ...current, [field.id]: value }))}
              />
            ))}
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-medium">What gets created</h3>
          <ItemPreview entry={entry} values={previewValues} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {summary.ready > 0 && (
            <Button
              onClick={() => void handleInstall()}
              disabled={!checked.ok || installing}
              data-testid="button-install-starter-pack"
            >
              {installing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Install {summary.ready} item{summary.ready === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
