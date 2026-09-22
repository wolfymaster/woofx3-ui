import { Copy, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useToast } from "@/hooks/use-toast";
import { flattenPayload, formatPayload, type PayloadFieldKind } from "@/lib/payload-fields";
import { cn } from "@/lib/utils";

/** Below this many rows a filter box is more clutter than help. */
const FILTER_THRESHOLD = 10;

const KIND_STYLE: Record<PayloadFieldKind, string> = {
  string: "text-foreground",
  number: "text-sky-600 dark:text-sky-400",
  boolean: "text-violet-600 dark:text-violet-400",
  null: "italic text-muted-foreground",
  empty: "italic text-muted-foreground",
};

type View = "fields" | "json";

interface PayloadPanelProps {
  title: string;
  /** The parsed value to break into fields. Undefined when `raw` is not JSON. */
  value: unknown;
  /** The text shown in the JSON view and copied. */
  raw: string;
  testId?: string;
}

/**
 * A payload read two ways: as rows of path and value, for finding the one field
 * that matters, and as the JSON it arrived as, for copying or reading structure.
 */
export function PayloadPanel({ title, value, raw, testId }: PayloadPanelProps) {
  const { toast } = useToast();
  const readable = value !== undefined;
  const [view, setView] = useState<View>(readable ? "fields" : "json");
  const [filter, setFilter] = useState("");

  const flattened = useMemo(() => (readable ? flattenPayload(value) : null), [readable, value]);
  const needle = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    const fields = flattened?.fields ?? [];
    if (needle === "") {
      return fields;
    }
    return fields.filter(
      (field) => field.path.toLowerCase().includes(needle) || field.value.toLowerCase().includes(needle)
    );
  }, [flattened, needle]);

  const copy = async () => {
    await navigator.clipboard.writeText(raw);
    toast({ title: "Copied", description: `${title} copied to the clipboard.` });
  };

  return (
    <section className="rounded-md border" data-testid={testId}>
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h4 className="text-sm font-medium">{title}</h4>
        {flattened && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {flattened.fields.length}
            {flattened.truncated ? "+" : ""} {flattened.fields.length === 1 ? "field" : "fields"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {readable && (
            <ToggleGroup
              type="single"
              size="sm"
              value={view}
              onValueChange={(next) => {
                if (next) {
                  setView(next as View);
                }
              }}
              aria-label={`How to show ${title}`}
            >
              <ToggleGroupItem value="fields" className="h-7 px-2 text-xs">
                Fields
              </ToggleGroupItem>
              <ToggleGroupItem value="json" className="h-7 px-2 text-xs">
                JSON
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void copy()} title={`Copy ${title}`}>
            <Copy className="h-3.5 w-3.5" />
            <span className="sr-only">Copy {title}</span>
          </Button>
        </div>
      </header>

      {view === "json" || !flattened ? (
        <pre className="max-h-[28rem] overflow-auto p-3 font-mono text-xs leading-relaxed">{formatPayload(raw)}</pre>
      ) : (
        <div>
          {flattened.fields.length > FILTER_THRESHOLD && (
            <div className="relative border-b">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter fields"
                aria-label={`Filter ${title}`}
                className="h-8 rounded-none border-0 pl-8 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
          )}
          <div className="max-h-[28rem] overflow-auto">
            <dl>
              {visible.map((field) => (
                <div
                  key={field.path}
                  className="grid grid-cols-1 gap-x-4 border-b px-3 py-1.5 last:border-b-0 sm:grid-cols-[minmax(9rem,16rem)_1fr]"
                >
                  <dt className="truncate font-mono text-xs text-muted-foreground" title={field.path}>
                    {field.path}
                  </dt>
                  <dd className={cn("whitespace-pre-wrap break-all font-mono text-xs", KIND_STYLE[field.kind])}>
                    {field.value === "" ? (
                      <span className="italic text-muted-foreground">empty string</span>
                    ) : (
                      field.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {visible.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted-foreground">No field matches “{filter.trim()}”.</p>
            )}
          </div>
          {flattened.truncated && (
            <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
              Showing the first {flattened.fields.length} fields. Switch to JSON for the rest.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
