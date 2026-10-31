import {
  type BindableResourceKind,
  COUNTER_WIDGET,
  type FormField,
  type FormFieldType,
  type PageWidget,
  type PageWidgetConfig,
  type ResourceBinding,
  TIMER_WIDGET,
  USER_PAGE_LIMITS,
} from "@shared/user-pages";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldProblems } from "@/components/user-page/field-problems";
import { FieldFrame, SwitchField, TextField } from "@/components/user-page/fields";
import { ResourcePicker } from "@/components/user-page/resource-picker";
import { toast } from "@/hooks/use-toast";
import { fieldPath, itemPath, type ProblemIndex } from "@/lib/page-problems";
import { optionalText } from "@/lib/user-page-editor";
import {
  FORM_FIELD_TYPES,
  formFieldOfType,
  newFormField,
  nudge,
  parseWholeNumber,
  removeAt,
  replaceAt,
} from "@/lib/user-page-widgets";

interface FormProps<Config> {
  /** Prefix for the controls' DOM ids, unique to the widget. */
  idPrefix: string;
  config: Config;
  onChange: (config: Config) => void;
  /** The problem path of `config`: `sections[i].widgets[j].config`. */
  path: string;
  problems: ProblemIndex;
  newId: () => string;
}

interface WidgetConfigFormProps {
  widget: PageWidget;
  onChange: (widget: PageWidget) => void;
  path: string;
  problems: ProblemIndex;
  newId: () => string;
}

/**
 * The settings form for a placed widget. One branch per registry type: the
 * switch is exhaustive, so a widget type added to PAGE_WIDGETS does not
 * type-check until it has a form here.
 */
export function WidgetConfigForm({ widget, onChange, path, problems, newId }: WidgetConfigFormProps) {
  const common = { idPrefix: `widget-${widget.id}`, path, problems, newId };
  switch (widget.type) {
    case "text":
      return <TextForm {...common} config={widget.config} onChange={(config) => onChange({ ...widget, config })} />;
    case "counter":
      return <CounterForm {...common} config={widget.config} onChange={(config) => onChange({ ...widget, config })} />;
    case "timer":
      return <TimerForm {...common} config={widget.config} onChange={(config) => onChange({ ...widget, config })} />;
    case "live-status":
      return (
        <LiveStatusForm {...common} config={widget.config} onChange={(config) => onChange({ ...widget, config })} />
      );
    case "links":
      return <LinksForm {...common} config={widget.config} onChange={(config) => onChange({ ...widget, config })} />;
    case "image":
      return <ImageForm {...common} config={widget.config} onChange={(config) => onChange({ ...widget, config })} />;
    case "form":
      return (
        <FormForm
          {...common}
          formId={widget.id}
          config={widget.config}
          onChange={(config) => onChange({ ...widget, config })}
        />
      );
    default: {
      const unhandled: never = widget;
      throw new Error(`No settings form for widget ${JSON.stringify(unhandled)}`);
    }
  }
}

function TextForm({ idPrefix, config, onChange, path, problems }: FormProps<PageWidgetConfig<"text">>) {
  return (
    <TextField
      id={`${idPrefix}-markdown`}
      label="Text"
      hint="Markdown: **bold**, _italic_, [links](https://example.com), lists and headings."
      multiline
      value={config.markdown}
      onChange={(markdown) => onChange({ ...config, markdown })}
      path={fieldPath(path, "markdown")}
      problems={problems}
    />
  );
}

/** The binding problems the server reports sit at the config itself, so the resource field shows them too. */
function ResourceField({
  idPrefix,
  label,
  kind,
  value,
  onChange,
  path,
  problems,
}: {
  idPrefix: string;
  label: string;
  kind: BindableResourceKind;
  value: string;
  onChange: (value: string) => void;
  path: string;
  problems: ProblemIndex;
}) {
  return (
    <FieldFrame id={`${idPrefix}-resource`} label={label} path={fieldPath(path, "resource")} problems={problems}>
      <ResourcePicker id={`${idPrefix}-resource`} kind={kind} value={value} onChange={onChange} />
      <FieldProblems messages={problems.at(path)} />
    </FieldFrame>
  );
}

/** The kind a resource-bound widget binds, read from its registry entry rather than restated here. */
function boundKind(widgetType: string, bindings: readonly ResourceBinding[]): BindableResourceKind {
  const [binding] = bindings;
  if (!binding) {
    throw new Error(`The ${widgetType} widget binds no resource`);
  }
  return binding.kind;
}

const COUNTER_KIND_BOUND = boundKind(COUNTER_WIDGET.type, COUNTER_WIDGET.bindings(COUNTER_WIDGET.defaultConfig()));
const TIMER_KIND_BOUND = boundKind(TIMER_WIDGET.type, TIMER_WIDGET.bindings(TIMER_WIDGET.defaultConfig()));

