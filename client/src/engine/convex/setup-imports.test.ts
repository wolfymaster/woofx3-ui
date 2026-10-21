import { describe, expect, test } from "bun:test";
import { toSetupImportReport } from "./setup-imports";

// An import's report crosses as the gateway's own record, field by field.

type Report = Parameters<typeof toSetupImportReport>[0];

const item = {
  id: "item-1",
  kind: "command",
  name: "!lurk",
  origin: "Commands > lurk",
  readiness: "partial",
  notes: [{ message: "Its cooldown is per user here", detail: "Firebot: global", blocking: false }],
  steps: ["Send a chat message"],
  outcome: null,
  message: null,
} as unknown as Report["items"][number];

const report = {
  id: "import-1",
  source: "firebot",
  label: "firebot-setup.json",
  status: "review",
  createdAt: 10,
  waitingFor: null,
  stalled: false,
  leftovers: [{ origin: "Effects > OBS", name: "Scene switch", message: "No OBS module installed" }],
  items: [item],
} as unknown as Report;

describe("toSetupImportReport", () => {
  const cases: Array<{ name: string; input: Report; expected: unknown }> = [
    {
      name: "a report in review keeps its items, notes and leftovers",
      input: report,
      expected: {
        id: "import-1",
        source: "firebot",
        label: "firebot-setup.json",
        status: "review",
        createdAt: 10,
        waitingFor: null,
        stalled: false,
        leftovers: [
          { origin: "Effects > OBS", name: "Scene switch", message: "No OBS module installed", detail: undefined },
        ],
        items: [
          {
            id: "item-1",
            kind: "command",
            name: "!lurk",
            origin: "Commands > lurk",
            readiness: "partial",
            notes: [{ message: "Its cooldown is per user here", detail: "Firebot: global", blocking: false }],
            steps: ["Send a chat message"],
            outcome: null,
            message: null,
          },
        ],
      },
    },
    {
      name: "a waiting import keeps why it waits, and each item its outcome",
      input: {
        ...report,
        status: "queued",
        waitingFor: "the OBS module",
        stalled: true,
        leftovers: [],
        items: [{ ...item, notes: [], outcome: "needs_module", message: "Install OBS first" }],
      } as Report,
      expected: {
        id: "import-1",
        source: "firebot",
        label: "firebot-setup.json",
        status: "queued",
        createdAt: 10,
        waitingFor: "the OBS module",
        stalled: true,
        leftovers: [],
        items: [
          {
            id: "item-1",
            kind: "command",
            name: "!lurk",
            origin: "Commands > lurk",
            readiness: "partial",
            notes: [],
            steps: ["Send a chat message"],
            outcome: "needs_module",
            message: "Install OBS first",
          },
        ],
      },
    },
  ];

  for (const { name, input, expected } of cases) {
    test(name, () => {
      expect(toSetupImportReport(input)).toEqual(expected);
    });
  }
});
