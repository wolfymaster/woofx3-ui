import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { chunkText } from "@convex/lib/configBundle";
import { decodeFirebotFile, decodeStreamerbotExport, ImportFileError } from "@convex/lib/setupImport/decode";
import { IMPORT_SOURCE_LABELS, type ImportSource } from "@convex/lib/setupImport/types";
import type { ImportReport } from "@convex/setupImports";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { FileUp, Loader2, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { applyProgress, canRetry, importFileProblem, reviewSummary } from "@/lib/setup-import";
import { ImportReportView } from "./import-report-view";

const SOURCE_HELP: Record<ImportSource, { steps: string[]; accept: string; chooseLabel: string }> = {
  firebot: {
    steps: [
      "In Firebot, open Setups and choose Create New Setup.",
      "Add everything you want to bring over (commands, events, timers, scheduled tasks, counters, preset effect lists and roles) and save the .firebotsetup file.",
      "Or skip that and choose a backup: Settings > Backups > Open Backups Folder, then pick the newest .zip.",
    ],
    accept: ".firebotsetup,.json,.zip",
    chooseLabel: "Choose setup or backup",
  },
  streamerbot: {
    steps: [
      "In Streamer.bot, open the Actions tab, select every action you want (Ctrl+A selects all), right-click and choose Export.",
      "The commands and timed actions those actions use come along with them.",
      "Copy the export string and paste it below, or save it to a file and choose that.",
    ],
    accept: ".sb,.txt",
    chooseLabel: "Choose export file",
  },
};

function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    return String(error.data);
  }
  return error instanceof Error ? error.message : String(error);
}

interface SetupImportPanelProps {
  instanceId: Id<"instances">;
  /** Whether the viewer may import: owners and admins only. */
  canImport: boolean;
  /** Called once an import has been queued, so a wizard can move on while it applies. */
  onQueued?: () => void;
}

/**
 * Bring a setup over from Firebot or Streamer.bot: open the export, review what
 * comes over and what cannot, then create it. Picks up the instance's latest
 * import, so leaving the page mid-import and coming back shows how it went.
 */
export function SetupImportPanel({ instanceId, canImport, onQueued }: SetupImportPanelProps) {
  const latest = useQuery(api.setupImports.latest, { instanceId });
  const [startingOver, setStartingOver] = useState(false);

  if (latest === undefined) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  const active = latest && !(startingOver && latest.status === "done") ? latest : null;
  if (!active) {
    return <ChooseExport instanceId={instanceId} canImport={canImport} onRead={() => setStartingOver(false)} />;
  }
  return (
    <ImportProgress
      report={active}
      canImport={canImport}
      onQueued={onQueued}
      onStartOver={() => setStartingOver(true)}
    />
  );
}

