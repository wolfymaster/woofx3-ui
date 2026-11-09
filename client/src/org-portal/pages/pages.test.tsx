import { describe, expect, mock, test } from "bun:test";
import type { Id } from "@convex/_generated/dataModel";
import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { OrganizationProvider, type OrganizationSelection } from "../organization-context";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The portal pages reach Convex through convex/react; these fakes stand in for
// it. Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for later files.
const convexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...convexReact,
  useMutation: () => async () => null,
}));

const { default: EnginesPage } = await import("./engines");

const ACCOUNT_ID = "account-1" as Id<"accounts">;

function selection(role: "owner" | "admin"): OrganizationSelection {
  const owner = role === "owner";
  const organization = {
    accountId: ACCOUNT_ID,
    name: "Wolfy Streams",
    role,
    can: {
      viewOrganization: true,
      renameOrganization: true,
      manageMembers: true,
      manageEngines: true,
      createEngine: owner,
      viewBilling: true,
      manageBilling: owner,
    },
    engines: [
      {
        instanceId: "instance-1" as Id<"instances">,
        name: "Main",
        hosting: "managed" as const,
        status: "registered" as const,
        canOpen: true,
      },
    ],
    subscription: null,
    seats: { used: 2, limit: 5 },
  };
  return { organization, organizations: [organization], select: () => undefined };
}

async function render(role: "owner" | "admin", page: ReactNode): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <Router hook={memoryLocation({ path: "/org" }).hook}>
        <OrganizationProvider value={selection(role)}>{page}</OrganizationProvider>
      </Router>,
      {
        createNodeMock: () => ({}),
      }
    );
  });
  if (renderer === undefined) {
    throw new Error("render: the renderer was not created");
  }
  return renderer;
}

function byTestId(renderer: ReactTestRenderer, id: string) {
  return renderer.root.findAll((node) => node.props["data-testid"] === id && typeof node.type === "string");
}

describe("Engines page", () => {
  test("offers no way to create another engine, even to the owner", async () => {
    const renderer = await render("owner", <EnginesPage />);
    expect(byTestId(renderer, "row-engine-instance-1").length).toBe(1);
    expect(byTestId(renderer, "button-create-engine").length).toBe(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Create another engine");
  });
});
