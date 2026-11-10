import { describe, expect, test } from "bun:test";
import { installedDetail, listingDeclarations, marketplaceMetadataOf, parseManifestSettings } from "./module-detail";

describe("parseManifestSettings", () => {
  test("keeps the kind a resource_ref setting links, so the settings pane can offer a picker", () => {
    const settings = parseManifestSettings({
      settings: [
        { id: "timer", label: "Subathon timer", type: "resource_ref", resourceKind: "timer" },
        { id: "symbol", label: "Currency symbol", type: "text" },
      ],
    });
    expect(settings[0]).toMatchObject({ id: "timer", type: "resource_ref", resourceKind: "timer" });
    expect(settings[1]).not.toHaveProperty("resourceKind");
  });

  test("keeps a list setting's row fields, so the settings pane can render its rows", () => {
    const settings = parseManifestSettings({
      settings: [
        {
          id: "items",
          label: "Entries",
          type: "list",
          itemFields: [{ id: "label", label: "Entry", type: "text", required: true }],
        },
      ],
    });
    expect(settings[0]).toMatchObject({
      id: "items",
      type: "list",
      itemFields: [{ id: "label", label: "Entry", type: "text", required: true }],
    });
  });

  test("leaves out a list setting whose rows hold nothing it can render", () => {
    const settings = parseManifestSettings({
      settings: [
        { id: "empty", label: "Empty", type: "list" },
        { id: "nested", label: "Nested", type: "list", itemFields: [{ id: "x", label: "X", type: "list" }] },
        { id: "symbol", label: "Currency symbol", type: "text" },
      ],
    });
    expect(settings.map((s) => s.id)).toEqual(["symbol"]);
  });
});

describe("installedDetail", () => {
  const facts = {
    listingId: "cozy",
    moduleRef: "module-1",
    name: "Cozy",
    description: "Warm alerts",
    version: "1.2.0",
    tags: ["alerts"],
    isInstalled: true,
  };

  test("takes what the module registered and what its manifest declares", () => {
    const detail = installedDetail(
      facts,
      [{ slug: "t", name: "Trigger", description: "", color: "#888888" }],
      [],
      [],
      [{ widgetId: "cozy:widget:box", name: "Box" }],
      { id: "cozy", permissions: ["chat.read"], settings: [{ id: "color", label: "Color", type: "string" }] }
    );
    expect(detail).toMatchObject({
      id: "cozy",
      moduleDbId: "module-1",
      author: "",
      category: "Utilities",
      permissions: ["chat.read"],
      triggers: [{ key: "t", name: "Trigger" }],
      widgets: [{ slug: "cozy:widget:box", name: "Box" }],
      workflows: [],
    });
    expect(detail.manifestSettings.map((s) => s.id)).toEqual(["color"]);
  });

  test("permissions and local endpoints are unknown without a manifest", () => {
    const detail = installedDetail(facts, [], [], [], [], null);
    expect([detail.permissions, detail.localEndpoints]).toEqual([null, null]);
  });
});

describe("marketplaceMetadataOf", () => {
  test("reads the readme, icon, version and workflows from a listing, wrapped or not", () => {
    const listing = {
      readme: "# Cozy",
      iconUrl: "https://x/icon.png",
      version: "1.3.0",
      workflows: [{ slug: "w", name: "W" }],
    };
    expect(marketplaceMetadataOf({ module: listing })).toEqual({
      readme: "# Cozy",
      iconUrl: "https://x/icon.png",
      latestVersion: "1.3.0",
      workflows: [{ slug: "w", name: "W" }],
    });
    expect(marketplaceMetadataOf(listing).latestVersion).toBe("1.3.0");
  });

  test("a listing with nothing to add adds nothing", () => {
    expect(marketplaceMetadataOf(null)).toEqual({ workflows: [] });
  });
});

describe("listingDeclarations", () => {
  const obs = { id: "obs", name: "OBS", protocol: "websocket" };
  const cases: { name: string; payload: unknown; expected: ReturnType<typeof listingDeclarations> }[] = [
    {
      name: "reads permissions and local endpoints from a wrapped detail",
      payload: { module: { permissions: ["obs.control"], localEndpoints: [obs] } },
      expected: { permissions: ["obs.control"], localEndpoints: [obs] },
    },
    {
      name: "reads an unwrapped detail",
      payload: { permissions: [], localEndpoints: [] },
      expected: { permissions: [], localEndpoints: [] },
    },
    {
      name: "is unknown from a marketplace that does not send them",
      payload: { module: { id: "chat-tools" } },
      expected: null,
    },
    {
      name: "is unknown when only one of the two is sent",
      payload: { module: { permissions: ["obs.control"] } },
      expected: null,
    },
    {
      name: "leaves out endpoints it cannot show and entries that are not strings",
      payload: {
        module: {
          permissions: ["twitch.channel", 7],
          localEndpoints: [
            obs,
            { id: "midi", name: "MIDI", protocol: "serial" },
            { id: "x", name: " ", protocol: "http" },
          ],
        },
      },
      expected: { permissions: ["twitch.channel"], localEndpoints: [obs] },
    },
  ];
  for (const { name, payload, expected } of cases) {
    test(name, () => {
      expect(listingDeclarations(payload)).toEqual(expected);
    });
  }
});