function ChooseExport({
  instanceId,
  canImport,
  onRead,
}: {
  instanceId: Id<"instances">;
  canImport: boolean;
  onRead: () => void;
}) {
  const analyze = useAction(api.setupImports.analyze);
  const fileInput = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ImportSource>("firebot");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function send(document: unknown) {
    const { importId } = await analyze({
      instanceId,
      source,
      documentChunks: chunkText(JSON.stringify(document)),
    });
    onRead();
    return importId;
  }

  async function read(work: () => Promise<unknown>) {
    setProblem(null);
    setBusy(true);
    try {
      await send(await work());
    } catch (error) {
      setProblem(error instanceof ImportFileError ? error.message : errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function handleFile(file: File | undefined) {
    if (!file) {
      return;
    }
    const fileProblem = importFileProblem(file);
    if (fileProblem) {
      setProblem(fileProblem);
      return;
    }
    void read(async () => {
      if (source === "firebot") {
        return decodeFirebotFile(file.name, new Uint8Array(await file.arrayBuffer()));
      }
      return decodeStreamerbotExport(await file.text(), file.name);
    });
  }

  const help = SOURCE_HELP[source];
  const disabled = !canImport || busy;

  return (
    <div className="space-y-5">
      {!canImport && (
        <Alert>
          <AlertDescription>Only owners and admins of this instance can import a setup.</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Where are you coming from?</h3>
        <RadioGroup
          value={source}
          onValueChange={(value) => {
            setSource(value as ImportSource);
            setProblem(null);
          }}
          className="flex flex-wrap gap-4"
          disabled={disabled}
        >
          {(Object.keys(IMPORT_SOURCE_LABELS) as ImportSource[]).map((option) => (
            <div key={option} className="flex items-center gap-2">
              <RadioGroupItem id={`import-source-${option}`} value={option} />
              <Label htmlFor={`import-source-${option}`}>{IMPORT_SOURCE_LABELS[option]}</Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        {help.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      {source === "streamerbot" && (
        <div className="space-y-2">
          <Label htmlFor="streamerbot-export">Export string</Label>
          <Textarea
            id="streamerbot-export"
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            placeholder="U0JBRR+LCAAAAAAABA..."
            className="h-28 font-mono text-xs"
            disabled={disabled}
            data-testid="textarea-streamerbot-export"
          />
          <Button
            onClick={() => void read(async () => decodeStreamerbotExport(pasted))}
            disabled={disabled || pasted.trim() === ""}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Read export
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInput}
          type="file"
          accept={help.accept}
          className="hidden"
          onChange={(event) => {
            handleFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Button
          variant={source === "streamerbot" ? "outline" : "default"}
          onClick={() => fileInput.current?.click()}
          disabled={disabled}
        >
          {busy && source === "firebot" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          {help.chooseLabel}
        </Button>
        <span className="text-xs text-muted-foreground">Nothing changes until you review it and choose Import.</span>
      </div>

      {problem && <p className="text-sm text-destructive">{problem}</p>}
    </div>
  );
}

function ImportProgress({
  report,
  canImport,
  onQueued,
  onStartOver,
}: {
  report: ImportReport;
  canImport: boolean;
  onQueued?: () => void;
  onStartOver: () => void;
}) {
  const start = useMutation(api.setupImports.start);
  const retry = useMutation(api.setupImports.retry);
  const discard = useMutation(api.setupImports.discard);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>, after?: () => void) {
    setProblem(null);
    setBusy(true);
    try {
      await work();
      after?.();
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const sourceLabel = IMPORT_SOURCE_LABELS[report.source];
  const summary = reviewSummary(report);
  const progress = applyProgress(report);
  const disabled = !canImport || busy;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h3 className="font-medium">
          {report.label} <span className="text-sm font-normal text-muted-foreground">from {sourceLabel}</span>
        </h3>
        {report.status === "review" && (
          <p className="text-sm text-muted-foreground">
            {summary.importable} of {report.items.length} come over
            {summary.withChanges > 0 ? `, ${summary.withChanges} of them with changes listed below` : ""}.
            {summary.unsupported > 0 ? ` ${summary.unsupported} can't come over yet; each says why.` : ""}
          </p>
        )}
      </div>

      {report.status === "review" && (
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => void run(() => start({ importId: report.id }), onQueued)}
            disabled={disabled || summary.importable === 0}
            data-testid="button-start-import"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Import {summary.importable} {summary.importable === 1 ? "item" : "items"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void run(() => discard({ importId: report.id }), onStartOver)}
            disabled={disabled}
          >
            Choose a different file
          </Button>
        </div>
      )}

      {(report.status === "queued" || report.status === "applying") && (
        <div className="space-y-2">
          <Progress value={progress.total === 0 ? 0 : (progress.done / progress.total) * 100} />
          <p className="text-sm text-muted-foreground">
            {report.waitingFor ?? `Importing… ${progress.done} of ${progress.total} done. You can leave this page.`}
          </p>
          {canRetry(report) && (
            <Button size="sm" onClick={() => void run(() => retry({ importId: report.id }))} disabled={disabled}>
              <RotateCcw className="h-4 w-4" />
              Try again
            </Button>
          )}
        </div>
      )}

      {report.status === "done" && (
        <Alert>
          <AlertTitle>Import finished</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Everything below says how it went. Imported items are ordinary workflows, commands, groups and counters
              now: change them like anything else you made.
            </p>
            <div className="flex flex-wrap gap-3">
              {canRetry(report) && (
                <Button size="sm" onClick={() => void run(() => retry({ importId: report.id }))} disabled={disabled}>
                  <RotateCcw className="h-4 w-4" />
                  Try the rest again
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={onStartOver} disabled={disabled}>
                Import another setup
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {problem && <p className="text-sm text-destructive">{problem}</p>}

      <ImportReportView report={report} />
    </div>
  );
}
