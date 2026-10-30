import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FieldProblems } from "@/components/user-page/field-problems";
import type { ProblemIndex } from "@/lib/page-problems";
import { cn } from "@/lib/utils";

/** The editor's form fields share one shape: a label, the control, an optional hint and the problems at `path`. */
interface FieldFrameProps {
  id: string;
  label: string;
  hint?: string;
  path: string;
  problems: ProblemIndex;
  children: ReactNode;
  className?: string;
}

export function FieldFrame({ id, label, hint, path, problems, children, className }: FieldFrameProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldProblems messages={problems.at(path)} />
    </div>
  );
}

interface TextFieldProps extends Omit<FieldFrameProps, "children"> {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  type?: "text" | "url" | "number";
}

export function TextField({
  value,
  onChange,
  placeholder,
  multiline = false,
  type = "text",
  ...frame
}: TextFieldProps) {
  const invalid = frame.problems.at(frame.path).length > 0;
  return (
    <FieldFrame {...frame}>
      {multiline ? (
        <Textarea
          id={frame.id}
          value={value}
          placeholder={placeholder}
          aria-invalid={invalid}
          className="min-h-[120px] font-mono text-xs"
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={frame.id}
          type={type}
          value={value}
          placeholder={placeholder}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FieldFrame>
  );
}

export function SwitchField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
