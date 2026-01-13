import { RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}

export function ErrorState({ 
  title = 'Failed to load data', 
  message = 'An error occurred while fetching the data.', 
  onRetry,
  compact = false 
}: ErrorStateProps) {
  if (compact) {
    return (
      <div className="py-8 text-center">
        <XCircle className="h-8 w-8 mx-auto text-destructive mb-3" />
        <p className="text-sm text-muted-foreground mb-3">{message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card className="border-destructive/50">
      <CardContent className="pt-6">
        <div className="flex flex-col items-center text-center py-6">
          <XCircle className="h-12 w-12 text-destructive mb-4" />
          <h3 className="font-semibold mb-2">{title}</h3>
          <p className="text-sm text-muted-foreground mb-4">{message}</p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
