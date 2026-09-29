import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { StreamCategory } from "@convex/lib/streamInfo";
import { useAction } from "convex/react";
import { Gamepad2, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn } from "@/lib/utils";

/** Long enough that a typed word is one Helix call, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 300;

const BOX_ART_SIZES = { md: "h-12 w-9", sm: "h-8 w-6" } as const;

export function CategoryBoxArt({
  category,
  size = "md",
}: {
  category: StreamCategory | null;
  size?: keyof typeof BOX_ART_SIZES;
}) {
  if (category?.boxArtUrl) {
    return (
      <img
        src={category.boxArtUrl}
        alt=""
        className={cn(BOX_ART_SIZES[size], "shrink-0 rounded-sm object-cover")}
        loading="lazy"
      />
    );
  }
  return (
    <div className={cn(BOX_ART_SIZES[size], "flex shrink-0 items-center justify-center rounded-sm bg-muted")}>
      <Gamepad2 className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

interface CategoryPickerProps {
  instanceId: Id<"instances">;
  value: StreamCategory | null;
  onChange: (category: StreamCategory | null) => void;
  disabled?: boolean;
}

export function CategoryPicker({ instanceId, value, onChange, disabled }: CategoryPickerProps) {
  const searchCategories = useAction(api.streamInfo.searchCategories);
  const [query, setQuery] = useState("");
  const settledQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const [results, setResults] = useState<{ query: string; categories: StreamCategory[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settledQuery) {
      setResults(null);
      setError(null);
      return;
    }
    // Responses can land out of order; only the one for the query still in the
    // box is allowed to replace the list.
    let current = true;
    searchCategories({ instanceId, query: settledQuery })
      .then((categories) => {
        if (current) {
          setResults({ query: settledQuery, categories });
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (current) {
          setResults(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      current = false;
    };
  }, [instanceId, settledQuery, searchCategories]);

  const searching = query.trim() !== "" && results?.query !== query.trim() && error === null;

  const pick = (category: StreamCategory) => {
    onChange(category);
    setQuery("");
    setResults(null);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <CategoryBoxArt category={value} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" data-testid="stream-info-category">
            {value?.name ?? <span className="text-muted-foreground">No category</span>}
          </p>
        </div>
        {value && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground"
            onClick={() => onChange(null)}
            disabled={disabled}
            aria-label="Clear category"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="relative">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results?.categories[0]) {
              e.preventDefault();
              pick(results.categories[0]);
            }
            if (e.key === "Escape") {
              setQuery("");
            }
          }}
          placeholder="Search categories…"
          className="h-8 text-sm"
          disabled={disabled}
          aria-label="Search categories"
          data-testid="input-stream-info-category-search"
        />
        {searching && (
          <Loader2 className="absolute right-2 top-2 h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {results && query.trim() !== "" && (
        <ul className="max-h-48 overflow-auto rounded-md border border-border" aria-label="Matching categories">
          {results.categories.length === 0 ? (
            <li className="p-2 text-xs text-muted-foreground">No categories match "{results.query}"</li>
          ) : (
            results.categories.map((category) => (
              <li key={category.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 p-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => pick(category)}
                  data-testid={`stream-info-category-option-${category.id}`}
                >
                  <CategoryBoxArt category={category} size="sm" />
                  <span className="truncate">{category.name}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
