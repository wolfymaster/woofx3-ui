import { describe, expect, test } from "bun:test";
import type { Doc } from "@convex/_generated/dataModel";
import { readAlertLayout } from "@/lib/alert-layout";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import {
  alertsInCommands,
  alertsInWorkflows,
  commandAlertKey,
  copyAlertLayout,
  triggerAlertKey,
} from "@/lib/existing-alerts";
import type { TriggerPreset } from "@/lib/workflow-presets";

const banner = {
  width: 1920,
  height: 1080,
  widgets: [
    {
      id: "message",
      widgetCanonicalId: "woofx3:widget:text",
      position: { x: 10, y: 20 },
      size: { width: 300, height: 100 },
      settings: { text: "Thanks {user}", style: { color: "#fff" } },
    },
  ],
};

function workflow(definition: unknown): Doc<"workflows"> {
  return {
    engineWorkflowId: "wf-cheer",
    isEnabled: true,
    definition: escapeDollarKeys(definition),
  } as Doc<"workflows">;
}

function alertTask(id: string, layout: unknown, extra: Record<string, unknown> = {}) {
  return { id, type: "action", action: "alert", parameters: { layout, target: "Main" }, ...extra };
}

const cheerPreset = {
  id: "cheer",
  name: "Cheer",
  event: "cheer.channel.twitch",
  sentence: "Someone cheers {amount} bits",
  config: { fields: [{ id: "amount", label: "Amount", type: "number", operator: "gte" }] },
} as unknown as TriggerPreset;

describe("alertsInWorkflows", () => {
  test("lists each alert step with a layout, named by its event and trigger", () => {
    const rows = [
      workflow({
        name: "Cheer triggers",
        trigger: { type: "event", event: "cheer.channel.twitch" },
        tasks: [alertTask("a1", { widgets: [] }), alertTask("a2", banner)],
      }),
    ];

    const alerts = alertsInWorkflows(rows, [cheerPreset]);

    expect(alerts).toEqual([
      {
        key: triggerAlertKey("wf-cheer", "a2"),
        source: "trigger",
        title: "Cheer",
        detail: "Every time · Step 2",
        layout: banner,
      },
    ]);
  });

  test("names a conditional trigger by its sentence", () => {
    const rows = [
      workflow({
        name: "Cheer triggers",
        trigger: { type: "event", event: "cheer.channel.twitch" },
        tasks: [
          {
            id: "rule_1",
            type: "condition",
            // biome-ignore lint/suspicious/noTemplateCurlyInString: canonical engine selector syntax
            conditions: [{ field: "${trigger.data.amount}", operator: "gte", value: 1000 }],
            onTrue: ["act_1_1"],
          },
          alertTask("act_1_1", banner, { dependsOn: ["rule_1"] }),
        ],
      }),
    ];

    const [alert] = alertsInWorkflows(rows, [cheerPreset]);

    expect(alert.detail).toBe("Someone cheers 1,000 or more bits · Step 1");
  });

  test("leaves out a workflow the Alerts screen cannot project", () => {
    const rows = [workflow({ name: "Builder", trigger: { type: "manual" }, tasks: [alertTask("a1", banner)] })];

    expect(alertsInWorkflows(rows, [cheerPreset])).toEqual([]);
  });
});

describe("alertsInCommands", () => {
  test("lists alert steps by command word, keyed by the step's id or position", () => {
    const rows = [
      { engineCommandId: "c-2", command: "raid", actions: [{ action: "alert", parameters: { layout: banner } }] },
      {
        engineCommandId: "c-1",
        command: "hype",
        actions: escapeDollarKeys([
          { id: "say", action: "function", function: "chat.say", parameters: { $ref: "x" } },
          { id: "boom", action: "alert", parameters: { layout: banner } },
        ]),
      },
    ] as unknown as Doc<"chatCommands">[];

    const alerts = alertsInCommands(rows);

    expect(alerts.map((alert) => [alert.key, alert.title, alert.detail])).toEqual([
      [commandAlertKey("c-1", "boom"), "!hype", "Step 2"],
      [commandAlertKey("c-2", "action-1"), "!raid", "Step 1"],
    ]);
  });
});

describe("copyAlertLayout", () => {
  test("gives layers fresh ids in stacking order and shares no settings with the source", () => {
    const source = readAlertLayout(
      { ...banner, widgets: [...banner.widgets, { ...banner.widgets[0], id: "second" }] },
      (id) => id
    );
    source.widgets[0].zIndex = 5;

    const copy = copyAlertLayout(source);

    expect(copy.widgets.map((widget) => [widget.id, widget.zIndex])).toEqual([
      ["w-1", 1],
      ["w-2", 2],
    ]);
    expect(copy.widgets[1].position).toEqual(source.widgets[0].position);
    (copy.widgets[1].settings.style as { color: string }).color = "#000";
    expect((source.widgets[0].settings.style as { color: string }).color).toBe("#fff");
  });
});
