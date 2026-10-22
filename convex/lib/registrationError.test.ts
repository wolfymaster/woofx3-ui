import { describe, expect, test } from "bun:test";
import { registrationFailureMessage } from "./registrationError";

describe("registrationFailureMessage", () => {
  const cases: Array<{ name: string; error: unknown; message: string }> = [
    {
      name: "strips the marker from a refused registration",
      error: new Error("RegistrationRefused: Registration token is invalid"),
      message: "Registration token is invalid",
    },
    {
      name: "strips the marker from a refused authentication",
      error: new Error("AuthenticationRefused: Invalid client credentials"),
      message: "Invalid client credentials",
    },
    { name: "keeps another error's message", error: new Error("fetch failed"), message: "fetch failed" },
    {
      name: "keeps a marker that is not at the start",
      error: new Error("got RegistrationRefused: x"),
      message: "got RegistrationRefused: x",
    },
    { name: "stringifies a non-error", error: "boom", message: "boom" },
  ];

  for (const { name, error, message } of cases) {
    test(name, () => {
      expect(registrationFailureMessage(error)).toBe(message);
    });
  }
});
