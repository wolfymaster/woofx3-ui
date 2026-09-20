import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** "channel" -> "Channel", "user_name" -> "User name". */
function humanize(name: string): string {
  const spaced = name.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

interface MacroVariablePromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  macroLabel: string;
  variables: string[];
  onSubmit: (values: Record<string, string>) => void;
}

export function MacroVariablePrompt({ open, onOpenChange, macroLabel, variables, onSubmit }: MacroVariablePromptProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  // Each opening starts clean — a macro run is a one-off, and carrying the last
  // run's values over invites firing a macro with a stale name in it.
  useEffect(() => {
    if (open) {
      setValues({});
    }
  }, [open]);

  const complete = variables.every((name) => (values[name] ?? "").trim().length > 0);

  const handleSubmit = () => {
    if (!complete) {
      return;
    }
    const trimmed: Record<string, string> = {};
    for (const name of variables) {
      trimmed[name] = values[name].trim();
    }
    onSubmit(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{macroLabel}</DialogTitle>
          <DialogDescription>
            {variables.length === 1
              ? "This macro needs a value before it runs."
              : "This macro needs a few values before it runs."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {variables.map((name, index) => (
            <div key={name} className="space-y-2">
              <Label htmlFor={`macro-variable-${name}`}>{humanize(name)}</Label>
              <Input
                id={`macro-variable-${name}`}
                // A prompt opened by a click should be immediately typeable.
                autoFocus={index === 0}
                value={values[name] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [name]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder={`{{${name}}}`}
                data-testid={`input-macro-variable-${name}`}
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!complete} data-testid="button-run-macro">
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
