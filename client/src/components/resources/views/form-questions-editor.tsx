import { type FormField, type FormFieldType, USER_PAGE_LIMITS } from "@shared/user-pages";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldProblems } from "@/components/user-page/field-problems";
import { FieldFrame, SwitchField, TextField } from "@/components/user-page/fields";
import { ListRow } from "@/components/user-page/list-row";
import { fieldPath, itemPath, type ProblemIndex } from "@/lib/page-problems";
import {
  FORM_FIELD_TYPES,
  formFieldOfType,
  newFormField,
  nudge,
  parseWholeNumber,
  removeAt,
  replaceAt,
} from "@/lib/user-page-widgets";

/** A form's questions as an editable list. Problems are looked up under `path`, the list's own. */
export function FormQuestionsEditor({
  idPrefix,
  questions,
  onChange,
  path,
  problems,
}: {
  idPrefix: string;
  questions: FormField[];
  onChange: (questions: FormField[]) => void;
  path: string;
  problems: ProblemIndex;
}) {
  return (
    <div className="space-y-3">
      {questions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Add the first question. Visitors can't use this form until it has one.
        </p>
      )}
      {questions.map((field, index) => (
        <ListRow
          key={field.id}
          label={field.label || `question ${index + 1}`}
          index={index}
          count={questions.length}
          onMove={(by) => onChange(nudge(questions, index, by))}
          onRemove={() => onChange(removeAt(questions, index))}
        >
          <FormFieldEditor
            idPrefix={`${idPrefix}-field-${field.id}`}
            field={field}
            onChange={(next) => onChange(replaceAt(questions, index, next))}
            path={itemPath(path, index)}
            problems={problems}
          />
        </ListRow>
      ))}
      <FieldProblems messages={problems.at(path)} />
      <Button
        variant="outline"
        size="sm"
        disabled={questions.length >= USER_PAGE_LIMITS.formFields}
        onClick={() => onChange([...questions, newFormField(crypto.randomUUID())])}
        data-testid="button-add-question"
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add question
      </Button>
    </div>
  );
}

function isFormFieldType(value: string): value is FormFieldType {
  return FORM_FIELD_TYPES.some((entry) => entry.type === value);
}

function FormFieldEditor({
  idPrefix,
  field,
  onChange,
  path,
  problems,
}: {
  idPrefix: string;
  field: FormField;
  onChange: (field: FormField) => void;
  path: string;
  problems: ProblemIndex;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <TextField
          id={`${idPrefix}-label`}
          label="Question"
          value={field.label}
          onChange={(label) => onChange({ ...field, label })}
          path={fieldPath(path, "label")}
          problems={problems}
        />
        <FieldFrame id={`${idPrefix}-type`} label="Answer" path={fieldPath(path, "type")} problems={problems}>
          <Select
            value={field.type}
            onValueChange={(value) => {
              if (isFormFieldType(value)) {
                onChange(formFieldOfType(field, value));
              }
            }}
          >
            <SelectTrigger id={`${idPrefix}-type`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORM_FIELD_TYPES.map((entry) => (
                <SelectItem key={entry.type} value={entry.type}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldFrame>
      </div>
      <FormFieldTypeSettings idPrefix={idPrefix} field={field} onChange={onChange} path={path} problems={problems} />
      <SwitchField
        id={`${idPrefix}-required`}
        label="Required"
        checked={field.required}
        onChange={(required) => onChange({ ...field, required })}
      />
      <FieldProblems messages={problems.at(fieldPath(path, "id"))} />
    </>
  );
}

function FormFieldTypeSettings({
  idPrefix,
  field,
  onChange,
  path,
  problems,
}: {
  idPrefix: string;
  field: FormField;
  onChange: (field: FormField) => void;
  path: string;
  problems: ProblemIndex;
}) {
  switch (field.type) {
    case "text":
    case "textarea":
      return (
        <TextField
          id={`${idPrefix}-max`}
          label="Longest answer, in characters"
          type="number"
          value={String(field.maxLength)}
          onChange={(value) => onChange({ ...field, maxLength: parseWholeNumber(value) })}
          path={fieldPath(path, "maxLength")}
          problems={problems}
        />
      );
    case "select": {
      const optionsPath = fieldPath(path, "options");
      const setOptions = (options: typeof field.options) => onChange({ ...field, options });
      return (
        <div className="space-y-2">
          <p className="text-xs font-medium">Options</p>
          {field.options.map((option, index) => {
            const at = itemPath(optionsPath, index);
            return (
              <ListRow
                // Options have no id of their own; see the links list.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above.
                key={index}
                label={option.label || `option ${index + 1}`}
                index={index}
                count={field.options.length}
                onMove={(by) => setOptions(nudge(field.options, index, by))}
                onRemove={() => setOptions(removeAt(field.options, index))}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField
                    id={`${idPrefix}-option-${index}-label`}
                    label="Shown as"
                    value={option.label}
                    onChange={(label) => setOptions(replaceAt(field.options, index, { ...option, label }))}
                    path={fieldPath(at, "label")}
                    problems={problems}
                  />
                  <TextField
                    id={`${idPrefix}-option-${index}-value`}
                    label="Recorded as"
                    value={option.value}
                    onChange={(value) => setOptions(replaceAt(field.options, index, { ...option, value }))}
                    path={fieldPath(at, "value")}
                    problems={problems}
                  />
                </div>
              </ListRow>
            );
          })}
          <FieldProblems messages={problems.at(optionsPath)} />
          <Button
            variant="outline"
            size="sm"
            disabled={field.options.length >= USER_PAGE_LIMITS.formSelectOptions}
            onClick={() => setOptions([...field.options, { label: "", value: "" }])}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add option
          </Button>
        </div>
      );
    }
    case "checkbox":
      return null;
  }
}
