import { describe, expect, test } from "bun:test";
import { IntentOperationIds } from "./operation-id";

function counter(): () => string {
  let made = 0;
  return () => {
    made += 1;
    return `op_${String(made).padStart(8, "0")}`;
  };
}

describe("IntentOperationIds", () => {
  test("a repeated intent gets the same id until it finishes", () => {
    const ids = new IntentOperationIds(counter());
    const first = ids.begin("i1:chat.send:hello");
    expect(ids.begin("i1:chat.send:hello")).toBe(first);
    expect(ids.begin("i1:chat.send:bye")).not.toBe(first);
    ids.finish("i1:chat.send:hello", first);
    expect(ids.begin("i1:chat.send:hello")).not.toBe(first);
  });

  test("finishing with an id the intent no longer holds leaves the newer one open", () => {
    const ids = new IntentOperationIds(counter());
    const first = ids.begin("intent");
    ids.finish("intent", first);
    const second = ids.begin("intent");
    ids.finish("intent", first);
    expect(ids.begin("intent")).toBe(second);
  });

  test("a double click shares one id while the first send is still running", async () => {
    const ids = new IntentOperationIds(counter());
    const seen: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = async (operationId: string) => {
      seen.push(operationId);
      await gate;
      return operationId;
    };
    const both = Promise.all([ids.run("intent", send), ids.run("intent", send)]);
    release();
    await both;
    expect(seen).toEqual(["op_00000001", "op_00000001"]);
    expect(await ids.run("intent", send)).toBe("op_00000002");
  });

  test("a failed send keeps its id, so the retry replays rather than reposts", async () => {
    const ids = new IntentOperationIds(counter());
    await expect(
      ids.run("intent", async () => {
        throw new Error("may already be in chat");
      })
    ).rejects.toThrow("may already be in chat");
    expect(await ids.run("intent", async (operationId) => operationId)).toBe("op_00000001");
  });
});
