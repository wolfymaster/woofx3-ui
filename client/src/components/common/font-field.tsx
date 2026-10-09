import type * as GoogleFonts from "@woofx3/api/google-fonts";
import { Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfigFieldDescription, ConfigFieldLabel } from "@/components/common/config-field-label";
import { Button } from "@/components/ui/button";
import {
  Command as ComboBox,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fontPreviewStylesheetUrl, matchFontFamilies } from "@/lib/font-field";
import { cn } from "@/lib/utils";

type GoogleFontsModule = typeof GoogleFonts;

interface FontFieldProps {
  field: {
    id: string;
    label: string;
    required?: boolean;
    hint?: unknown;
    examplePayload?: unknown;
    description?: unknown;
    defaultValue?: unknown;
  };
  value: unknown;
  onChange: (value: unknown) => void;
}

/**
 * The catalog is tens of KB and only this picker needs it, so it is fetched as
 * its own chunk the first time a font field renders rather than shipped with
 * every page.
 */
let catalog: Promise<GoogleFontsModule> | null = null;

function loadCatalog(): Promise<GoogleFontsModule> {
  catalog ??= import("@woofx3/api/google-fonts");
  return catalog;
}

/** Families whose preview stylesheet has been linked; each is fetched once per page load. */
const previewed = new Set<string>();

function usePreviews(families: readonly string[]): void {
  useEffect(() => {
    const missing = families.filter((family) => !previewed.has(family));
    const href = fontPreviewStylesheetUrl(missing);
    if (href === null) {
      return;
    }
    for (const family of missing) {
      previewed.add(family);
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }, [families]);
}

/**
 * A `font` field: any Google Fonts family, searched by name and shown in its
 * own face, or a family typed in by hand (one installed on the streaming
 * machine). The engine fetches and serves a Google family to the overlay; see
 * google-fonts.ts in the engine's shared api package.
 */
export function FontField({ field, value, onChange }: FontFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [fonts, setFonts] = useState<GoogleFontsModule | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCatalog().then((loaded) => {
      if (!cancelled) {
        setFonts(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const current = typeof value === "string" && fonts ? fonts.primaryFontFamily(value) : null;
  const fallback = typeof field.defaultValue === "string" && fonts ? fonts.primaryFontFamily(field.defaultValue) : null;
  const matches = useMemo(
    () => (fonts && open ? matchFontFamilies(fonts.googleFontFamilies(), query) : []),
    [fonts, open, query]
  );
  const previewFamilies = useMemo(() => {
    const names = matches.map((entry) => entry.family);
    if (current !== null && fonts?.findGoogleFontFamily(current)) {
      names.push(current);
    }
    return names;
  }, [matches, current, fonts]);
  usePreviews(previewFamilies);

  const typed = query.trim();
  const offerTyped = typed !== "" && !matches.some((entry) => entry.family.toLowerCase() === typed.toLowerCase());

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="space-y-2">
      <ConfigFieldLabel
        htmlFor={field.id}
        label={field.label}
        required={field.required}
        hint={field.hint as string | undefined}
        examplePayload={field.examplePayload as string | undefined}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={field.id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
            data-testid={`input-${field.id}`}
          >
            {current !== null ? (
              <span className="truncate" style={{ fontFamily: typeof value === "string" ? value : undefined }}>
                {current}
              </span>
            ) : (
              <span className="truncate text-muted-foreground">{fallback ?? "Choose a font..."}</span>
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
          {/* Filtering is done here: cmdk would otherwise score all ~2,000 families on every keystroke. */}
          <ComboBox shouldFilter={false}>
            <CommandInput placeholder="Search fonts..." value={query} onValueChange={setQuery} />
            <CommandList>
              {fonts === null ? (
                <CommandEmpty>Loading fonts...</CommandEmpty>
              ) : (
                <CommandEmpty>No matching fonts.</CommandEmpty>
              )}
              {offerTyped && (
                <CommandGroup heading="Installed font">
                  <CommandItem value={`typed:${typed}`} onSelect={() => choose(typed)}>
                    Use "{typed}"
                  </CommandItem>
                </CommandGroup>
              )}
              {matches.length > 0 && (
                <CommandGroup heading="Google Fonts">
                  {matches.map((entry) => (
                    <CommandItem
                      key={entry.family}
                      value={entry.family}
                      onSelect={() => fonts && choose(fonts.googleFontValue(entry))}
                    >
                      <Check className={cn("h-4 w-4", current === entry.family ? "opacity-100" : "opacity-0")} />
                      <span className="truncate" style={{ fontFamily: fonts?.googleFontValue(entry) }}>
                        {entry.family}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </ComboBox>
        </PopoverContent>
      </Popover>
      <ConfigFieldDescription description={field.description as string | undefined} />
    </div>
  );
}
