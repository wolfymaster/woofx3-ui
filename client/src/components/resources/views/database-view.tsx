import {
  COLUMN_TYPE_LABELS,
  cellText,
  columnIdFor,
  databaseColumnProblems,
  GAMES_PLAYED_COLUMNS,
  parseCell,
  parseDatabaseColumns,
} from "@shared/databases/columns";
import {
  DATABASE_COLUMN_TYPES,
  DATABASE_COLUMNS_SETTING,
  DATABASE_SORT_CREATED_AT,
  type DatabaseColumn,
  type DatabaseColumnType,
  type DatabaseRecord,
  type DatabaseValuesInput,
} from "@woofx3/api/databases";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { KindView } from "@/components/resources/kind-views";
import type { ResourceDetailProps } from "@/components/resources/resource-kind-page";
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
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useCreateDatabaseRecordRequest,
  useDatabaseRecords,
  useDeleteDatabaseRecordRequest,
  useUpdateDatabaseRecordRequest,
} from "@/engine/hooks/use-databases";
import { useUpdateResourceInstanceRequest } from "@/engine/hooks/use-module-resources";
import { toast } from "@/hooks/use-toast";
import { ProblemIndex } from "@/lib/page-problems";
import { resourceName } from "@/lib/resource-instance";
import { STREAM_OBJECT_ICONS } from "@/lib/stream-object-icons";

const PAGE_SIZE = 50;

/** A woofx3 database: its columns and its rows. */
export const databaseView: KindView = {
  description:
    "Tables you keep: form answers, games you played, giveaway entrants. Workflows add and change rows; columns you choose can show on your public page.",
  icon: STREAM_OBJECT_ICONS.databases,
  railValue: ({ settings }) => parseDatabaseColumns(settings).length.toLocaleString(),
  detail: (props) => <DatabasePanel key={props.instance.canonicalId} {...props} />,
};

