import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "@woofx3/api";
import { definitionToReactFlow } from "./workflow-projection";

const baseDef: WorkflowDefinition = {
  id: "wf",
  name: "Test",
  trigger: { type: "event", eventType: "cheer.user.twitch" },
  tasks: [],
};

describe("definitionToReactFlow", () => {
  test("trigger-only produces one node, no edges", () => {
    const { nodes, edges } = definitionToReactFlow(baseDef);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe("__trigger");
    expect(nodes[0].type).toBe("trigger");
    expect(edges).toHaveLength(0);
  });

  test("single action task wires trigger → action edge", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [{ id: "a1", type: "action", action: "print", parameters: {} }],
    };
    const { nodes, edges } = definitionToReactFlow(def);
    expect(nodes.map((n) => n.id).sort()).toEqual(["__trigger", "a1"]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "__trigger", target: "a1" });
  });

  test("dependsOn creates edge from parent to child, no implicit trigger edge", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [
        { id: "a1", type: "action", parameters: {} },
        { id: "a2", type: "action", dependsOn: ["a1"], parameters: {} },
      ],
    };
    const { edges } = definitionToReactFlow(def);
    expect(edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual(["__trigger->a1", "a1->a2"]);
  });

  test("condition onTrue/onFalse produce branch-tagged edges", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [
        {
          id: "c1",
          type: "condition",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: canonical engine selector syntax
          conditions: [{ field: "${trigger.data.amount}", operator: "gte", value: 100 }],
          onTrue: ["a1"],
          onFalse: ["a2"],
        },
        { id: "a1", type: "action", dependsOn: ["c1"], parameters: {} },
        { id: "a2", type: "action", dependsOn: ["c1"], parameters: {} },
      ],
    };
    const { edges } = definitionToReactFlow(def);
    const trueEdge = edges.find((e) => e.source === "c1" && e.target === "a1");
    const falseEdge = edges.find((e) => e.source === "c1" && e.target === "a2");
    expect(trueEdge?.data?.branch).toBe("true");
    expect(falseEdge?.data?.branch).toBe("false");
  });

  test("positions are deterministic (same def → same positions)", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [{ id: "a1", type: "action", parameters: {} }],
    };
    const a = definitionToReactFlow(def);
    const b = definitionToReactFlow(def);
    expect(a.nodes.map((n) => n.position)).toEqual(b.nodes.map((n) => n.position));
  });

  test("task with no dependsOn and referenced by onTrue gets no trigger edge", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [
        {
          id: "c1",
          type: "condition",
          conditions: [{ field: "x", operator: "eq", value: 1 }],
          onTrue: ["a1"],
        },
        { id: "a1", type: "action", parameters: {} },
      ],
    };
    const { edges } = definitionToReactFlow(def);
    expect(edges.find((e) => e.source === "__trigger" && e.target === "a1")).toBeUndefined();
    expect(edges.find((e) => e.source === "c1" && e.target === "a1")).toBeDefined();
  });

  test("vertical layout produces different positions than horizontal", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [
        { id: "a1", type: "action", parameters: {} },
        { id: "a2", type: "action", dependsOn: ["a1"], parameters: {} },
      ],
    };
    const horizontal = definitionToReactFlow(def, "horizontal");
    const vertical = definitionToReactFlow(def, "vertical");

    // In horizontal layout, nodes should be spread out on x-axis
    expect(horizontal.nodes[1].position.x).toBeGreaterThan(horizontal.nodes[0].position.x);

    // In vertical layout, nodes should be spread out on y-axis
    expect(vertical.nodes[1].position.y).toBeGreaterThan(vertical.nodes[0].position.y);
  });

  test("vertical layout maintains same nodes and edges as horizontal", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [
        { id: "a1", type: "action", parameters: {} },
        { id: "a2", type: "action", dependsOn: ["a1"], parameters: {} },
      ],
    };
    const horizontal = definitionToReactFlow(def, "horizontal");
    const vertical = definitionToReactFlow(def, "vertical");

    expect(horizontal.nodes.map((n) => n.id)).toEqual(vertical.nodes.map((n) => n.id));
    expect(horizontal.edges.map((e) => `${e.source}->${e.target}`)).toEqual(
      vertical.edges.map((e) => `${e.source}->${e.target}`)
    );
  });
});
