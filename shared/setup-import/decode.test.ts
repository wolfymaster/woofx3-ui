import { describe, expect, test } from "bun:test";
import { gzipSync, strToU8, zipSync } from "fflate";
import { decodeFirebotFile, decodeStreamerbotExport, ImportFileError } from "./decode";

function streamerbotString(json: unknown): string {
  const gzipped = gzipSync(strToU8(JSON.stringify(json)));
  const bytes = new Uint8Array(4 + gzipped.length);
  bytes.set(strToU8("SBAE"));
  bytes.set(gzipped, 4);
  return btoa(String.fromCharCode(...bytes));
}

describe("decodeStreamerbotExport", () => {
  const exported = { version: 23, meta: { name: "Pack" }, data: { actions: [] } };

  test("reads the SBAE header, gzip and JSON, ignoring line breaks", () => {
    const text = streamerbotString(exported);
    expect(text.startsWith("U0JBRR+LCA")).toBe(true);
    const wrapped = `﻿${text.slice(0, 20)}\n${text.slice(20)}  `;
    expect(decodeStreamerbotExport(wrapped, "pack.sb")).toEqual({ name: "pack", export: exported });
  });

  test("refuses text that is not an export", () => {
    expect(() => decodeStreamerbotExport("hello there")).toThrow(ImportFileError);
    expect(() => decodeStreamerbotExport(btoa("JUNKJUNKJUNK"))).toThrow("not a Streamer.bot export string");
    expect(() => decodeStreamerbotExport(streamerbotString(exported).slice(0, 40))).toThrow("cut short");
  });
});

describe("decodeFirebotFile", () => {
  test("reads a .firebotsetup file", () => {
    const setup = { name: "Stream setup", components: { commands: [] } };
    const document = decodeFirebotFile("x.firebotsetup", strToU8(JSON.stringify(setup)));
    expect(document).toEqual({ name: "Stream setup", components: { commands: [] } });
  });

  test("refuses JSON that is not a setup", () => {
    expect(() => decodeFirebotFile("x.json", strToU8('{"hello":1}'))).toThrow("not a Firebot setup");
  });

  test("gathers a backup's signed-in profile into setup components", () => {
    const json = (value: unknown) => strToU8(JSON.stringify(value));
    const zip = zipSync({
      "global-settings.json": json({ profiles: { activeProfiles: ["Main", "Alt"], loggedInProfile: "Alt" } }),
      "profiles/Main/chat/commands.json": json({ customCommands: { a: { id: "a", trigger: "!main" } } }),
      "profiles/Alt/chat/commands.json": json({ customCommands: { b: { id: "b", trigger: "!alt" } } }),
      "profiles/Alt/events/events.json": json({
        mainEvents: [{ id: "e1" }],
        groups: { g: { id: "g", events: [{ id: "e2" }] } },
      }),
      "profiles/Alt/timers.json": json({ t: { id: "t", name: "Timer" } }),
      "profiles/Alt/counters/counters.json": json({ k: { id: "k", name: "Deaths" } }),
      "profiles/Alt/roles/custom-roles.json": json({ r: { id: "r", name: "Regulars", viewers: [] } }),
      "overlay-resources/sound.mp3": new Uint8Array([1, 2, 3]),
    });
    const document = decodeFirebotFile("backup_1.zip", zip);
    expect(document.name).toBe("Alt");
    expect(document.components.commands).toEqual([{ id: "b", trigger: "!alt" }]);
    expect(document.components.events).toEqual([{ id: "e1" }]);
    expect(document.components.eventGroups).toEqual([{ id: "g", events: [{ id: "e2" }] }]);
    expect(document.components.timers).toEqual([{ id: "t", name: "Timer" }]);
    expect(document.components.counters).toEqual([{ id: "k", name: "Deaths" }]);
    expect(document.components.viewerRoles).toEqual([{ id: "r", name: "Regulars", viewers: [] }]);
  });

  test("refuses a zip that is not a Firebot backup", () => {
    const zip = zipSync({ "readme.json": strToU8("{}") });
    expect(() => decodeFirebotFile("other.zip", zip)).toThrow("not a Firebot backup");
  });
});