function CounterForm({ idPrefix, config, onChange, path, problems }: FormProps<PageWidgetConfig<"counter">>) {
  return (
    <div className="space-y-4">
      <ResourceField
        idPrefix={idPrefix}
        label="Counter"
        kind={COUNTER_KIND_BOUND}
        value={config.resource}
        onChange={(resource) => onChange({ ...config, resource })}
        path={path}
        problems={problems}
      />
      <LabelField
        idPrefix={idPrefix}
        value={config.label}
        onChange={(label) => onChange(withLabel(config, label))}
        {...{ path, problems }}
      />
      <SwitchField
        id={`${idPrefix}-goals`}
        label="Show its goals"
        checked={config.showGoals}
        onChange={(showGoals) => onChange({ ...config, showGoals })}
      />
    </div>
  );
}

function TimerForm({ idPrefix, config, onChange, path, problems }: FormProps<PageWidgetConfig<"timer">>) {
  return (
    <div className="space-y-4">
      <ResourceField
        idPrefix={idPrefix}
        label="Timer"
        kind={TIMER_KIND_BOUND}
        value={config.resource}
        onChange={(resource) => onChange({ ...config, resource })}
        path={path}
        problems={problems}
      />
      <LabelField
        idPrefix={idPrefix}
        value={config.label}
        onChange={(label) => onChange(withLabel(config, label))}
        {...{ path, problems }}
      />
    </div>
  );
}

/** `config` with its optional label set, or removed when blank. */
function withLabel<Config extends { label?: string }>(config: Config, label: string): Config {
  const { label: _previous, ...rest } = config;
  const text = optionalText(label);
  return (text === undefined ? rest : { ...rest, label: text }) as Config;
}

function LabelField({
  idPrefix,
  value,
  onChange,
  path,
  problems,
}: {
  idPrefix: string;
  value: string | undefined;
  onChange: (value: string) => void;
  path: string;
  problems: ProblemIndex;
}) {
  return (
    <TextField
      id={`${idPrefix}-label`}
      label="Label"
      hint="Shown above the value. Leave empty to use its own name."
      value={value ?? ""}
      onChange={onChange}
      path={fieldPath(path, "label")}
      problems={problems}
    />
  );
}

function LiveStatusForm({ idPrefix, config, onChange }: FormProps<PageWidgetConfig<"live-status">>) {
  return (
    <div className="space-y-3">
      <SwitchField
        id={`${idPrefix}-title`}
        label="Show the stream title"
        checked={config.showTitle}
        onChange={(showTitle) => onChange({ ...config, showTitle })}
      />
      <SwitchField
        id={`${idPrefix}-game`}
        label="Show the category"
        checked={config.showGame}
        onChange={(showGame) => onChange({ ...config, showGame })}
      />
      <SwitchField
        id={`${idPrefix}-viewers`}
        label="Show the viewer count"
        checked={config.showViewerCount}
        onChange={(showViewerCount) => onChange({ ...config, showViewerCount })}
      />
    </div>
  );
}

