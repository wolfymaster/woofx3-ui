import { HelpTip } from "@/components/common/help-tip";
import { Label } from "@/components/ui/label";

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
        <HelpTip label={label}>
          {hint && <p>{hint}</p>}
          {examplePayload && (
            <pre className="text-xs text-foreground bg-muted rounded-md p-2 overflow-x-auto whitespace-pre-wrap font-mono">
              {examplePayload}
            </pre>
          )}
        </HelpTip>
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
