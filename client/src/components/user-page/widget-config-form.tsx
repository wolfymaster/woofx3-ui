import {
  type BindableResourceKind,
  COUNTER_WIDGET,
  FORM_WIDGET,
  type PageWidget,
  type PageWidgetConfig,
  type ResourceBinding,
  TIMER_WIDGET,
  USER_PAGE_LIMITS,
} from "@shared/user-pages";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldProblems } from "@/components/user-page/field-problems";
import { FieldFrame, SwitchField, TextField } from "@/components/user-page/fields";
import { FormWidgetActions } from "@/components/user-page/form-widget-actions";
import { ListRow } from "@/components/user-page/list-row";
import { ResourcePicker } from "@/components/user-page/resource-picker";
import { fieldPath, itemPath, type ProblemIndex } from "@/lib/page-problems";
import { optionalText } from "@/lib/user-page-editor";
import { nudge, removeAt, replaceAt } from "@/lib/user-page-widgets";

interface FormProps<Config> {
  /** Prefix for the controls' DOM ids, unique to the widget. */
  idPrefix: string;
  config: Config;
  onChange: (config: Config) => void;
  /** The problem path of `config`: `sections[i].widgets[j].config`. */
  path: string;
  problems: ProblemIndex;
}

interface WidgetConfigFormProps {
  widget: PageWidget;
  onChange: (widget: PageWidget) => void;
  path: string;
  problems: ProblemIndex;
}

/**
 * The settings form for a placed widget. One branch per registry type: the
 * switch is exhaustive, so a widget type added to PAGE_WIDGETS does not
 * type-check until it has a form here.
 */
export function WidgetConfigForm({ widget, onChange, path, problems }: WidgetConfigFormProps) {
  const common = { idPrefix: `widget-${widget.id}`, path, problems };
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
      return <FormForm {...common} config={widget.config} onChange={(config) => onChange({ ...widget, config })} />;
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
const FORM_KIND_BOUND = boundKind(FORM_WIDGET.type, FORM_WIDGET.bindings(FORM_WIDGET.defaultConfig()));

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

function FormForm({ idPrefix, config, onChange, path, problems }: FormProps<PageWidgetConfig<"form">>) {
  return (
    <div className="space-y-4">
      <ResourceField
        idPrefix={idPrefix}
        label="Form"
        kind={FORM_KIND_BOUND}
        value={config.resource}
        onChange={(resource) => onChange({ ...config, resource })}
        path={path}
        problems={problems}
      />
      <FormWidgetActions value={config.resource} onChange={(resource) => onChange({ ...config, resource })} />
    </div>
  );
}