/** A row of an editable list: its fields, then move and remove buttons. */
function ListRow({
  label,
  index,
  count,
  onMove,
  onRemove,
  children,
}: {
  label: string;
  index: number;
  count: number;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-2 rounded-md border bg-muted/30 p-3">
      <div className="min-w-0 flex-1 space-y-3">{children}</div>
      <div className="flex shrink-0 flex-col gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          aria-label={`Move ${label} up`}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          aria-label={`Move ${label} down`}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function LinksForm({ idPrefix, config, onChange, path, problems }: FormProps<PageWidgetConfig<"links">>) {
  const linksPath = fieldPath(path, "links");
  const setLinks = (links: PageWidgetConfig<"links">["links"]) => onChange({ ...config, links });
  return (
    <div className="space-y-3">
      {config.links.map((link, index) => {
        const at = itemPath(linksPath, index);
        return (
          <ListRow
            // Links have no id of their own; a row is its position, and moving one re-renders both rows it swaps.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above.
            key={index}
            label={link.label || `link ${index + 1}`}
            index={index}
            count={config.links.length}
            onMove={(by) => setLinks(nudge(config.links, index, by))}
            onRemove={() => setLinks(removeAt(config.links, index))}
          >
            <TextField
              id={`${idPrefix}-link-${index}-label`}
              label="Label"
              value={link.label}
              onChange={(label) => setLinks(replaceAt(config.links, index, { ...link, label }))}
              path={fieldPath(at, "label")}
              problems={problems}
            />
            <TextField
              id={`${idPrefix}-link-${index}-url`}
              label="Address"
              type="url"
              placeholder="https://"
              value={link.url}
              onChange={(url) => setLinks(replaceAt(config.links, index, { ...link, url }))}
              path={fieldPath(at, "url")}
              problems={problems}
            />
          </ListRow>
        );
      })}
      <FieldProblems messages={problems.at(linksPath)} />
      <Button
        variant="outline"
        size="sm"
        disabled={config.links.length >= USER_PAGE_LIMITS.links}
        onClick={() => setLinks([...config.links, { label: "", url: "" }])}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add link
      </Button>
    </div>
  );
}

function ImageForm({ idPrefix, config, onChange, path, problems }: FormProps<PageWidgetConfig<"image">>) {
  const { linkUrl: _linkUrl, ...withoutLink } = config;
  return (
    <div className="space-y-4">
      <TextField
        id={`${idPrefix}-url`}
        label="Image address"
        type="url"
        placeholder="https://"
        hint="An https link to the picture."
        value={config.image.url}
        onChange={(url) => onChange({ ...config, image: { kind: "url", url } })}
        path={fieldPath(fieldPath(path, "image"), "url")}
        problems={problems}
      />
      <TextField
        id={`${idPrefix}-alt`}
        label="Description"
        hint="Read aloud to visitors who cannot see the picture."
        value={config.alt}
        onChange={(alt) => onChange({ ...config, alt })}
        path={fieldPath(path, "alt")}
        problems={problems}
      />
      <TextField
        id={`${idPrefix}-link`}
        label="Opens when clicked"
        type="url"
        placeholder="https:// (optional)"
        value={config.linkUrl ?? ""}
        onChange={(linkUrl) => {
          const text = optionalText(linkUrl);
          onChange(text === undefined ? withoutLink : { ...config, linkUrl: text });
        }}
        path={fieldPath(path, "linkUrl")}
        problems={problems}
      />
    </div>
  );
}

/** The id workflows use to react to this form and no other. */
function FormIdRow({ formId }: { formId: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formId);
      toast({ title: "Form ID copied" });
    } catch {
      toast({
        title: "Couldn't copy the form ID",
        description: "Select it and copy it by hand.",
        variant: "destructive",
      });
    }
  };
  return (
    <div className="space-y-1.5" data-testid="form-id">
      <p className="text-xs font-medium">Form ID</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{formId}</code>
        <Button type="button" variant="outline" size="sm" onClick={copy} data-testid="button-copy-form-id">
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copy
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Use this in a workflow to react only to answers from this form.</p>
    </div>
  );
}

function FormForm({
  idPrefix,
  formId,
  config,
  onChange,
  path,
  problems,
  newId,
}: FormProps<PageWidgetConfig<"form">> & { formId: string }) {
  const fieldsPath = fieldPath(path, "fields");
  const setFields = (fields: FormField[]) => onChange({ ...config, fields });
  const { title: _title, ...withoutTitle } = config;
  return (
    <div className="space-y-4">
      <FormIdRow formId={formId} />
      <TextField
        id={`${idPrefix}-title`}
        label="Title"
        placeholder="Optional"
        value={config.title ?? ""}
        onChange={(title) => {
          const text = optionalText(title);
          onChange(text === undefined ? withoutTitle : { ...config, title: text });
        }}
        path={fieldPath(path, "title")}
        problems={problems}
      />
      <TextField
        id={`${idPrefix}-submit`}
        label="Button text"
        value={config.submitLabel}
        onChange={(submitLabel) => onChange({ ...config, submitLabel })}
        path={fieldPath(path, "submitLabel")}
        problems={problems}
      />
      <div className="space-y-3">
        <p className="text-xs font-medium">Questions</p>
        {config.fields.length === 0 && (
          <p className="text-xs text-muted-foreground">Add the first question visitors will answer.</p>
        )}
        {config.fields.map((field, index) => (
          <ListRow
            key={field.id}
            label={field.label || `question ${index + 1}`}
            index={index}
            count={config.fields.length}
            onMove={(by) => setFields(nudge(config.fields, index, by))}
            onRemove={() => setFields(removeAt(config.fields, index))}
          >
            <FormFieldEditor
              idPrefix={`${idPrefix}-field-${field.id}`}
              field={field}
              onChange={(next) => setFields(replaceAt(config.fields, index, next))}
              path={itemPath(fieldsPath, index)}
              problems={problems}
            />
          </ListRow>
        ))}
        <FieldProblems messages={problems.at(fieldsPath)} />
        <Button
          variant="outline"
          size="sm"
          disabled={config.fields.length >= USER_PAGE_LIMITS.formFields}
          onClick={() => setFields([...config.fields, newFormField(newId())])}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add question
        </Button>
      </div>
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
