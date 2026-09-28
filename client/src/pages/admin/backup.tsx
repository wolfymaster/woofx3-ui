import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  CONFIG_CONFLICT_POLICIES,
  CONFIG_SECTIONS,
  type ConfigConflictPolicy,
  type ConfigImportAction,
  type ConfigImportOutcome,
  type ConfigImportPlan,
  type ConfigImportResult,
  type ConfigSection,
  chunkText,
} from "@convex/lib/configBundle";
import { useAction, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Download, FileUp, Loader2, PackageX, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import {
  backupFileName,
  backupFileProblem,
  CONFIG_SECTION_LABELS,
  groupByKind,
  IMPORT_ACTION_LABELS,
  IMPORT_OUTCOME_LABELS,
  splitReasons,
  writeCount,
} from "@/lib/config-backup";

const CONFLICT_POLICY_TEXT: Record<ConfigConflictPolicy, { label: string; description: string }> = {
  skip: {
    label: "Keep what I have",
    description: "When a name is already taken by something different, leave yours alone and skip the imported one.",
  },
  rename: {
    label: "Import a copy",
    description:
      'Import it beside yours under a new name, such as "Raid alert (imported)" or "!hug-imported". Resources keep their id, so a taken one is still skipped.',
  },
  overwrite: {
    label: "Replace mine",
    description: "Replace yours with the imported version. Anything a module installed is never replaced.",
  },
};

const ACTION_BADGE: Record<ConfigImportAction, BadgeProps["variant"]> = {
  create: "default",
  update: "secondary",
  skip: "outline",
  conflict: "destructive",
};

const OUTCOME_BADGE: Record<ConfigImportOutcome, BadgeProps["variant"]> = {
  created: "default",
  updated: "secondary",
  skipped: "outline",
  conflict: "destructive",
  failed: "destructive",
};

function errorMessage(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Hands the text to the browser as a file download. */
function saveTextFile(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function SectionPicker({
  idPrefix,
  sections,
  onChange,
  disabled,
}: {
  idPrefix: string;
  sections: ConfigSection[];
  onChange: (sections: ConfigSection[]) => void;
  disabled?: boolean;
}) {
  function toggle(section: ConfigSection, checked: boolean) {
    const next = new Set(sections);
    if (checked) {
      next.add(section);
    } else {
      next.delete(section);
    }
    onChange(CONFIG_SECTIONS.filter((candidate) => next.has(candidate)));
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {CONFIG_SECTIONS.map((section) => {
        const id = `${idPrefix}-${section}`;
        return (
          <div key={section} className="flex items-start gap-3">
            <Checkbox
              id={id}
              checked={sections.includes(section)}
              disabled={disabled}
              onCheckedChange={(checked) => toggle(section, checked === true)}
            />
            <div className="space-y-0.5">
              <Label htmlFor={id}>{CONFIG_SECTION_LABELS[section].label}</Label>
              <p className="text-xs text-muted-foreground">{CONFIG_SECTION_LABELS[section].description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ExportCard({
  instanceId,
  instanceName,
  canExportMembers,
}: {
  instanceId: Id<"instances">;
  instanceName: string;
  canExportMembers: boolean;
}) {
  const exportConfig = useAction(api.configBackup.exportConfig);
  const { toast } = useToast();
  const [sections, setSections] = useState<ConfigSection[]>([...CONFIG_SECTIONS]);
  const [includeMembers, setIncludeMembers] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  async function handleExport() {
    setIsExporting(true);
    try {
      const chunks = await exportConfig({ instanceId, include: sections, includeMembers });
      const fileName = backupFileName(instanceName, new Date());
      saveTextFile(fileName, chunks.join(""));
      toast({ title: "Backup downloaded", description: fileName });
    } catch (error) {
      toast({ title: "Could not export", description: errorMessage(error), variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export</CardTitle>
        <CardDescription>
          Download what you have built as one file. Tokens, passwords, module settings and the current values of
          counters, timers and queues are never included.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <SectionPicker idPrefix="export" sections={sections} onChange={setSections} disabled={isExporting} />

        <div className="flex items-start gap-3 rounded-md border p-3">
          <Checkbox
            id="export-members"
            checked={includeMembers}
            disabled={isExporting || !canExportMembers}
            onCheckedChange={(checked) => setIncludeMembers(checked === true)}
          />
          <div className="space-y-0.5">
            <Label htmlFor="export-members">Include group members (personal data)</Label>
            <p className="text-xs text-muted-foreground">
              Adds the usernames in your command groups and the people a command is granted to. These are other people's
              usernames, so leave this off for a backup you plan to share.
              {!canExportMembers && " Only owners and admins can include them."}
            </p>
          </div>
        </div>

        <Button onClick={handleExport} disabled={isExporting || sections.length === 0}>
          {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download backup
        </Button>
      </CardContent>
    </Card>
  );
}

function PlanView({ plan }: { plan: ConfigImportPlan }) {
  const groups = groupByKind(plan.items);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        {(Object.keys(IMPORT_ACTION_LABELS) as ConfigImportAction[]).map((action) => (
          <Badge key={action} variant={ACTION_BADGE[action]}>
            {IMPORT_ACTION_LABELS[action]}: {plan.summary[action]}
          </Badge>
        ))}
      </div>

      {plan.missingModules.length > 0 && (
        <Alert variant="destructive">
          <PackageX className="h-4 w-4" />
          <AlertTitle>Missing modules</AlertTitle>
          <AlertDescription>
            <p className="mb-2">Items that need these modules will not be imported until you install them.</p>
            <ul className="list-disc pl-5">
              {plan.missingModules.map((module) => (
                <li key={module.moduleId}>
                  <Link href={`/modules/${encodeURIComponent(module.moduleId)}`} className="underline">
                    {module.moduleId}
                  </Link>{" "}
                  (exported from version {module.version})
                </li>
              ))}
            </ul>
            <Link href="/modules" className="mt-2 inline-block underline">
              Browse modules
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {groups.length === 0 && <p className="text-sm text-muted-foreground">The file has nothing to import.</p>}

      {groups.map((group) => (
        <div key={group.kind} className="space-y-2">
          <h3 className="text-sm font-medium">
            {group.label} ({group.items.length})
          </h3>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-28">Action</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.items.map((item) => {
                  const { blocking, warnings } = splitReasons(item.reasons);
                  return (
                    <TableRow key={`${item.kind}:${item.key}`}>
                      <TableCell className="font-mono text-xs">
                        {item.key}
                        {item.targetName !== item.key && (
                          <span className="block text-muted-foreground">as {item.targetName}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={ACTION_BADGE[item.action]}>{IMPORT_ACTION_LABELS[item.action]}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <ul className="space-y-1">
                          {blocking.map((reason) => (
                            <li key={`${reason.code}:${reason.message}`} className="text-destructive">
                              {reason.message}
                            </li>
                          ))}
                          {warnings.map((reason) => (
                            <li key={`${reason.code}:${reason.message}`} className="text-muted-foreground">
                              {reason.message}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultView({ result }: { result: ConfigImportResult }) {
  const groups = groupByKind(result.items);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        {(Object.keys(IMPORT_OUTCOME_LABELS) as ConfigImportOutcome[]).map((outcome) => (
          <Badge key={outcome} variant={OUTCOME_BADGE[outcome]}>
            {IMPORT_OUTCOME_LABELS[outcome]}: {result.summary[outcome]}
          </Badge>
        ))}
      </div>
      {result.summary.failed > 0 && (
        <p className="text-sm text-muted-foreground">
          Everything else was applied. Importing the same file again skips what made it and retries the rest.
        </p>
      )}

      {groups.map((group) => (
        <div key={group.kind} className="space-y-2">
          <h3 className="text-sm font-medium">{group.label}</h3>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-28">Outcome</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.items.map((item) => (
                  <TableRow key={`${item.kind}:${item.key}`}>
                    <TableCell className="font-mono text-xs">
                      {item.key}
                      {item.name && item.name !== item.key && (
                        <span className="block text-muted-foreground">as {item.name}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={OUTCOME_BADGE[item.outcome]}>{IMPORT_OUTCOME_LABELS[item.outcome]}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{item.error ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  );
}

interface PickedFile {
  name: string;
  chunks: string[];
}

function ImportCard({ instanceId, canImport }: { instanceId: Id<"instances">; canImport: boolean }) {
  const previewImport = useAction(api.configBackup.previewImport);
  const importConfig = useAction(api.configBackup.importConfig);
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<PickedFile | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [sections, setSections] = useState<ConfigSection[]>([...CONFIG_SECTIONS]);
  const [onConflict, setOnConflict] = useState<ConfigConflictPolicy>("skip");
  const [plan, setPlan] = useState<ConfigImportPlan | null>(null);
  const [result, setResult] = useState<ConfigImportResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [confirming, setConfirming] = useState(false);

  // A plan answers one file under one set of options; any change makes it stale.
  function resetOutcome() {
    setPlan(null);
    setResult(null);
  }

  async function handleFile(picked: File | undefined) {
    resetOutcome();
    setFile(null);
    setFileProblem(null);
    if (!picked) {
      return;
    }
    const problem = backupFileProblem(picked);
    if (problem) {
      setFileProblem(problem);
      return;
    }
    setFile({ name: picked.name, chunks: chunkText(await picked.text()) });
  }

  async function handlePreview() {
    if (!file) {
      return;
    }
    setBusy("preview");
    setResult(null);
    try {
      setPlan(await previewImport({ instanceId, bundleChunks: file.chunks, onConflict, include: sections }));
    } catch (error) {
      setPlan(null);
      toast({ title: "Could not read the backup", description: errorMessage(error), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function handleImport() {
    if (!file) {
      return;
    }
    setConfirming(false);
    setBusy("import");
    try {
      const outcome = await importConfig({ instanceId, bundleChunks: file.chunks, onConflict, include: sections });
      setResult(outcome);
      setPlan(null);
      toast({
        title: outcome.summary.failed > 0 ? "Import finished with failures" : "Import finished",
        description: `${outcome.summary.created} created, ${outcome.summary.updated} replaced, ${outcome.summary.failed} failed.`,
        variant: outcome.summary.failed > 0 ? "destructive" : "default",
      });
    } catch (error) {
      toast({ title: "Could not import", description: errorMessage(error), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  const disabled = !canImport || busy !== null;
  const writes = plan ? writeCount(plan) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import</CardTitle>
        <CardDescription>
          Restore a backup or bring in a setup someone shared with you. You see what will change before anything is
          written.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!canImport && (
          <Alert>
            <AlertDescription>Only owners and admins of this instance can import a backup.</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={disabled}>
              <FileUp className="h-4 w-4" />
              Choose backup file
            </Button>
            <span className="text-sm text-muted-foreground">{file ? file.name : "No file chosen (up to 5 MiB)"}</span>
          </div>
          {fileProblem && <p className="text-sm text-destructive">{fileProblem}</p>}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">What to import</h3>
          <SectionPicker
            idPrefix="import"
            sections={sections}
            onChange={(next) => {
              setSections(next);
              resetOutcome();
            }}
            disabled={disabled}
          />
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">When a name is already taken</h3>
          <RadioGroup
            value={onConflict}
            onValueChange={(value) => {
              setOnConflict(value as ConfigConflictPolicy);
              resetOutcome();
            }}
            disabled={disabled}
            className="space-y-2"
          >
            {CONFIG_CONFLICT_POLICIES.map((policy) => (
              <div key={policy} className="flex items-start gap-3">
                <RadioGroupItem id={`conflict-${policy}`} value={policy} />
                <div className="space-y-0.5">
                  <Label htmlFor={`conflict-${policy}`}>{CONFLICT_POLICY_TEXT[policy].label}</Label>
                  <p className="text-xs text-muted-foreground">{CONFLICT_POLICY_TEXT[policy].description}</p>
                </div>
              </div>
            ))}
          </RadioGroup>
          <p className="text-xs text-muted-foreground">
            Anything identical to what you already have is always skipped.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={handlePreview} disabled={disabled || !file || sections.length === 0}>
            {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Preview
          </Button>
          <Button
            variant="destructive"
            onClick={() => setConfirming(true)}
            disabled={disabled || !plan || writes === 0}
          >
            {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Apply import
          </Button>
        </div>

        {plan && <PlanView plan={plan} />}
        {result && <ResultView result={result} />}

        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apply this import?</AlertDialogTitle>
              <AlertDialogDescription>
                {plan
                  ? `${plan.summary.create} items will be created and ${plan.summary.update} of yours replaced. `
                  : ""}
                This cannot be undone from here, so export a backup first if you might want to go back. The engine
                checks everything again as it applies, so the outcome can differ from the preview if something changed
                meanwhile.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleImport}>Apply import</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

export default function AdminBackup() {
  const { instance, isLoading } = useInstance();
  const access = useQuery(api.configBackup.access, instance ? { instanceId: instance._id } : "skip");

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title="Backup"
        description="Save your workflows, commands, groups and resources to a file, or bring them in from one."
      />

      {isLoading || (instance && access === undefined) ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : !instance || !access?.canExport ? (
        <p className="text-sm text-muted-foreground">Select an instance you are a member of to back it up.</p>
      ) : (
        <>
          <ExportCard
            instanceId={instance._id}
            instanceName={instance.name}
            canExportMembers={access.canExportMembers}
          />
          <ImportCard instanceId={instance._id} canImport={access.canImport} />
        </>
      )}
    </div>
  );
}
