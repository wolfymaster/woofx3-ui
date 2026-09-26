import { Palette } from "lucide-react";
import { Link } from "wouter";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/hooks/use-theme";
import { themePalettes } from "@/lib/theme/palettes";
import { CUSTOM_PALETTE_ID, parseThemeModePreference } from "@/lib/theme/resolve";

/** Quick theme switcher for account menus; the full editor lives on the Appearance page. */
export function ThemeMenuSub() {
  const { modePreference, setMode, paletteId, selectPalette } = useTheme();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Palette className="mr-2 h-4 w-4" />
        Theme
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Mode</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={modePreference} onValueChange={(v) => setMode(parseThemeModePreference(v))}>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Palette</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={paletteId} onValueChange={selectPalette}>
          {themePalettes.map((palette) => (
            <DropdownMenuRadioItem key={palette.id} value={palette.id}>
              {palette.name}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuRadioItem value={CUSTOM_PALETTE_ID}>Custom</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/admin/appearance">Customize…</Link>
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
