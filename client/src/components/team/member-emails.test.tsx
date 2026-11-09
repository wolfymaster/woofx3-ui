import { describe, expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { hasMemberEmails, MASKED_EMAIL, MemberEmail } from "./member-emails";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(email: string | null | undefined, shown: boolean): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<MemberEmail email={email} shown={shown} />);
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
      const renderer = await render(email, shown);
      const json = renderer.toJSON();
      expect(json === null || Array.isArray(json) ? null : json.children?.join("")).toBe(expected);
    });
  }
});

describe("hasMemberEmails", () => {
  test("is true only when the list carries the email field", () => {
    expect(hasMemberEmails([{ email: null }, {}])).toBe(true);
    expect(hasMemberEmails([{}, {}])).toBe(false);
    expect(hasMemberEmails([])).toBe(false);
  });
});
