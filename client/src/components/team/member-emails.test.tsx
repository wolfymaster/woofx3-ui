import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { EmailVisibilityToggle, hasMemberEmails, MASKED_EMAIL, MemberEmail } from "./member-emails";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(element: ReactElement): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(element);
  });
  if (renderer === undefined) {
    throw new Error("render: the renderer was not created");
  }
  return renderer;
}

describe("MemberEmail", () => {
  const CASES: Array<[string, string | null | undefined, boolean, string | null]> = [
    ["masks an address while hidden", "mod@example.com", false, MASKED_EMAIL],
    ["masks a missing address the same way", null, false, MASKED_EMAIL],
    ["shows the address once shown", "mod@example.com", true, "mod@example.com"],
    ["shows a dash for a member without an address", null, true, "—"],
    ["renders nothing for a viewer who wasn't sent addresses", undefined, true, null],
  ];
  for (const [name, email, shown, expected] of CASES) {
    test(name, async () => {
      const renderer = await render(<MemberEmail email={email} shown={shown} />);
      expect(renderer.toJSON() === null ? null : textOf(renderer.root)).toBe(expected);
    });
  }

  test("names the mask for screen readers instead of reading out bullets", async () => {
    const renderer = await render(<MemberEmail email="mod@example.com" shown={false} />);
    const mask = renderer.root.findByProps({ role: "img" });
    expect(mask.props["aria-label"]).toBe("Email hidden");
  });
});

function textOf(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}

describe("EmailVisibilityToggle", () => {
  test.each([false, true])("keeps one label and reports shown=%p through aria-pressed", async (shown) => {
    const renderer = await render(<EmailVisibilityToggle shown={shown} onShownChange={() => {}} />);
    const button = renderer.root.findByProps({ "data-testid": "button-toggle-emails" });
    expect(button.props["aria-pressed"]).toBe(shown);
    expect(textOf(button)).toBe("Show emails");
  });
});

describe("hasMemberEmails", () => {
  test("is true only when the list carries the email field", () => {
    expect(hasMemberEmails([{ email: null }, {}])).toBe(true);
    expect(hasMemberEmails([{}, {}])).toBe(false);
    expect(hasMemberEmails([])).toBe(false);
  });
});
