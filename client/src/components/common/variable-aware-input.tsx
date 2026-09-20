import { Braces } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type SyntheticEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toDisplayText, toStoredText, variableNames } from "@/lib/variable-display";
import { flattenVariableMenu, insertVariableReference, variableMenuGroups } from "@/lib/variable-menu";
import type { VariableOption } from "@/lib/workflow-variables";

/**
 * The open variable menu. `typed` follows a "{" the user is typing in the field, and
 * closes once there is nothing left to suggest. `browse` was opened from the field's
 * button, searches from a box of its own, and stays open with no matches so the
 * search can be corrected.
 */
interface VariableMenu {
  source: "typed" | "browse";
  /** Index in the displayed text where the inserted reference will start. */
  start: number;
  /** Index in the displayed text where the replaced range ends. */
  end: number;
  query: string;
}

/**
 * If the cursor sits inside an unclosed "{...", returns where it started and what's been
 * typed since. A "}" or newline between the "{" and the cursor means it's already closed
 * (or the user moved on), so no menu.
 */
function findTypedReference(text: string, cursor: number): VariableMenu | null {
  const uptoCursor = text.slice(0, cursor);
  const brace = uptoCursor.lastIndexOf("{");
  if (brace === -1) {
    return null;
  }
  const since = uptoCursor.slice(brace + 1);
  if (since.includes("}") || since.includes("\n")) {
    return null;
  }
  // Someone used to the engine's syntax types "${"; the "$" goes with the reference it opens.
  const start = brace > 0 && uptoCursor[brace - 1] === "$" ? brace - 1 : brace;
  return { source: "typed", start, end: cursor, query: since };
}

interface VariableAwareInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  className?: string;
  /** Variables offered when the user types "{" — see computeAvailableVariables. */
  availableVariables: VariableOption[];
  "data-testid"?: string;
}

/**
 * A text input/textarea for values that may reference workflow variables. The stored
 * value carries the engine's full `${trigger.data.firstName}` references, but the field
 * shows each known one by its short name, `{firstName}` (see variable-display.ts).
 * Typing "{", or pressing the field's variable button, opens a menu of the variables
 * available at this point in the workflow, and choosing one inserts its short name.
 */
