import { beforeEach, describe, expect, test } from "bun:test";
import type { CatalogCounts } from "@shared/marketplace-catalog";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { EngineGatewayProvider } from "@/engine/context";
import type { EngineGateway } from "@/engine/gateway";
import type { InstanceId } from "@/engine/types";
import { type MarketplaceCounts, useMarketplaceCounts } from "./use-marketplace";

const FIRST = "instance-1" as InstanceId;
const SECOND = "instance-2" as InstanceId;

function catalogCounts(modules: number): CatalogCounts {
  return { module: modules } as unknown as CatalogCounts;
}

interface PendingRequest {
  resolve: (counts: CatalogCounts | null) => void;
  reject: (error: Error) => void;
}

let pending: PendingRequest[] = [];
const request = () =>
  new Promise<CatalogCounts | null>((resolve, reject) => {
    pending.push({ resolve, reject });
  });
const gateway = { marketplace: { useCountsRequest: () => request } } as unknown as EngineGateway;

let latest: MarketplaceCounts;
function Probe({ instanceId }: { instanceId: InstanceId }) {
  latest = useMarketplaceCounts(instanceId);
  return null;
}

function tree(instanceId: InstanceId) {
  return (
    <EngineGatewayProvider gateway={gateway}>
      <Probe instanceId={instanceId} />
    </EngineGatewayProvider>
  );
}

async function render(instanceId: InstanceId): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(tree(instanceId));
  });
  if (!renderer) {
    throw new Error("render: the renderer was not created");
  }
  return renderer;
}

describe("useMarketplaceCounts", () => {
  beforeEach(() => {
    pending = [];
  });

  test("shows the counts once the request resolves, having asked once", async () => {
    await render(FIRST);
    expect(latest.loading).toBe(true);
    expect(pending).toHaveLength(1);

    const counts = catalogCounts(3);
    await act(async () => {
      pending[0]?.resolve(counts);
    });

    expect(latest.counts).toBe(counts);
    expect(latest.loading).toBe(false);
    expect(pending).toHaveLength(1);
  });

  test("a marketplace with no counts route settles on null without asking again", async () => {
    await render(FIRST);
    await act(async () => {
      pending[0]?.resolve(null);
    });

    expect(latest.counts).toBeNull();
    expect(latest.loading).toBe(false);
    expect(pending).toHaveLength(1);
  });

  test("a failure settles on null without asking again", async () => {
    await render(FIRST);
    await act(async () => {
      pending[0]?.reject(new Error("marketplace is down"));
    });

    expect(latest.counts).toBeNull();
    expect(latest.loading).toBe(false);
    expect(pending).toHaveLength(1);
  });

  test("a slower answer for the previous instance never shows on the next one", async () => {
    const renderer = await render(FIRST);
    await act(async () => {
      renderer.update(tree(SECOND));
    });
    expect(pending).toHaveLength(2);

    const counts = catalogCounts(2);
    await act(async () => {
      pending[1]?.resolve(counts);
    });
    await act(async () => {
      pending[0]?.resolve(catalogCounts(1));
    });

    expect(latest.counts).toBe(counts);
    expect(latest.loading).toBe(false);
  });
});
