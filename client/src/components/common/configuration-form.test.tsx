import { describe, expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ConfigurationForm, type CustomFieldRenderer, type FieldDescriptor } from "./configuration-form";

// Fields drawn by stub renderers, so the tests see the form's own wiring (which fields
// it draws, what it emits, what it saves) and none of a real control's behaviour.
const STUBS: Record<string, CustomFieldRenderer> = {
  "field:picker": ({ field, onChange }) => (
    <button type="button" data-testid={`pick-${field.id}`} onClick={() => onChange(field.pick)} />
  ),
  "field:plain": ({ field }) => <div data-testid={`plain-${field.id}`} />,
};

const PLATFORM: FieldDescriptor = {
  id: "platform",
  label: "Platform",
  type: "picker",
  defaultValue: "origin",
  pick: "kick",
};
const COLOR: FieldDescriptor = {
  id: "color",
  label: "Colour",
  type: "plain",
  required: true,
  defaultValue: "blue",
  visibleWhen: { field: "platform", oneOf: ["origin", "twitch"] },
};
type Values = Record<string, unknown>;

function render(
  values: Values,
  handlers: { onChange?: (v: Values) => void; onSubmit?: (v: Values) => void; pick?: string } = {}
) {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      <ConfigurationForm
        fields={[{ ...PLATFORM, pick: handlers.pick ?? "kick" }, COLOR]}
        values={values}
        onChange={handlers.onChange ?? (() => {})}
        onSubmit={handlers.onSubmit}
        customRenderers={STUBS}
      />
    );
  });
  if (!renderer) {
    throw new Error("the form did not render");
  }
  return renderer;
}

const shows = (r: ReactTestRenderer, id: string) => r.root.findAllByProps({ "data-testid": id }).length > 0;

describe("ConfigurationForm visibleWhen", () => {
  test("test_configuration_form_draws_field_only_while_its_condition_holds", () => {
    expect(shows(render({ platform: "twitch" }), "plain-color")).toBe(true);
    expect(shows(render({ platform: "kick" }), "plain-color")).toBe(false);
  });

  test("test_configuration_form_variable_controller_keeps_field_visible", () => {
    expect(shows(render({ platform: "${trigger.platform}" }), "plain-color")).toBe(true);
  });

  test("test_configuration_form_change_hiding_a_field_drops_its_value", () => {
    const emitted: Values[] = [];
    const r = render({ platform: "twitch", color: "red" }, { onChange: (v) => emitted.push(v) });
    act(() => r.root.findByProps({ "data-testid": "pick-platform" }).props.onClick());
    expect(emitted).toEqual([{ platform: "kick" }]);
  });

  test("test_configuration_form_change_showing_a_field_restores_its_default", () => {
    const emitted: Values[] = [];
    const r = render({ platform: "kick", color: "stale" }, { onChange: (v) => emitted.push(v), pick: "twitch" });
    act(() => r.root.findByProps({ "data-testid": "pick-platform" }).props.onClick());
    expect(emitted).toEqual([{ platform: "twitch", color: "blue" }]);
  });

  test("test_configuration_form_edit_sheds_a_hidden_value_it_was_opened_with", () => {
    const emitted: Values[] = [];
    const r = render({ platform: "kick", color: "red" }, { onChange: (v) => emitted.push(v) });
    act(() => r.root.findByProps({ "data-testid": "pick-platform" }).props.onClick());
    expect(emitted).toEqual([{ platform: "kick" }]);
  });

  test("test_configuration_form_hidden_required_field_does_not_block_submit", () => {
    const submitted: Values[] = [];
    const r = render({ platform: "kick", color: "red" }, { onSubmit: (v) => submitted.push(v) });
    act(() => r.root.findByProps({ "data-testid": "button-config-submit" }).props.onClick());
    expect(submitted).toEqual([{ platform: "kick" }]);
  });

  test("test_configuration_form_shown_required_field_still_blocks_submit", () => {
    const submitted: Values[] = [];
    const r = render({ platform: "twitch", color: "" }, { onSubmit: (v) => submitted.push(v) });
    act(() => r.root.findByProps({ "data-testid": "button-config-submit" }).props.onClick());
    expect(submitted).toEqual([]);
  });
});
