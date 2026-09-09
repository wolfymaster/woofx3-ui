import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface ConfigFieldLabelProps {
  htmlFor?: string;
  label: string;
  required?: boolean;
  hint?: string;
  examplePayload?: string;
}

export function ConfigFieldLabel({ htmlFor, label, required, hint, examplePayload }: ConfigFieldLabelProps) {
  const showInfo = !!(hint || examplePayload);

  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {showInfo && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              aria-label={`More info about ${label}`}
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="max-w-sm text-sm" align="start">
            {hint && <p className="text-muted-foreground mb-2">{hint}</p>}
            {examplePayload && (
              <pre className="text-xs bg-muted rounded-md p-2 overflow-x-auto whitespace-pre-wrap font-mono">
                {examplePayload}
              </pre>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export function ConfigFieldDescription({ description }: { description?: string }) {
  if (!description) {
    return null;
  }
  return <p className="text-xs text-muted-foreground">{description}</p>;
}
