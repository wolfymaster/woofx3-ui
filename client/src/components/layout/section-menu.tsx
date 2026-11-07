import { Menu } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SHEET_MOTION } from "@/lib/sheet-motion";
import { cn } from "@/lib/utils";
import type { NavItem } from "./nav-config";
import { SectionNavList } from "./section-sidebar";

interface SectionMenuProps {
  title: string;
  items: NavItem[];
  location: string;
}

/**
 * A phone's way into the active section: a header button opening the same entries the
 * section rail shows from tablet width up, with their labels, in a sheet from the left.
 */
export function SectionMenu({ title, items, location }: SectionMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 md:hidden"
          aria-label={`Open ${title} menu`}
          data-testid="button-section-menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className={cn("w-72 overflow-y-auto p-0", SHEET_MOTION)} aria-describedby={undefined}>
        <SheetHeader className="px-4 py-4">
          <SheetTitle className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </SheetTitle>
        </SheetHeader>
        <nav aria-label={`${title} navigation`}>
          <SectionNavList items={items} location={location} collapsed={false} onNavigate={() => setOpen(false)} />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
