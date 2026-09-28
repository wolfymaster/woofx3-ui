import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: EmptyStateAction;
  /** A lesser alternative to `action`, shown beside it. */
  secondaryAction?: EmptyStateAction;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, secondaryAction, className }: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center py-16 px-4 text-center", className)}
      data-testid="container-empty-state"
    >
      <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-6">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2" data-testid="text-empty-title">
        {title}
      </h3>
      <p className="text-muted-foreground max-w-sm mb-6" data-testid="text-empty-description">
        {description}
      </p>
      {(action || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {action && (
            <Button onClick={action.onClick} data-testid="button-empty-action">
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="outline" onClick={secondaryAction.onClick} data-testid="button-empty-secondary-action">
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
