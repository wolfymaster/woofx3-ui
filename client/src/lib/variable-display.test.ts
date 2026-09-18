import { describe, expect, test } from "bun:test";
import { toDisplayText, toStoredText, variableNames } from "./variable-display";
import type { VariableOption } from "./workflow-variables";

function option(value: string): VariableOption {
  return { value, label: value, group: "Trigger" };
}

describe("variableNames", () => {
  test("names a variable by the last segment of its path", () => {
    const names = variableNames([option("${trigger.data.user.firstName}"), option("${increment.next}")]);
    expect(names.nameByToken.get("${trigger.data.user.firstName}")).toBe("firstName");
    expect(names.nameByToken.get("${increment.next}")).toBe("next");
  });

  test("lengthens only the names that would otherwise be shared", () => {
    const names = variableNames([
      option("${increment.next}"),
      option("${increment-2.next}"),
      option("${trigger.data.amount}"),
    ]);
    expect(names.nameByToken.get("${increment.next}")).toBe("increment.next");
    expect(names.nameByToken.get("${increment-2.next}")).toBe("increment-2.next");
    expect(names.nameByToken.get("${trigger.data.amount}")).toBe("amount");
  });

  test("lengthens past a shared middle segment", () => {
    const names = variableNames([option("${a.user.name}"), option("${b.user.name}")]);
    expect(names.nameByToken.get("${a.user.name}")).toBe("a.user.name");
    expect(names.nameByToken.get("${b.user.name}")).toBe("b.user.name");
  });

  test("a name that is a whole path does not collide with a longer one ending in it", () => {
    const names = variableNames([option("${next}"), option("${increment.next}")]);
    expect(names.nameByToken.get("${next}")).toBe("next");
    expect(names.nameByToken.get("${increment.next}")).toBe("increment.next");
  });
});

describe("toDisplayText / toStoredText", () => {
  const names = variableNames([option("${trigger.data.firstName}"), option("${increment.next}")]);

  test("shows known references by their short name", () => {
    expect(toDisplayText("Hi ${trigger.data.firstName}, count ${increment.next}", names)).toBe(
      "Hi {firstName}, count {next}"
    );
  });

  test("stores short names as their full reference", () => {
    expect(toStoredText("Hi {firstName}, count {next}", names)).toBe(
      "Hi ${trigger.data.firstName}, count ${increment.next}"
    );
  });

  test("leaves unknown references and compound expressions as typed", () => {
    const stored = '${gone.value} ${trigger.data.firstName == "x" ? "a" : "b"}';
    expect(toDisplayText(stored, names)).toBe(stored);
  });

  test("leaves braces that name no variable as literal text", () => {
    expect(toStoredText("{unknown} and { firstName }", names)).toBe("{unknown} and { firstName }");
  });

  test("does not rewrite a reference the user typed out with its $", () => {
    expect(toStoredText("${firstName}", names)).toBe("${firstName}");
  });

  test("round-trips", () => {
    const stored = "${trigger.data.firstName} just hit ${increment.next}!";
    expect(toStoredText(toDisplayText(stored, names), names)).toBe(stored);
  });
});
