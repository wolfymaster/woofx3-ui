import { getCategoryBannerStyle, getCategoryIcon } from "@/components/modules/module-category";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface ModuleStoreCardData {
  id: string;
  name: string;
  author: string;
  description: string;
  version: string;
  category: string;
  iconUrl?: string;
  isInstalled: boolean;
  updateAvailable: boolean;
}

interface ModuleStoreCardProps {
  module: ModuleStoreCardData;
  size?: "default" | "featured";
  onClick: () => void;
}

export function ModuleStoreCard({ module, size = "default", onClick }: ModuleStoreCardProps) {
  const isFeatured = size === "featured";

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`View module ${module.name}`}
      className={cn(
        "group hover-elevate cursor-pointer transition-all flex flex-col h-full overflow-hidden",
        isFeatured ? "shrink-0 w-64" : "w-full"
      )}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div
        className={cn("relative shrink-0", isFeatured ? "h-28" : "h-24")}
        style={getCategoryBannerStyle(module.category)}
      >
        {module.isInstalled && (
          <Badge
            variant="secondary"
            className="absolute top-2 right-2 text-[9px] py-0 px-1.5 bg-background/80 backdrop-blur-sm"
          >
            Installed
          </Badge>
        )}
        <span className="absolute bottom-2 left-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-background/70 backdrop-blur-sm">
          {module.category}
        </span>
      </div>

      <CardContent className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 text-primary overflow-hidden">
            {module.iconUrl ? (
              <img src={module.iconUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              getCategoryIcon(module.category)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className={cn("font-semibold truncate", isFeatured ? "text-base" : "text-sm")}>{module.name}</h3>
            <p className="text-[11px] text-muted-foreground truncate">{module.author || "Unknown"}</p>
          </div>
        </div>

        <p className={cn("text-muted-foreground flex-1", isFeatured ? "text-sm line-clamp-3" : "text-xs line-clamp-2")}>
          {module.description}
        </p>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>v{module.version}</span>
          {module.updateAvailable ? (
            <span className="font-medium text-amber-600 dark:text-amber-400">Update available</span>
          ) : module.isInstalled ? (
            <span className="font-medium text-muted-foreground">Installed</span>
          ) : (
            <span className="font-medium text-primary">Install</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
