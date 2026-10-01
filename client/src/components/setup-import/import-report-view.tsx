import type { ImportReport, ImportReportItem } from "@convex/setupImports";
import { ChevronDown } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { IMPORT_KIND_LABELS, type ImportSection, reportSections } from "@/lib/setup-import";

const SECTION_BADGE: Record<ImportSection, BadgeProps["variant"]> = {
  ready: "default",
  partial: "secondary",
  unsupported: "outline",
  created: "default",
  exists: "secondary",
  needs_module: "destructive",
  skipped: "outline",
  pending: "secondary",
  failed: "destructive",
  waiting: "outline",
};

function ItemRow({ item }: { item: ImportReportItem }) {
  const notes = item.notes.filter((note) => note.message !== item.message);
  return (
    <li className="space-y-1.5 p-3" data-testid={`import-item-${item.id}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium">{item.name}</span>
        <span className="text-xs text-muted-foreground">
          {item.origin} → {IMPORT_KIND_LABELS[item.kind]}
        </span>
      </div>
      {item.steps.length > 0 && <p className="text-xs text-muted-foreground">{item.steps.join(" → ")}</p>}
      {item.message && <p className="text-sm">{item.message}</p>}
      {notes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {notes.map((note) => (
            <li key={note.message} className={note.blocking ? "text-destructive" : undefined}>
              {note.message}
              {note.detail && (
                <Collapsible>
                  <CollapsibleTrigger className="mt-1 flex items-center gap-1 text-xs underline">
                    Show source <ChevronDown className="h-3 w-3" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-muted p-2 text-xs text-foreground">
                      {note.detail}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Every item of an import, sorted into sections by where it stands, and what the setup had that woofx3 does not. */
export function ImportReportView({ report }: { report: ImportReport }) {
  const sections = reportSections(report);
  return (
    <div className="space-y-5">
      {sections.length === 0 && <p className="text-sm text-muted-foreground">The file has nothing to import.</p>}
      {sections.map(({ section, label, items }) => (
        <section key={section} className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <Badge variant={SECTION_BADGE[section]}>{items.length}</Badge>
            {label}
          </h4>
          <ul className="divide-y rounded-md border">
            {items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ))}
      {report.leftovers.length > 0 && (
        <section className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <Badge variant="outline">{report.leftovers.length}</Badge>
            Not part of the import
          </h4>
          <ul className="divide-y rounded-md border text-sm">
            {report.leftovers.map((leftover, index) => (
              <li key={`${leftover.origin}:${leftover.name}:${index}`} className="p-3">
                <span className="font-medium">{leftover.name}</span>{" "}
                <span className="text-xs text-muted-foreground">{leftover.origin}</span>
                <p className="text-muted-foreground">{leftover.message}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
