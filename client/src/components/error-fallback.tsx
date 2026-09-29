import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

interface ErrorFallbackProps {
  onReset?: () => void;
  message?: string;
  resetLabel?: string;
}

export function ErrorFallback({
  onReset,
  message = "Something went wrong",
  resetLabel = "Try Again",
}: ErrorFallbackProps) {
  return (
    <Card className="m-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          Error
        </CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent>
        {onReset && (
          <Button onClick={onReset} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            {resetLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
