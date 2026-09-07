import { type ChangeEvent, type KeyboardEvent, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import type { VariableOption } from "@/lib/workflow-variables";

interface OpenTrigger {
  /** Index of the "$" in "${" that opened this trigger. */
  start: number;
  /** Text typed since "${", used to filter the suggestion list. */
  query: string;
}

/**
 * If the cursor sits inside an unclosed "${...", returns where it started and what's been
 * typed since. A "}" or newline between the "${" and the cursor means it's already closed
 * (or the user moved on) — no trigger.
 */
function findOpenTrigger(value: string, cursor: number): OpenTrigger | null {
  const uptoCursor = value.slice(0, cursor);
  const start = uptoCursor.lastIndexOf("${");
  if (start === -1) {
    return null;
  }
  const since = uptoCursor.slice(start + 2);
  if (since.includes("}") || since.includes("\n")) {
    return null;
  }
  return { start, query: since };
}

interface VariableAwareInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  className?: string;
  /** Variables offered when the user types "${" — see computeAvailableVariables. */
  availableVariables: VariableOption[];
  "data-testid"?: string;
}

/**
 * A text input/textarea that recognizes the workflow engine's `${stepId.field}` syntax:
 * typing "${" opens a filtered picker of variables available at this point in the workflow
 * (see workflow-variables.ts), and selecting one inserts `${value}` at the cursor.
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
  ...rest
}: VariableAwareInputProps) {
  const [trigger, setTrigger] = useState<OpenTrigger | null>(null);
  const elementRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const filtered = useMemo(() => {
    if (!trigger) {
      return [];
    }
    const q = trigger.query.toLowerCase();
    if (!q) {
      return availableVariables;
    }
    return availableVariables.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.value.toLowerCase().includes(q) ||
        opt.group.toLowerCase().includes(q) ||
        (opt.type?.toLowerCase().includes(q) ?? false) ||
        (opt.description?.toLowerCase().includes(q) ?? false)
    );
  }, [trigger, availableVariables]);

  const open = trigger !== null && filtered.length > 0;

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange(e.target.value);
    setTrigger(findOpenTrigger(e.target.value, e.target.selectionStart ?? e.target.value.length));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Escape" && trigger) {
      setTrigger(null);
    }
  };

  const selectVariable = (option: VariableOption) => {
    if (!trigger) {
      return;
    }
    const triggerEnd = trigger.start + 2 + trigger.query.length;
    const before = value.slice(0, trigger.start);
    const after = value.slice(triggerEnd);
    const next = `${before}${option.value}${after}`;
    onChange(next);
    setTrigger(null);
    const cursorAfterInsert = before.length + option.value.length;
    requestAnimationFrame(() => {
      const el = elementRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(cursorAfterInsert, cursorAfterInsert);
      }
    });
  };

  return (
    <Popover open={open}>
      {/* PopoverTrigger renders Primitive.button with type="button" by default; with asChild,
          Radix's Slot only keeps a prop from the wrapped child if the child sets it explicitly,
          so the <Input> below must set type="text" itself or it silently becomes an
          uneditable type="button" input. */}
      <PopoverTrigger asChild>
        {multiline ? (
          <Textarea
            id={id}
            ref={elementRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setTrigger(null)}
            placeholder={placeholder}
            rows={rows ?? 3}
            className={className}
            {...rest}
          />
        ) : (
          <Input
            id={id}
            type="text"
            ref={elementRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setTrigger(null)}
            placeholder={placeholder}
            className={className}
            {...rest}
          />
        )}
      </PopoverTrigger>
      <PopoverContent
        className="w-80 max-h-64 overflow-y-auto p-1"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {filtered.map((option) => (
          <button
            key={option.value}
            type="button"
            className="flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onMouseDown={(e) => {
              e.preventDefault();
              selectVariable(option);
            }}
            data-testid={`variable-option-${option.value}`}
          >
            <span className="flex w-full items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground truncate">{option.value}</span>
              {option.type && (
                <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {option.type}
                </span>
              )}
            </span>
            <span>
              {option.label} <span className="text-xs text-muted-foreground">— {option.group}</span>
            </span>
            {option.description && (
              <span className="text-xs text-muted-foreground line-clamp-2">{option.description}</span>
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
