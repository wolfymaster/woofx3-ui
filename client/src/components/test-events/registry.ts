import type { ComponentType } from "react";
import { JsonTestEventForm } from "@/components/test-events/json-test-event-form";
import { ShapeTestEventForm } from "@/components/test-events/shape-test-event-form";
import type { TestEventProps } from "@/components/test-events/test-event-form";
import type { TriggerPreset } from "@/lib/workflow-presets";

/**
 * The form for testing `preset`.
 *
 * A trigger that declares what it emits is asked for with fields built from
 * that declaration; one that declares nothing falls back to raw JSON. There are
 * deliberately no per-event forms: a hand-written one drifts from the event it
 * claims to describe, and only ever covers the handful of events someone
 * remembered to write.
 */
export function testEventFormFor(preset: TriggerPreset): ComponentType<TestEventProps> {
  return (preset.emits?.length ?? 0) > 0 ? ShapeTestEventForm : JsonTestEventForm;
}
