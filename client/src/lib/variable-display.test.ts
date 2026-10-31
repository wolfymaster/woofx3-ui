import { describe, expect, test } from "bun:test";
import { expressionProblem, toDisplayText, toStoredText, variableNames } from "./variable-display";
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
    expect(toStoredText("Hi {firstName}, count {next}", names, { functions: false })).toBe(
      "Hi ${trigger.data.firstName}, count ${increment.next}"
    );
  });

  test("leaves unknown references and compound expressions as typed", () => {
    const stored = '${gone.value} ${trigger.data.firstName == "x" ? "a" : "b"}';
    expect(toDisplayText(stored, names)).toBe(stored);
  });

  test("leaves braces that name no variable as literal text", () => {
    expect(toStoredText("{unknown} and { firstName }", names, { functions: false })).toBe(
      "{unknown} and { firstName }"
    );
  });

  test("does not rewrite a reference the user typed out with its $", () => {
    expect(toStoredText("${firstName}", names, { functions: false })).toBe("${firstName}");
  });

  test("round-trips", () => {
    const stored = "${trigger.data.firstName} just hit ${increment.next}!";
    expect(toStoredText(toDisplayText(stored, names), names, { functions: false })).toBe(stored);
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
    expect(toStoredText("Thank you {userName}!", inputNames, { functions: false })).toBe("Thank you {{userName}}!");
  });

  test("never reads the inside of an input reference as a short name", () => {
    expect(toStoredText("Thank you {{userName}}!", triggerNames, { functions: false })).toBe("Thank you {{userName}}!");
    expect(toStoredText("Thank you {{userName}}!", inputNames, { functions: false })).toBe("Thank you {{userName}}!");
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
    expect(toStoredText(toDisplayText(stored, inputNames), inputNames, { functions: false })).toBe(stored);
    expect(toStoredText(toDisplayText(stored, triggerNames), triggerNames, { functions: false })).toBe(stored);
  });
});

describe("function calls in a field", () => {
  const names = variableNames([
    option("${trigger.data.amount}"),
    option("${trigger.data.bits}"),
    option("${increment.next}"),
  ]);
  const on = { functions: true };

  const roundTrips: [string, string][] = [
    ["{round(amount, 2)}", "${round(trigger.data.amount, 2)}"],
    ["{round(divide(bits, 100), 2)}", "${round(divide(trigger.data.bits, 100), 2)}"],
    ["{add(amount || 0, next)}", "${add(trigger.data.amount || 0, increment.next)}"],
    ["{uppercase('amount, (bits)')}", "${uppercase('amount, (bits)')}"],
    ["{random(1, 6)}", "${random(1, 6)}"],
    ["Hi {amount}: {max(amount, 5)}!", "Hi ${trigger.data.amount}: ${max(trigger.data.amount, 5)}!"],
    ["{round(amount ,  2)}", "${round(trigger.data.amount ,  2)}"],
    ["{round()}", "${round()}"],
    ["{round(gone.value)}", "${round(gone.value)}"],
  ];
  for (const [display, stored] of roundTrips) {
    test(`${display} round trips`, () => {
      expect(toStoredText(display, names, on)).toBe(stored);
      expect(toDisplayText(stored, names)).toBe(display);
    });
  }

  test("an engine without functions keeps the text as it was", () => {
    expect(toStoredText("{round(amount)}", names, { functions: false })).toBe("{round(amount)}");
  });

  test("text that only looks like a call stays text", () => {
    for (const text of ["{note(s)}", "{round(amount", "round(amount)", "{{round(amount)}}"]) {
      expect(toStoredText(text, names, on)).toBe(text);
    }
  });

  test("a compound expression around a call stays as typed", () => {
    const stored = "${max(trigger.data.amount, 1) > 2 ? 'big' : 'small'}";
    expect(toDisplayText(stored, names)).toBe(stored);
  });

  const problems: [string, string | null][] = [
    ["{round(amount, 2)}", null],
    ["{note(s)}", '"note" isn\'t a function.'],
    ["{add(amount)}", "add takes at least 2 arguments, got 1"],
    ["{round()}", "round takes at least 1 argument, got 0"],
    ["{round(1, 2, 3)}", "round takes at most 2 arguments, got 3"],
    ["{round(amuont)}", '"amuont" isn\'t a variable here.'],
    ["{round(trigger.data.other)}", null],
    ["no calls {amount}", null],
  ];
  for (const [display, want] of problems) {
    test(`problem in ${display}`, () => {
      expect(expressionProblem(toStoredText(display, names, on), display, names, { functions: false })).toBe(want);
    });
  }
});
