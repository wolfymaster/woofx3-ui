import { addTagProblem, MAX_TAGS } from "@convex/lib/streamInfo";
import { X } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}

/**
 * Chips plus an input. Enter or a comma commits the typed tag; a tag Twitch
 * would refuse stays in the box with the reason under it, so the fix is one
 * edit away rather than a failed save later.
 */
export function TagEditor({ tags, onChange, disabled }: TagEditorProps) {
  const [input, setInput] = useState("");
  const candidate = input.trim();
  const problem = candidate ? addTagProblem(tags, candidate) : null;

  const commit = () => {
    if (!candidate || problem) {
      return;
    }
    onChange([...tags, candidate]);
    setInput("");
  };

  return (
    <div className="space-y-1.5">
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Tags">
          {tags.map((tag) => (
            <li
              key={tag.toLowerCase()}
              className="flex items-center gap-0.5 rounded-full bg-secondary py-0.5 pl-2 pr-1 text-xs"
              data-testid={`stream-info-tag-${tag}`}
            >
              {tag}
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                disabled={disabled}
                aria-label={`Remove tag ${tag}`}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={input}
          onChange={(e) => {
            const value = e.target.value;
            // A comma is how people separate tags when pasting a list; treat it
            // as Enter rather than as a character Twitch would refuse anyway.
            if (value.endsWith(",")) {
              const typed = value.slice(0, -1).trim();
              if (typed && !addTagProblem(tags, typed)) {
                onChange([...tags, typed]);
                setInput("");
                return;
              }
            }
            setInput(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Backspace" && input === "" && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          placeholder={tags.length >= MAX_TAGS ? "Tag limit reached" : "Add a tag…"}
          className={cn("h-8 text-sm", problem && "border-destructive focus-visible:ring-destructive")}
          disabled={disabled}
          aria-label="Add a tag"
          aria-invalid={problem !== null}
          aria-describedby={problem ? "stream-info-tag-problem" : undefined}
          data-testid="input-stream-info-tag"
        />
        <span
          className={cn(
            "shrink-0 text-[10px] tabular-nums",
            tags.length >= MAX_TAGS ? "text-amber-500" : "text-muted-foreground"
          )}
        >
          {tags.length}/{MAX_TAGS}
        </span>
      </div>
      {problem && (
        <p id="stream-info-tag-problem" className="text-xs text-destructive" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
