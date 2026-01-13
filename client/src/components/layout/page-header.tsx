import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6', className)}>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-page-title">
          {title}
        </h1>
        {description && (
          <p className="text-muted-foreground" data-testid="text-page-description">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-wrap" data-testid="container-page-actions">
          {actions}
        </div>
      )}
    </div>
  );
}
