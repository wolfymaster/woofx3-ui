import { Loader2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfigurationForm, type FieldDescriptor, type FieldValues } from "@/components/common/configuration-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { configFieldRenderers } from "@/components/workflows/trigger-config-form";
import { parseConfigFields } from "@/lib/parse-config-fields";
import { getDefaultConfigValues } from "@/lib/workflow-presets";

export interface CreateResourceDialogKind {
  kind: string;
  name: string;
  /** The kind's create-instance form, as its manifest declares it. */
  schema?: unknown[];
}

interface CreateResourceDialogProps {
  kind: CreateResourceDialogKind;
  onClose: () => void;
  onCreate: (resourceInstanceId: string, displayName: string, settings: Record<string, unknown>) => Promise<void>;
}

/** Characters an instance id may use: the engine's canonical-id segment rule. */
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** "Death Count" -> "death_count": a suggested id the user can still change. */
export function suggestInstanceId(displayName: string): string {
  return displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Create an instance of a module-declared resource kind: its name, the id it is
 * addressed by, and the values of whatever settings the kind declares.
 *
 * The id follows the name until the user edits it, because most people name a
 * counter and do not care what it is called internally — but it is shown,
 * since workflows reference it and it can never change.
 */
export function CreateResourceDialog({ kind, onClose, onCreate }: CreateResourceDialogProps) {
  const fields = useMemo(() => parseConfigFields(kind.schema), [kind.schema]);
  const [displayName, setDisplayName] = useState("");
  const [editedId, setEditedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<FieldValues>(() => getDefaultConfigValues(fields));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resourceInstanceId = editedId ?? suggestInstanceId(displayName);
  const idIsValid = INSTANCE_ID_PATTERN.test(resourceInstanceId);
  const missingRequired = fields.filter((field) => {
    const value = settings[field.id];
    return field.required && (value === undefined || value === null || value === "");
  });
  const canCreate = displayName.trim() !== "" && idIsValid && missingRequired.length === 0 && !creating;

  async function handleCreate() {
    if (!canCreate) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await onCreate(resourceInstanceId, displayName.trim(), settings as Record<string, unknown>);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to create the ${kind.name.toLowerCase()}.`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New {kind.name.toLowerCase()}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="new-resource-name">Name</Label>
            <Input
              id="new-resource-name"
              placeholder="e.g. Deaths"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoFocus
              data-testid="input-resource-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-resource-id">ID</Label>
            <Input
              id="new-resource-id"
              placeholder="e.g. deaths"
              value={resourceInstanceId}
              onChange={(e) => setEditedId(e.target.value)}
              className="font-mono"
              data-testid="input-resource-id"
            />
            <p
              className={
                idIsValid || resourceInstanceId === "" ? "text-xs text-muted-foreground" : "text-xs text-destructive"
              }
            >
              {idIsValid || resourceInstanceId === ""
                ? "What workflows and actions refer to it by. It can't be changed later."
                : "Use only letters, numbers, dots, dashes and underscores."}
            </p>
          </div>
          {fields.length > 0 && (
            <ConfigurationForm
              fields={fields as unknown as FieldDescriptor[]}
              values={settings}
              onChange={setSettings}
              customRenderers={configFieldRenderers}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canCreate} onClick={() => void handleCreate()} data-testid="button-create-resource">
            {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
