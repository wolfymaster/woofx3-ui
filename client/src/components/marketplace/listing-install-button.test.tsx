import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { CatalogListingDetail } from "@shared/marketplace-catalog";
import { act, create } from "react-test-renderer";
import type { EngineScope, OrganizationAccess } from "@/engine/types";
import type { ListingInstallState } from "./listing-install-button";

let access: OrganizationAccess | null | undefined;
const purchases: string[] = [];
const bundleInstalls: string[] = [];

const realAccess = await import("@/engine/hooks/use-organization-access");
mock.module("@/engine/hooks/use-organization-access", () => ({ ...realAccess, useOrganizationAccess: () => access }));
const scope: EngineScope = {
  instanceId: "instance-1",
  optimisticInstanceId: "instance-1",
  isInstanceLoading: false,
};
const realScope = await import("@/engine/context");
mock.module("@/engine/context", () => ({ ...realScope, useEngineScope: () => scope }));
// mock.module is process-wide, so the other exports stay real for the test files that share it.
const realModules = await import("@/engine/hooks/use-modules");
mock.module("@/engine/hooks/use-modules", () => ({
  ...realModules,
  useMarketplaceBundleInstallRequest: () => async (listingId: string) => {
    bundleInstalls.push(listingId);
    return { kind: "scene", engineId: "scene-1" };
  },
}));

const { ListingInstallButton } = await import("./listing-install-button");

const listing = (type: CatalogListingDetail["type"]): CatalogListingDetail =>
  ({ id: "cozy", type, name: "Cozy Cats" }) as CatalogListingDetail;

const PURCHASABLE: ListingInstallState = { kind: "purchasable", amountCents: 99, currency: "usd" };

async function render(
  state: ListingInstallState,
  type: CatalogListingDetail["type"] = "overlay",
  props: {
    onPurchase?: () => void;
    onInstallModule?: () => void;
    onBundleInstalled?: (result: { kind: "scene" | "alert"; engineId: string }) => void;
  } = {}
) {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<ListingInstallButton listing={listing(type)} state={state} {...props} />);
  });
  return tree;
}

/** The button whose label matches, so a nav button cannot be clicked by mistake. */
function button(tree: ReturnType<typeof create>, label: RegExp) {
  const found = tree.root.findAll(
    (node) => node.type === "button" && label.test(node.children.filter((c) => typeof c === "string").join(" "))
  );
  if (found.length === 0) {
    throw new Error(`no button matched ${label}`);
  }
  return found[0];
}

describe("ListingInstallButton", () => {
  beforeEach(() => {
    purchases.length = 0;
    bundleInstalls.length = 0;
    access = { manageBilling: true, viewBilling: true };
  });

  test("a paid bundle buys through the install flow, not the bundle install", async () => {
    const tree = await render(PURCHASABLE, "overlay", {
      onPurchase: () => purchases.push("bought"),
      onInstallModule: () => purchases.push("installed"),
    });
    await act(async () => {
      button(tree, /Buy for/).props.onClick();
    });
    expect(purchases).toEqual(["bought"]);
    expect(bundleInstalls).toEqual([]);
  });

  test("a paid module buys through the same flow", async () => {
    const tree = await render(PURCHASABLE, "module", { onPurchase: () => purchases.push("bought") });
    await act(async () => {
      button(tree, /Buy for/).props.onClick();
    });
    expect(purchases).toEqual(["bought"]);
  });

  test("without a purchase path the Buy button is disabled and says why", async () => {
    const tree = await render(PURCHASABLE, "overlay");
    expect(button(tree, /Buy for/).props.disabled).toBe(true);
    expect(JSON.stringify(tree.toJSON())).toContain("v0.71.0");
  });

  test("an organization's member may not buy", async () => {
    access = { manageBilling: false, viewBilling: false };
    const tree = await render(PURCHASABLE, "overlay", { onPurchase: () => purchases.push("bought") });
    expect(button(tree, /Buy for/).props.disabled).toBe(true);
    expect(JSON.stringify(tree.toJSON())).toContain("Only the organization's owner can buy this");
  });

  test("a free bundle installs through the bundle install", async () => {
    const tree = await render({ kind: "installable" }, "overlay", {
      onInstallModule: () => purchases.push("installed"),
      onBundleInstalled: () => purchases.push("bundle-installed"),
    });
    await act(async () => {
      button(tree, /^Install/).props.onClick();
      // The bundle install is started, not awaited, so let its promise settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(bundleInstalls).toEqual(["cozy"]);
    expect(purchases).toEqual(["bundle-installed"]);
  });
});
