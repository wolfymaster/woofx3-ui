import { describe, expect, test } from "bun:test";
import type { FieldOptionsState } from "@/hooks/use-field-options";
import { internalSelectView } from "./field-options-picker";

const PINNED = [{ value: "origin", label: "Where it came from" }];
const FALLBACK = "Select platform...";

function state(overrides: Partial<FieldOptionsState>): FieldOptionsState {
  return { options: [], loading: false, error: null, empty: false, refresh: () => {}, ...overrides };
}

const LOADING = state({ loading: true });
const FAILED = state({ error: "gateway down", empty: true });
const EMPTY = state({ empty: true });
const LISTED = state({ options: [{ value: "twitch", label: "Twitch" }] });

describe("internalSelectView", () => {
  test("test_internal_select_view_pinned_stays_enabled_per_state", () => {
    for (const [name, s] of [
      ["loading", LOADING],
      ["failed", FAILED],
      ["empty", EMPTY],
      ["listed", LISTED],
    ] as const) {
      const view = internalSelectView(PINNED, s, "origin", FALLBACK);
      expect({ name, disabled: view.disabled }).toEqual({ name, disabled: false });
      expect(view.groups[0]?.options[0]?.value).toBe("origin");
    }
  });

  test("test_internal_select_view_loading_row_only_with_options", () => {
    expect(internalSelectView(PINNED, LOADING, "origin", FALLBACK).loadingRow).toBe(true);
    expect(internalSelectView([], LOADING, "", FALLBACK).loadingRow).toBe(false);
    expect(internalSelectView(PINNED, LISTED, "origin", FALLBACK).loadingRow).toBe(false);
  });

  test("test_internal_select_view_failure_keeps_pinned_with_helper_text", () => {
    const view = internalSelectView(PINNED, FAILED, "origin", FALLBACK);
    expect(view.reason).toBe("Could not load options: gateway down");
    expect(view.groups[0]?.options).toEqual(PINNED);
    expect(view.placeholder).toBe(FALLBACK);
  });

  test("test_internal_select_view_empty_with_pinned_has_no_helper_text", () => {
    expect(internalSelectView(PINNED, EMPTY, "origin", FALLBACK).reason).toBeNull();
  });

  test("test_internal_select_view_fetched_options_follow_pinned_without_duplicates", () => {
    const fetched = state({
      options: [
        { value: "origin", label: "origin (fetched)" },
        { value: "twitch", label: "Twitch" },
      ],
    });
    const view = internalSelectView(PINNED, fetched, "twitch", FALLBACK);
    expect(view.groups[0]?.options).toEqual([...PINNED, { value: "twitch", label: "Twitch" }]);
  });

  test("test_internal_select_view_missing_saved_value_is_unavailable", () => {
    expect(internalSelectView(PINNED, LISTED, "kick", FALLBACK).unavailableValue).toBe("kick");
    expect(internalSelectView(PINNED, FAILED, "kick", FALLBACK).unavailableValue).toBe("kick");
    expect(internalSelectView(PINNED, LOADING, "kick", FALLBACK).unavailableValue).toBeNull();
    expect(internalSelectView(PINNED, LISTED, "twitch", FALLBACK).unavailableValue).toBeNull();
    expect(internalSelectView(PINNED, LISTED, "", FALLBACK).unavailableValue).toBeNull();
  });

  test("test_internal_select_view_without_pinned_is_unchanged", () => {
    expect(internalSelectView([], LOADING, "", FALLBACK)).toMatchObject({
      disabled: true,
      placeholder: "Loading options...",
      reason: null,
    });
    expect(internalSelectView([], EMPTY, "", FALLBACK)).toMatchObject({
      disabled: true,
      placeholder: "No options available",
      reason: "No options available.",
    });
    expect(internalSelectView([], FAILED, "", FALLBACK).reason).toBe("Could not load options: gateway down");
    expect(internalSelectView([], LISTED, "", FALLBACK)).toMatchObject({ disabled: false, placeholder: FALLBACK });
  });

  test("test_internal_select_view_keeps_a_value_listed_under_two_groups", () => {
    const grouped = state({
      options: [
        { value: "shared", label: "Shared", group: "A" },
        { value: "shared", label: "Shared", group: "B" },
      ],
    });
    for (const pinned of [[], PINNED]) {
      const view = internalSelectView(pinned, grouped, "", FALLBACK);
      const headings = view.groups.filter((g) => g.options.some((o) => o.value === "shared")).map((g) => g.heading);
      expect(headings).toEqual(["A", "B"]);
    }
  });
});
