import { useMemo, useState } from "react";
import { TestEventForm, type TestEventProps } from "@/components/test-events/test-event-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  initialValues,
  isJsonValueType,
  payloadFromValues,
  type TestEventField,
  testEventFields,
  valuesFromPayload,
} from "@/lib/test-event-fields";
import { parseEventData } from "@/lib/test-event-json";

/**
 * The test form for a trigger that declares what it emits: one labelled control
 * per path a workflow can read, seeded with values worth firing.
 *
 * The declaration is the form. Nothing here knows what a cheer or a raid is, so
 * a module that describes its event well gets a good test form without the UI
 * learning about it — and the JSON view stays one click away for the payload a
 * form cannot express.
 */
export function ShapeTestEventForm({ preset }: TestEventProps) {
  const fields = useMemo(() => testEventFields(preset), [preset]);
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(fields));
  const [jsonText, setJsonText] = useState<string | null>(null);

  const setValue = (path: string, value: unknown) => {
    setValues((current) => ({ ...current, [path]: value }));
  };

  const fieldPayload = useMemo(() => {
    // A JSON field the user has half-typed reads as undefined, which disables
    // firing rather than publishing an event missing one of its values.
    if (fields.some((field) => values[field.path] === undefined)) {
      return null;
    }
    return payloadFromValues(fields, values);
  }, [fields, values]);

  const parsedJson = useMemo(() => (jsonText === null ? null : parseEventData(jsonText)), [jsonText]);

  const showJson = () => {
    setJsonText(JSON.stringify(fieldPayload ?? payloadFromValues(fields, values), null, 2));
  };

  const showFields = () => {
    if (parsedJson?.ok) {
      setValues((current) => ({ ...current, ...valuesFromPayload(fields, parsedJson.payload) }));
    }
    setJsonText(null);
  };

  const payload = jsonText === null ? fieldPayload : parsedJson?.ok ? parsedJson.payload : null;

  return (
    <TestEventForm preset={preset} payload={payload}>
      {jsonText === null ? (
        fields.map((field) => (
          <TestEventFieldControl key={field.path} field={field} value={values[field.path]} onChange={setValue} />
        ))
      ) : (
        <div className="space-y-2">
          <Label htmlFor="test-event-payload">Event data</Label>
          <Textarea
            id="test-event-payload"
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={12}
            spellCheck={false}
            className="font-mono text-xs"
            data-testid="textarea-test-event-payload"
          />
          {parsedJson && !parsedJson.ok && <p className="text-xs text-destructive">{parsedJson.error}</p>}
        </div>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto self-start px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={jsonText === null ? showJson : showFields}
        data-testid="button-toggle-test-event-json"
      >
        {jsonText === null ? "Edit as JSON" : "Back to fields"}
      </Button>
    </TestEventForm>
  );
}

interface FieldControlProps {
  field: TestEventField;
  value: unknown;
  onChange: (path: string, value: unknown) => void;
}

/** One field: the control its declared type calls for, under the path a workflow reads it by. */
function TestEventFieldControl({ field, value, onChange }: FieldControlProps) {
  const id = `test-event-${field.path}`;

  if (field.type === "boolean") {
    return (
      <div className="flex items-start justify-between gap-4">
        <FieldLabel field={field} htmlFor={id} />
        <Switch
          id={id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(field.path, checked)}
          data-testid={`switch-test-event-${field.path}`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <FieldLabel field={field} htmlFor={id} />
      {field.options ? (
        <Select value={String(value ?? "")} onValueChange={(next) => onChange(field.path, next)}>
          <SelectTrigger id={id} data-testid={`select-test-event-${field.path}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : isJsonValueType(field.type) ? (
        <JsonValueInput id={id} field={field} onChange={onChange} />
      ) : field.type === "number" ? (
        <Input
          id={id}
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(field.path, e.target.value === "" ? 0 : Number(e.target.value))}
          data-testid={`input-test-event-${field.path}`}
        />
      ) : (
        <Input
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(field.path, e.target.value)}
          data-testid={`input-test-event-${field.path}`}
        />
      )}
    </div>
  );
}

function FieldLabel({ field, htmlFor }: { field: TestEventField; htmlFor: string }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <Label htmlFor={htmlFor}>{field.label}</Label>
      <p className="text-xs text-muted-foreground">
        {field.description}
        <span className={field.description ? "ml-1.5 font-mono text-muted-foreground/70" : "font-mono"}>
          {field.path}
        </span>
      </p>
    </div>
  );
}

/**
 * A value with no single control — an object, an array, or one the trigger
 * declares nothing about. Its own text is held here so half-typed JSON stays on
 * screen; the value it reports is `undefined` until the text parses.
 */
function JsonValueInput({
  id,
  field,
  onChange,
}: {
  id: string;
  field: TestEventField;
  onChange: FieldControlProps["onChange"];
}) {
  const [text, setText] = useState(() => JSON.stringify(field.initial ?? null, null, 2));
  const [error, setError] = useState<string | null>(null);

  const handleChange = (next: string) => {
    setText(next);
    try {
      onChange(field.path, JSON.parse(next) as unknown);
      setError(null);
    } catch (err) {
      onChange(field.path, undefined);
      setError(err instanceof Error ? err.message : "Not valid JSON.");
    }
  };

  return (
    <>
      <Textarea
        id={id}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={4}
        spellCheck={false}
        className="font-mono text-xs"
        data-testid={`textarea-test-event-${field.path}`}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}
