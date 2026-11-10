import { Check, MonitorPlay } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useInstance } from "@/hooks/use-instance";

/** The connected engine's name for the account menu, with a switcher once the user has more than one. */
export function EngineMenuSection() {
  const { instance, instances, setInstance, isLoading } = useInstance();
  const engines = instances.filter((candidate) => candidate !== null);

  // The shell paints before the list arrives; naming "no engine" then would flash for everyone who has one.
  if (isLoading || !instance) {
    return null;
  }

  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-2 font-normal" data-testid="menu-current-engine">
        <MonitorPlay className="h-4 w-4 text-muted-foreground" />
        <span className="truncate">Engine: {instance.name}</span>
      </DropdownMenuLabel>
      {engines.length > 1 && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="menu-switch-engine">Switch engine</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            {engines.map((engine) => (
              <DropdownMenuItem
                key={engine._id}
                onClick={() => setInstance(engine._id)}
                className="flex items-center justify-between"
              >
                <span className="truncate">{engine.name}</span>
                {engine._id === instance._id && <Check className="h-4 w-4 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
    </>
  );
}
