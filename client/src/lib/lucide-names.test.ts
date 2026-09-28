import { describe, expect, test } from "bun:test";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import { ICON_SET } from "@/lib/icon-set";
import { LUCIDE_ALIASES } from "@/lib/lucide-aliases.generated";
import { kebabToPascal } from "@/lib/lucide-names";
import { readLucideAliases, readLucideExports } from "../../../script/generate-lucide-aliases";

const kebabNames = Object.keys(dynamicIconImports);

describe("kebabToPascal", () => {
  test("capitalises each part whole, digits included", () => {
    expect(kebabToPascal("circle-help")).toBe("CircleHelp");
    expect(kebabToPascal("grid-2x2")).toBe("Grid2x2");
    expect(kebabToPascal("arrow-down-0-1")).toBe("ArrowDown01");
  });

  test("names every dynamically importable icon as lucide-react exports it", () => {
    const exports = readLucideExports();
    const mismatched = kebabNames.filter((kebab) => !exports.get(kebab)?.includes(kebabToPascal(kebab)));
    expect(mismatched).toEqual([]);
  });
});

describe("LUCIDE_ALIASES", () => {
  test("matches the installed lucide-react (regenerate with bun script/generate-lucide-aliases.ts)", () => {
    expect(LUCIDE_ALIASES).toEqual(readLucideAliases());
  });

  test("points every alias at an icon dynamicIconImports can load", () => {
    const dangling = Object.entries(LUCIDE_ALIASES).filter(([, kebab]) => !kebabNames.includes(kebab));
    expect(dangling).toEqual([]);
  });
});

describe("ICON_SET", () => {
  test("is keyed by canonical names, so the picker never offers an icon twice", () => {
    const canonical = new Set(kebabNames.map(kebabToPascal));
    expect(Object.keys(ICON_SET).filter((name) => !canonical.has(name))).toEqual([]);
  });
});
