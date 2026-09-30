import type { SetupPlatform } from "@convex/lib/setupPlatforms";
import { Check } from "lucide-react";
import { getCategoryBannerStyle, getCategoryIcon } from "@/components/modules/module-category";
import { ModuleBannerImage, ModuleIconImage } from "@/components/modules/module-image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { describePermissions } from "@/lib/module-permissions";
import { cn } from "@/lib/utils";

interface SetupPlatformCardProps {
  platform: SetupPlatform;
  selected: boolean;
  onToggle: (selected: boolean) => void;
}

/**
 * One platform offered at setup, as a card that is itself the checkbox:
 * selecting it lights the card's edge and puts a check in its corner. A
 * required platform is always selected and cannot be toggled.
 */
export function SetupPlatformCard({ platform, selected, onToggle }: SetupPlatformCardProps) {
  const permissions = describePermissions(platform.permissions);

  function toggle() {
    if (!platform.required) {
      onToggle(!selected);
    }
  }

  return (
    <Card
      role="checkbox"
      aria-checked={selected}
      aria-disabled={platform.required}
      aria-label={platform.name}
      tabIndex={0}
      className={cn(
        "group flex flex-col h-full overflow-hidden transition-shadow outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        platform.required ? "cursor-default" : "hover-elevate cursor-pointer",
        selected && "border-primary shadow-[0_0_0_1px_hsl(var(--primary)),0_0_20px_2px_hsl(var(--primary)/0.45)]"
      )}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
      data-testid={`card-setup-platform-${platform.marketplaceModuleId}`}
    >
      <div className="relative shrink-0 h-20" style={getCategoryBannerStyle(platform.category)}>
        {platform.images.banner && (
          <ModuleBannerImage banner={platform.images.banner} sizes="(min-width: 640px) 240px, 100vw" />
        )}
        {selected && (
          <span className="absolute top-2 right-2 flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground shadow-md">
            <Check className="h-4 w-4" strokeWidth={3} />
          </span>
        )}
        <Badge
          variant="secondary"
          className="absolute bottom-2 left-2 text-[9px] py-0 px-1.5 bg-background/80 backdrop-blur-sm"
        >
          {platform.required ? "Required" : "Optional"}
        </Badge>
      </div>

      <CardContent className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 text-primary overflow-hidden">
            {platform.images.icon ? (
              <ModuleIconImage icon={platform.images.icon} displaySize={32} />
            ) : (
              getCategoryIcon(platform.category)
            )}
          </div>
          <h3 className="font-semibold text-sm truncate">{platform.name}</h3>
        </div>

        <p className="text-xs text-muted-foreground">{platform.summary}</p>

        {permissions.length > 0 && (
          <div className={cn("text-[11px]", selected ? "text-foreground" : "text-muted-foreground")}>
            <p className="font-medium">{selected ? "You allow it to:" : "If chosen, it can:"}</p>
            <ul className="list-disc pl-4">
              {permissions.map((permission) => (
                <li key={permission.id} className={cn(!permission.known && "text-amber-500")}>
                  {permission.description}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
