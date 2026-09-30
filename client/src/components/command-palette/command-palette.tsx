import { useStore } from "@nanostores/react";
import { ArrowLeft, ChevronRight, CornerDownLeft, Loader2 } from "lucide-react";
import { type KeyboardEvent, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import {
  inlineArgument,
  type PaletteSection,
  parseQuery,
  pushRecent,
  RECENT_HEADING,
  rankEntries,
  SCOPE_PREFIXES,
} from "@/lib/command-palette";
import { $paletteRecents } from "@/lib/stores";
import { cn } from "@/lib/utils";
import { navigationCommands } from "./navigation-commands";
import type { PaletteCommand, PalettePrompt } from "./types";
import { useActionCommands } from "./use-action-commands";
import { useItemCommands } from "./use-item-commands";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Results per heading while searching everything; a scoped search (`#`, `>`, `/`) shows all. */
const SEARCH_LIMIT_PER_GROUP = 5;

const ON_THIS_PAGE_HEADING = "On this page";

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mounted only while open, so the palette's queries run only while it is in use. */}
      {open && <PaletteContent onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

/** A row to render: a command, or a prompt's argument filled in from the root query. */
interface Row {
  key: string;
  command: PaletteCommand;
  /** Set when choosing the row submits `command`'s prompt with this text. */
  argument?: string;
  title: string;
}

interface RowSection {
  heading: string;
  entries: Row[];
}

function every(commands: readonly PaletteCommand[]): Map<string, PaletteCommand> {
  const index = new Map<string, PaletteCommand>();
  const walk = (list: readonly PaletteCommand[]) => {
    for (const command of list) {
      index.set(command.id, command);
      walk(command.children ?? []);
      if (command.action.type === "menu") {
        walk(command.action.children);
      }
    }
  };
  walk(commands);
  return index;
}

/** The item the open page shows. Where several match (nested alert sections), the deepest path wins. */
function openItem(commands: readonly PaletteCommand[], location: string): PaletteCommand | undefined {
  const href = (command: PaletteCommand) => (command.action.type === "navigate" ? command.action.href : "");
  return commands
    .filter((command) => command.isOpenAt?.(location) && (command.children?.length ?? 0) > 0)
    .sort((a, b) => href(b).length - href(a).length)[0];
}

function PaletteContent({ onClose }: { onClose: () => void }) {
  const [location, navigate] = useLocation();
  const { instance, instances, setInstance } = useInstance();
  const { toast } = useToast();
  const recentIds = useStore($paletteRecents);

  const [query, setQuery] = useState("");
  const [stack, setStack] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const hosting = instance?.hosting;
  const navigation = useMemo(() => navigationCommands(hosting), [hosting]);
  const items = useItemCommands(instance);
  const actions = useActionCommands(instance, instances, setInstance);

  // Rebuilt each render: the sources return fresh lists whenever their data moves, and a
  // few hundred entries are cheap to index.
  const root = [...navigation, ...actions, ...items];
  const index = every(root);
  const searchable = [...root, ...root.flatMap((command) => command.children ?? [])];

  // A page whose command has gone (its item was deleted while open) falls back to its parent.
  const pageStack = stack.filter((id) => index.has(id));
  const page = pageStack.length > 0 ? index.get(pageStack[pageStack.length - 1]) : undefined;
  const prompt = page?.action.type === "prompt" ? page.action.prompt : undefined;

  function changeQuery(next: string) {
    setQuery(next);
    setConfirmingId(null);
  }

  // Clearing the selection lets cmdk select the new list's first row; it only does so on
  // its own when the search text changes, and that is often already empty.
  function openPage(command: PaletteCommand) {
    setStack([...pageStack, command.id]);
    setSelected("");
    changeQuery("");
  }

  function back() {
    setStack(pageStack.slice(0, -1));
    setSelected("");
    changeQuery("");
  }

  async function perform(label: string, run: () => Promise<string | undefined>, keepOpen: boolean, id: string) {
    if (keepOpen) {
      setBusyId(id);
    } else {
      onClose();
    }
    try {
      const message = await run();
      if (message) {
        toast({ title: message });
      }
    } catch (err) {
      toast({
        title: `${label} failed`,
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  function choose(row: Row) {
    const { command } = row;
    if (command.confirm && confirmingId !== row.key) {
      setConfirmingId(row.key);
      return;
    }
    setConfirmingId(null);
    $paletteRecents.set(pushRecent(recentIds, command.id));

    if (row.argument !== undefined && command.action.type === "prompt") {
      submitPrompt(command, command.action.prompt, row.argument);
      return;
    }
    const { action } = command;
    switch (action.type) {
      case "navigate": {
        onClose();
        navigate(action.href);
        return;
      }
      case "run": {
        void perform(command.title, action.run, action.keepOpen ?? false, row.key);
        return;
      }
      case "menu":
      case "prompt": {
        openPage(command);
        return;
      }
    }
  }

  function submitPrompt(command: PaletteCommand, target: PalettePrompt, text: string) {
    const trimmed = text.trim();
    if (trimmed === "" && !target.allowEmpty) {
      return;
    }
    void perform(command.title.replace(/…$/, ""), () => target.run(trimmed), false, command.id);
  }

  const sections = buildSections();

  function buildSections(): RowSection[] {
    const toRow = (command: PaletteCommand): Row => ({ key: command.id, command, title: command.title });
    const asRows = (list: PaletteSection<PaletteCommand>[]) =>
      list.map((section) => ({ heading: section.heading, entries: section.entries.map(toRow) }));

    if (prompt && page) {
      return [
        {
          heading: page.title.replace(/…$/, ""),
          entries: [
            { key: `${page.id}:submit`, command: page, argument: query, title: prompt.submitLabel(query.trim()) },
          ],
        },
      ];
    }
    // Inside a page its entries are the whole list, so none waits for a search.
    const listed = (list: readonly PaletteCommand[]) =>
      list.map((command) => ({ ...command, hiddenUntilSearch: false }));
    if (page?.action.type === "menu") {
      return asRows(rankEntries(listed(page.action.children), query));
    }
    if (page) {
      const self: PaletteCommand = { ...page, title: "Open", subtitle: page.title, children: undefined };
      return asRows(rankEntries(listed([self, ...(page.children ?? [])]), query));
    }

    const { scope, text } = parseQuery(query);
    const ranked = asRows(
      rankEntries(searchable, query, {
        recentIds,
        hideWhenEmpty: ["item"],
        limitPerGroup: scope === "all" ? SEARCH_LIMIT_PER_GROUP : undefined,
      })
    );

    if (text.length > 0) {
      const inline: Row[] = [];
      for (const command of searchable) {
        if (command.action.type !== "prompt" || !command.action.prompt.aliases) {
          continue;
        }
        const argument = inlineArgument(query, command.action.prompt.aliases);
        if (argument !== null) {
          inline.push({
            key: `${command.id}:inline`,
            command,
            argument,
            title: command.action.prompt.submitLabel(argument),
          });
        }
      }
      return inline.length > 0 ? [{ heading: "Run", entries: inline }, ...ranked] : ranked;
    }

    const current = openItem(root, location);
    if (!current || scope !== "all") {
      return ranked;
    }
    const here = [current, ...(current.children ?? [])];
    const hereIds = new Set(here.map((command) => command.id));
    const rest = ranked
      .map((section) =>
        section.heading === RECENT_HEADING
          ? { ...section, entries: section.entries.filter((row) => !hereIds.has(row.key)) }
          : section
      )
      .filter((section) => section.entries.length > 0);
    return [
      {
        heading: ON_THIS_PAGE_HEADING,
        entries: here.map(toRow),
      },
      ...rest,
    ];
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Backspace" && query === "" && pageStack.length > 0) {
      event.preventDefault();
      back();
      return;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      const target = index.get(selected);
      if (target && ((target.children?.length ?? 0) > 0 || target.action.type === "menu")) {
        event.preventDefault();
        openPage(target);
      }
    }
  }

  const placeholder = prompt
    ? prompt.placeholder
    : page
      ? `Search ${page.title.replace(/…$/, "")}…`
      : "Search pages, items and actions…";

  return (
    <DialogContent
      className="overflow-hidden p-0 shadow-lg max-w-xl top-[15%] translate-y-0 sm:top-[20%]"
      onEscapeKeyDown={(event) => {
        if (pageStack.length > 0) {
          event.preventDefault();
          back();
        }
      }}
    >
      <DialogTitle className="sr-only">Quick actions</DialogTitle>
      <DialogDescription className="sr-only">
        Search for a page, an item or an action, then press Enter.
      </DialogDescription>
      <Command
        shouldFilter={false}
        value={selected}
        onValueChange={setSelected}
        onKeyDown={onKeyDown}
        loop
        className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5"
      >
        {pageStack.length > 0 && (
          <div className="flex items-center gap-1 border-b px-3 py-2 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={back}
              className="flex items-center gap-1 rounded px-1 hover:text-foreground"
              data-testid="palette-back"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            {pageStack.map((id) => (
              <span key={id} className="flex items-center gap-1 truncate">
                <ChevronRight className="h-3 w-3 shrink-0" />
                <span className="truncate font-medium text-foreground">{index.get(id)?.title}</span>
              </span>
            ))}
          </div>
        )}
        <CommandInput value={query} onValueChange={changeQuery} placeholder={placeholder} data-testid="palette-input" />
        <CommandList className="max-h-[min(60vh,440px)]">
          <CommandEmpty>{instance ? "Nothing matches." : "Nothing matches — pick an instance for more."}</CommandEmpty>
          {sections.map((section, sectionIndex) => (
            <div key={section.heading}>
              {sectionIndex > 0 && <CommandSeparator />}
              <CommandGroup heading={section.heading}>
                {section.entries.map((row) => (
                  <PaletteRow
                    key={row.key}
                    row={row}
                    confirming={confirmingId === row.key}
                    busy={busyId === row.key}
                    disabled={row.argument !== undefined && row.argument.trim() === "" && !prompt?.allowEmpty}
                    onChoose={() => choose(row)}
                    onOpenChildren={() => openPage(row.command)}
                  />
                ))}
              </CommandGroup>
            </div>
          ))}
        </CommandList>
        <PaletteFooter atRoot={pageStack.length === 0} />
      </Command>
    </DialogContent>
  );
}

interface PaletteRowProps {
  row: Row;
  confirming: boolean;
  busy: boolean;
  disabled: boolean;
  onChoose: () => void;
  onOpenChildren: () => void;
}

function PaletteRow({ row, confirming, busy, disabled, onChoose, onOpenChildren }: PaletteRowProps) {
  const { command } = row;
  const Icon = command.icon;
  const hasChildren = (command.children?.length ?? 0) > 0 && row.argument === undefined;
  const opensPage = command.action.type === "menu" || (command.action.type === "prompt" && row.argument === undefined);

  return (
    <CommandItem
      value={row.key}
      onSelect={onChoose}
      disabled={disabled}
      className={cn("group", confirming && "text-destructive data-[selected=true]:text-destructive")}
      data-testid={`palette-item-${row.key}`}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Icon className="text-muted-foreground" />}
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate">{confirming ? `${command.title} — press Enter again to confirm` : row.title}</span>
        {command.subtitle && !confirming && (
          <span className="truncate text-xs text-muted-foreground">{command.subtitle}</span>
        )}
      </div>
      {command.meta && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{command.meta}</span>}
      {hasChildren && (
        <button
          type="button"
          aria-label={`Actions for ${command.title}`}
          className="flex shrink-0 items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground"
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onOpenChildren();
          }}
        >
          <kbd className="hidden rounded border bg-muted px-1 font-system-mono text-[10px] group-data-[selected=true]:inline">
            Tab
          </kbd>
          <ChevronRight />
        </button>
      )}
      {opensPage && !hasChildren && <ChevronRight className="text-muted-foreground" />}
    </CommandItem>
  );
}

function PaletteFooter({ atRoot }: { atRoot: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <CornerDownLeft className="h-3 w-3" /> select
      </span>
      <span>
        <Kbd>Tab</Kbd> actions
      </span>
      <span>
        <Kbd>{atRoot ? "Esc" : "⌫"}</Kbd> {atRoot ? "close" : "back"}
      </span>
      {atRoot && (
        <span className="ml-auto hidden gap-3 sm:flex">
          {SCOPE_PREFIXES.map(({ prefix, label }) => (
            <span key={prefix}>
              <Kbd>{prefix}</Kbd> {label.toLowerCase()}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border bg-muted px-1 font-system-mono text-[10px]">{children}</kbd>;
}
