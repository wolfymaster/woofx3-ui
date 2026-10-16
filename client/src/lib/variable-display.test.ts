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

describe("input references", () => {
  const triggerNames = variableNames([option("${trigger.data.userName}")]);
  const inputNames = variableNames([option("{{userName}}"), option("{{user.name}}")]);

  test("names an input by its whole id", () => {
    expect(inputNames.nameByToken.get("{{userName}}")).toBe("userName");
    expect(inputNames.nameByToken.get("{{user.name}}")).toBe("user.name");
  });

  test("shows an input reference as its short name and stores it back", () => {
    expect(toDisplayText("{{userName}} just followed!", inputNames)).toBe("{userName} just followed!");
    expect(toStoredText("Thank you {userName}!", inputNames)).toBe("Thank you {{userName}}!");
  });

  test("never reads the inside of an input reference as a short name", () => {
    expect(toStoredText("Thank you {{userName}}!", triggerNames)).toBe("Thank you {{userName}}!");
    expect(toStoredText("Thank you {{userName}}!", inputNames)).toBe("Thank you {{userName}}!");
  });

  test("keeps an escaped {{ as literal text", () => {
    expect(toDisplayText("\\{{userName}}", inputNames)).toBe("\\{{userName}}");
  });

  test("keeps a reference in full where its short form would not read back", () => {
    expect(toDisplayText("{${trigger.data.userName}}", triggerNames)).toBe("{${trigger.data.userName}}");
    expect(toDisplayText("$${trigger.data.userName}", triggerNames)).toBe("$${trigger.data.userName}");
  });

  test.each([
    "Thank you {{userName}}!",
    "{{userName}} and {{user.name}} and \\{{literal}}",
    "{{{userName}}}",
    "{${trigger.data.userName}} ${trigger.data.userName}",
    "{{ userName }} {{unknown}}",
  ])("round-trips %p in either mode", (stored) => {
    expect(toStoredText(toDisplayText(stored, inputNames), inputNames)).toBe(stored);
    expect(toStoredText(toDisplayText(stored, triggerNames), triggerNames)).toBe(stored);
  });
});
