import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isSectionActive, type NavSection } from "./nav-config";

/** The header's right-hand cluster: one icon button per utility section, named by its tooltip. */
export function UtilityNav({ sections, location }: { sections: NavSection[]; location: string }) {
  return (
    <div className="hidden md:flex items-center gap-1">
      {sections.map((section) => {
        const isActive = isSectionActive(section, location);
        return (
          <Link key={section.id} href={section.href}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  size="icon"
                  className={cn("h-8 w-8", isActive && "bg-background shadow-sm")}
                  data-testid={`nav-${section.id}`}
                >
                  <section.icon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{section.label}</TooltipContent>
            </Tooltip>
          </Link>
        );
      })}
    </div>
  );
}
