import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UpdateRestartButton } from "./UpdateRestartButton";
import { useReadyUpdate } from "./use-ready-update";

/** Header icon, beside the settings cog, shown for as long as an update is ready to install. */
export default function UpdateIndicator() {
  const update = useReadyUpdate();
  if (!update) {
    return null;
  }

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-8 w-8"
              aria-label={`Update ${update.version} ready`}
              data-testid="button-update-available"
            >
              <Download className="h-4 w-4" />
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-card" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Update ready</TooltipContent>
      </Tooltip>
      <PopoverContent align="end">
        <p className="text-sm font-medium">
          {update.productName} {update.version} is ready
        </p>
        <UpdateRestartButton />
      </PopoverContent>
    </Popover>
  );
}