function DatabasePanel(props: ResourceDetailProps) {
  const columns = useMemo(() => parseDatabaseColumns(props.settings), [props.settings]);
  return (
    <div className="space-y-6">
      <ColumnsCard instance={props.instance} settings={props.settings} stored={columns} />
      {columns.length > 0 && <RecordsCard databaseId={props.instance.canonicalId} columns={columns} />}
    </div>
  );
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- Columns ---

const COLUMNS_PATH = "columns";

type ColumnsCardProps = Pick<ResourceDetailProps, "instance" | "settings"> & { stored: DatabaseColumn[] };

/**
 * The columns, edited as a draft and saved whole, like a form's questions. The
 * engine refuses a change rows can't follow (a new type for a column that
 * holds values, removing an option in use) and says why.
 */
function ColumnsCard({ instance, settings, stored }: ColumnsCardProps) {
  const updateInstance = useUpdateResourceInstanceRequest();
  const [draft, setDraft] = useState<DatabaseColumn[] | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const columns = draft ?? stored;
  const problems = useMemo(() => new ProblemIndex(databaseColumnProblems(columns, COLUMNS_PATH)), [columns]);

  const save = async (next: DatabaseColumn[]) => {
    if (databaseColumnProblems(next, COLUMNS_PATH).length > 0) {
      setShowProblems(true);
      return;
    }
    setSaving(true);
    try {
      await updateInstance({
        canonicalId: instance.canonicalId,
        displayName: resourceName(instance),
        settings: { ...settings, [DATABASE_COLUMNS_SETTING]: next },
      });
      setDraft(null);
      setShowProblems(false);
    } catch (err) {
      toast({ title: "Couldn't save those columns", description: errorText(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const change = (index: number, patch: Partial<DatabaseColumn>) => {
    setDraft(columns.map((column, i) => (i === index ? { ...column, ...patch } : column)));
  };
  const move = (index: number, by: -1 | 1) => {
    const next = [...columns];
    const [column] = next.splice(index, 1);
    next.splice(index + by, 0, column);
    setDraft(next);
  };
  // A new column's id must not reuse a saved one, even one deleted in this
  // draft: the engine would read it as that column and keep its values.
  const takenIds = (except: number) =>
    new Set([
      ...stored.map((column) => column.id),
      ...columns.filter((_, i) => i !== except).map((column) => column.id),
    ]);
  const add = () => {
    setDraft([...columns, { id: columnIdFor("Column", takenIds(-1)), label: "", type: "text", public: false }]);
  };

  const shown = showProblems ? problems : ProblemIndex.empty;
  return (
    <Card className="space-y-3 p-4" data-testid="database-columns">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Columns</h2>
        {draft !== null && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void save(columns)} data-testid="button-save-columns">
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        )}
      </div>

      {columns.length === 0 && draft === null && (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>Add the columns this database keeps, or start from a template.</p>
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => void save([...GAMES_PLAYED_COLUMNS])}
            data-testid="button-template-games"
          >
            Games I've played
          </Button>
        </div>
      )}

      {columns.map((column, index) => (
        <ColumnRow
          // biome-ignore lint/suspicious/noArrayIndexKey: a new column's id follows its name, so keying by it would remount the row on every keystroke
          key={index}
          column={column}
          isNew={!stored.some((s) => s.id === column.id)}
          takenIds={takenIds(index)}
          problems={[
            ...shown.at(`${COLUMNS_PATH}[${index}].id`),
            ...shown.at(`${COLUMNS_PATH}[${index}].label`),
            ...shown.at(`${COLUMNS_PATH}[${index}].options`),
          ]}
          canMoveUp={index > 0}
          canMoveDown={index < columns.length - 1}
          onChange={(patch) => change(index, patch)}
          onMove={(by) => move(index, by)}
          onRemove={() => setDraft(columns.filter((_, i) => i !== index))}
        />
      ))}
      {shown.at(COLUMNS_PATH).map((message) => (
        <p key={message} className="text-xs text-destructive">
          {message}
        </p>
      ))}

      <Button variant="outline" size="sm" onClick={add} data-testid="button-add-column">
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add column
      </Button>
    </Card>
  );
}

interface ColumnRowProps {
  column: DatabaseColumn;
  isNew: boolean;
  /** Ids a new column's generated id must avoid. */
  takenIds: ReadonlySet<string>;
  problems: readonly string[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (patch: Partial<DatabaseColumn>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}

/** Options are typed one per line; each line's value is made from its text. */
function optionsText(column: DatabaseColumn): string {
  return (column.options ?? []).map((option) => option.label).join("\n");
}

function optionsFrom(text: string, previous: DatabaseColumn["options"]): DatabaseColumn["options"] {
  const taken = new Set<string>();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((label) => {
      const kept = previous?.find((option) => option.label === label);
      const value = kept && !taken.has(kept.value) ? kept.value : columnIdFor(label, taken);
      taken.add(value);
      return { value, label };
    });
}

function ColumnRow(props: ColumnRowProps) {
  const { column } = props;
  return (
    <div className="space-y-2 rounded-md border p-3" data-testid={`column-${column.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 max-w-56"
          value={column.label}
          placeholder="Column name"
          aria-label="Column name"
          onChange={(event) => {
            const label = event.target.value;
            // A new column's id follows its name until saved; a saved id never changes.
            props.onChange(props.isNew ? { label, id: columnIdFor(label, props.takenIds) } : { label });
          }}
        />
        <Select
          value={column.type}
          onValueChange={(type) =>
            props.onChange({
              type: type as DatabaseColumnType,
              options: type === "select" ? (column.options ?? []) : undefined,
            })
          }
        >
          <SelectTrigger className="h-8 w-36" aria-label="Column type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATABASE_COLUMN_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {COLUMN_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            id={`public-${column.id}`}
            checked={column.public}
            onCheckedChange={(checked) => props.onChange({ public: checked })}
          />
          <Label htmlFor={`public-${column.id}`}>Show on your public page</Label>
        </span>
        <div className="ml-auto flex items-center">
          <Button
            variant="ghost"
            size="icon"
            disabled={!props.canMoveUp}
            onClick={() => props.onMove(-1)}
            aria-label="Move up"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!props.canMoveDown}
            onClick={() => props.onMove(1)}
            aria-label="Move down"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={props.onRemove} aria-label="Delete column">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {column.type === "select" && (
        <textarea
          key={column.id}
          className="w-full rounded-md border bg-transparent p-2 text-sm"
          rows={3}
          placeholder="One option per line"
          aria-label="Options"
          defaultValue={optionsText(column)}
          onBlur={(event) => props.onChange({ options: optionsFrom(event.target.value, column.options) })}
        />
      )}
      {props.problems.map((message) => (
        <p key={message} className="text-xs text-destructive">
          {message}
        </p>
      ))}
    </div>
  );
}

// --- Rows ---

interface Sort {
  by: string;
  direction: "asc" | "desc";
}

/** What was typed into each cell of a row being added or edited, by column id. */
type CellDrafts = Record<string, string>;

/**
 * The cells of a row as the editor starts them. A yes/no cell is a switch, which
 * has no blank state, so an empty one starts as no and saves as it shows.
 */
export function draftsOf(columns: readonly DatabaseColumn[], record: DatabaseRecord | null): CellDrafts {
  return Object.fromEntries(
    columns.map((column) => {
      const text = cellText(record?.values[column.id]);
      return [column.id, column.type === "boolean" && text === "" ? String(false) : text];
    })
  );
}

/** The values to send for a row's drafts, or the message for each cell that doesn't fit. */
export function valuesOfDrafts(
  columns: readonly DatabaseColumn[],
  drafts: CellDrafts
): { ok: true; values: DatabaseValuesInput } | { ok: false; errors: Record<string, string> } {
  const values: DatabaseValuesInput = {};
  const errors: Record<string, string> = {};
  for (const column of columns) {
    const parsed = parseCell(column, drafts[column.id] ?? "");
    if (parsed.ok) {
      values[column.id] = parsed.value;
    } else {
      errors[column.id] = parsed.error;
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}

function RecordsCard({ databaseId, columns }: { databaseId: string; columns: DatabaseColumn[] }) {
  const [sort, setSort] = useState<Sort>({ by: DATABASE_SORT_CREATED_AT, direction: "desc" });
  const [page, setPage] = useState(0);
  const records = useDatabaseRecords(databaseId, {
    sortBy: sort.by,
    direction: sort.direction,
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE,
  });
  const create = useCreateDatabaseRecordRequest();
  const update = useUpdateDatabaseRecordRequest();
  const remove = useDeleteDatabaseRecordRequest();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [drafts, setDrafts] = useState<CellDrafts>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<DatabaseRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const total = records.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const startEdit = (record: DatabaseRecord | null) => {
    setEditing(record === null ? "new" : record.id);
    setDrafts(draftsOf(columns, record));
    setErrors({});
  };

  const saveRow = async () => {
    const parsed = valuesOfDrafts(columns, drafts);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setBusy(true);
    try {
      if (editing === "new") {
        const result = await create({ databaseId, values: parsed.values });
        if (result.status === "full") {
          toast({ title: "This database is full", variant: "destructive" });
          return;
        }
      } else if (editing !== null) {
        const record = records.data?.records.find((r) => r.id === editing);
        const result = await update({
          databaseId,
          recordId: editing,
          values: parsed.values,
          expectedRevision: record?.revision,
        });
        if (result.status === "conflict") {
          toast({
            title: "Someone changed this row meanwhile",
            description: "It shows their change now; edit it again.",
          });
        }
      }
      setEditing(null);
      records.refetch();
    } catch (err) {
      toast({ title: "Couldn't save that row", description: errorText(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const toggleSort = (by: string) => {
    setPage(0);
    setSort((current) =>
      current.by === by ? { by, direction: current.direction === "asc" ? "desc" : "asc" } : { by, direction: "asc" }
    );
  };

  const editorRow = (key: string) => (
    <TableRow key={key} data-testid="row-editor">
      {columns.map((column) => (
        <TableCell key={column.id} className="align-top">
          {column.type === "boolean" ? (
            <Switch
              className="mt-1.5"
              checked={drafts[column.id] === String(true)}
              aria-label={column.label}
              onCheckedChange={(checked) => setDrafts({ ...drafts, [column.id]: String(checked) })}
            />
          ) : (
            <Input
              className="h-8"
              value={drafts[column.id] ?? ""}
              placeholder={column.type === "date" ? "YYYY-MM-DD" : ""}
              aria-label={column.label}
              aria-invalid={errors[column.id] !== undefined}
              onChange={(event) => setDrafts({ ...drafts, [column.id]: event.target.value })}
            />
          )}
          {errors[column.id] && <p className="mt-1 text-xs text-destructive">{errors[column.id]}</p>}
        </TableCell>
      ))}
      <TableCell className="whitespace-nowrap text-right align-top">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(null)}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void saveRow()} data-testid="button-save-row">
          Save
        </Button>
      </TableCell>
    </TableRow>
  );

  return (
    <Card className="space-y-3 p-4" data-testid="database-records">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Rows <span className="tabular-nums">({total.toLocaleString()})</span>
        </h2>
        <Button
          variant="outline"
          size="sm"
          disabled={editing !== null}
          onClick={() => startEdit(null)}
          data-testid="button-add-row"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add row
        </Button>
      </div>
      {records.error && <p className="text-sm text-destructive">{records.error}</p>}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.id}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1"
                    onClick={() => toggleSort(column.id)}
                  >
                    {column.label}
                    {sort.by === column.id &&
                      (sort.direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                </TableHead>
              ))}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {editing === "new" && editorRow("new")}
            {(records.data?.records ?? []).map((record) =>
              editing === record.id ? (
                editorRow(record.id)
              ) : (
                <TableRow key={record.id}>
                  {columns.map((column) => (
                    <TableCell key={column.id}>{cellText(record.values[column.id])}</TableCell>
                  ))}
                  <TableCell className="whitespace-nowrap text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={editing !== null}
                      onClick={() => startEdit(record)}
                      aria-label="Edit row"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(record)} aria-label="Delete row">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            )}
          </TableBody>
        </Table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="tabular-nums text-muted-foreground">
            {page + 1} of {pages}
          </span>
          <Button variant="ghost" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this row?</AlertDialogTitle>
            <AlertDialogDescription>It's gone for good, from here and from your public page.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deleting === null) {
                  return;
                }
                try {
                  await remove(databaseId, deleting.id);
                  records.refetch();
                } catch (err) {
                  toast({ title: "Couldn't delete that row", description: errorText(err), variant: "destructive" });
                } finally {
                  setDeleting(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