export function VariableAwareInput({
  id,
  value,
  onChange,
  placeholder,
  multiline,
  rows,
  className,
  availableVariables,
  "data-testid": testId,
}: VariableAwareInputProps) {
  const [menu, setMenu] = useState<VariableMenu | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const elementRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // The field loses its selection to the search box while browsing, so the insert
  // range comes from the last selection the field reported.
  const lastSelection = useRef<{ start: number; end: number } | null>(null);
  const listId = useId();

  const names = useMemo(() => variableNames(availableVariables), [availableVariables]);
  const displayed = toDisplayText(value, names);
  const hasVariables = availableVariables.length > 0;

  const groups = useMemo(
    () => (menu ? variableMenuGroups(availableVariables, names, menu.query) : []),
    [menu, availableVariables, names]
  );
  const items = useMemo(() => flattenVariableMenu(groups), [groups]);
  const activePosition = Math.min(activeIndex, items.length - 1);
  const active = items[activePosition];
  const open = menu !== null && (menu.source === "browse" || items.length > 0);
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    if (open && activePosition >= 0) {
      document.getElementById(`${listId}-option-${activePosition}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [open, activePosition, listId]);

  // A new query, or a menu opened a different way, starts again from the top match.
  const updateMenu = (next: VariableMenu | null) => {
    if (next?.query !== menu?.query || next?.source !== menu?.source) {
      setActiveIndex(0);
    }
    setMenu(next);
  };

  const rememberSelection = (el: HTMLInputElement | HTMLTextAreaElement) => {
    const start = el.selectionStart ?? el.value.length;
    lastSelection.current = { start, end: el.selectionEnd ?? start };
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange(toStoredText(e.target.value, names));
    rememberSelection(e.target);
    updateMenu(findTypedReference(e.target.value, e.target.selectionStart ?? e.target.value.length));
  };

  // Moving the cursor into or out of an unclosed "{" opens or closes the menu, as typing does.
  const handleSelect = (e: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    rememberSelection(el);
    if (menu?.source === "browse") {
      return;
    }
    updateMenu(findTypedReference(el.value, el.selectionStart ?? el.value.length));
  };

  const closeMenu = () => {
    const wasBrowsing = menu?.source === "browse";
    setMenu(null);
    if (wasBrowsing) {
      elementRef.current?.focus();
    }
  };

  const openBrowse = () => {
    // A reference half typed is replaced, and its text carries over as the search.
    if (menu?.source === "typed") {
      updateMenu({ ...menu, source: "browse" });
      return;
    }
    const end = displayed.length;
    const selection = lastSelection.current ?? { start: end, end };
    updateMenu({
      source: "browse",
      start: Math.min(selection.start, end),
      end: Math.min(selection.end, end),
      query: "",
    });
  };

  const choose = (index: number) => {
    const item = items[index];
    if (!menu || !item) {
      return;
    }
    const inserted = insertVariableReference(displayed, menu.start, menu.end, item.name);
    onChange(toStoredText(inserted.text, names));
    setMenu(null);
    lastSelection.current = { start: inserted.cursor, end: inserted.cursor };
    requestAnimationFrame(() => {
      const el = elementRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(inserted.cursor, inserted.cursor);
      }
    });
  };

  /** Keys the menu handles, from whichever element holds focus: the field or the search box. */
  const handleMenuKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!open) {
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length > 0) {
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((activePosition + step + items.length) % items.length);
      }
    } else if ((e.key === "Enter" || e.key === "Tab") && active) {
      e.preventDefault();
      choose(activePosition);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  };

  const typedMenuOpen = open && menu?.source === "typed";
  const fieldProps = {
    id,
    ref: elementRef,
    value: displayed,
    onChange: handleChange,
    onSelect: handleSelect,
    onKeyDown: handleMenuKeyDown,
    onFocus: () => {
      if (menu?.source === "browse") {
        setMenu(null);
      }
    },
    onBlur: () => {
      if (menu?.source === "typed") {
        setMenu(null);
      }
    },
    placeholder,
    className: cn(className, hasVariables && "pr-9"),
    role: "combobox",
    "aria-autocomplete": "list" as const,
    "aria-expanded": typedMenuOpen,
    "aria-controls": typedMenuOpen ? listId : undefined,
    "aria-activedescendant": typedMenuOpen && active ? optionId(activePosition) : undefined,
    "data-testid": testId,
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          closeMenu();
        }
      }}
    >
      <PopoverAnchor asChild>
        <div className="relative">
          {multiline ? <Textarea {...fieldProps} rows={rows ?? 3} /> : <Input {...fieldProps} type="text" />}
          {hasVariables && (
            <button
              type="button"
              className={cn(
                "absolute right-1 flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                multiline ? "top-1" : "top-1/2 -translate-y-1/2",
                menu?.source === "browse" && "bg-accent text-foreground"
              )}
              // Keeps focus, and so the selection, in the field: that is where the variable goes.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (menu?.source === "browse" ? closeMenu() : openBrowse())}
              title="Insert a variable"
              aria-label="Insert a variable"
              data-testid={testId ? `${testId}-insert-variable` : undefined}
            >
              <Braces className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="w-72 p-0"
        align="start"
        collisionPadding={8}
        onOpenAutoFocus={(e) => {
          // A typed menu leaves focus in the field so typing carries on; browsing focuses its search box.
          if (menu?.source === "typed") {
            e.preventDefault();
          }
        }}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          // The field and its button open and close the menu themselves.
          if (e.target instanceof Node && elementRef.current?.parentElement?.contains(e.target)) {
            e.preventDefault();
          }
        }}
        onMouseDown={(e) => {
          // A click in a typed menu must not take focus from the field, or the menu closes with it.
          if (menu?.source === "typed") {
            e.preventDefault();
          }
        }}
      >
        {menu?.source === "browse" && (
          <div className="border-b p-2">
            <Input
              autoFocus
              value={menu.query}
              onChange={(e) => updateMenu({ ...menu, query: e.target.value })}
              onKeyDown={handleMenuKeyDown}
              placeholder="Search variables"
              className="h-8 text-sm"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={active ? optionId(activePosition) : undefined}
              data-testid={testId ? `${testId}-variable-search` : undefined}
            />
          </div>
        )}
        <div id={listId} role="listbox" className="max-h-60 overflow-y-auto p-1">
          {groups.map((group) => (
            // biome-ignore lint/a11y/useSemanticElements: a listbox groups its options with role="group"; a fieldset holds form controls
            <div key={group.group} role="group" aria-label={group.group}>
              <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {group.group}
              </div>
              {group.items.map((item) => {
                const index = items.indexOf(item);
                const isActive = index === activePosition;
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard reaches options through the combobox, which points at the active one with aria-activedescendant
                  <div
                    key={item.option.value}
                    id={optionId(index)}
                    role="option"
                    tabIndex={-1}
                    aria-selected={isActive}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5",
                      isActive && "bg-accent text-accent-foreground"
                    )}
                    onMouseMove={() => {
                      if (!isActive) {
                        setActiveIndex(index);
                      }
                    }}
                    onClick={() => choose(index)}
                    data-testid={`variable-option-${item.option.value}`}
                  >
                    <span className="truncate font-mono text-xs">{`{${item.name}}`}</span>
                    {item.option.type && (
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                        {item.option.type}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {items.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">No variables match.</p>
          )}
        </div>
        <div className="space-y-1 border-t px-3 py-2">
          {active && <VariableDetail option={active.option} name={active.name} />}
          <p className="space-x-2 text-[10px] text-muted-foreground">
            <span>↑↓ move</span>
            <span>↵ insert</span>
            <span>esc close</span>
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The highlighted variable's description, or its label when that says more than its name. */
function VariableDetail({ option, name }: { option: VariableOption; name: string }) {
  const detail = option.description ?? (option.label !== name ? option.label : undefined);
  if (!detail) {
    return null;
  }
  return <p className="line-clamp-2 text-xs">{detail}</p>;
}
