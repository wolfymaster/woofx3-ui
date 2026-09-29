/**
 * Converts a Lucide file/kebab name to the PascalCase name lucide-react exports
 * it under. Each hyphen-separated part is capitalised whole, which is why
 * "grid-2x2" becomes "Grid2x2" and "arrow-down-0-1" becomes "ArrowDown01"; the
 * reverse is ambiguous, so lookups always go from the kebab keys to PascalCase.
 */
export function kebabToPascal(kebab: string): string {
  return kebab
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
