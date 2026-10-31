import { beforeEach, describe, expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { EngineGatewayProvider } from "@/engine/context";
import type { EngineGateway } from "@/engine/gateway";
import type { AuthorPage, InstanceId } from "@/engine/types";
import { type MarketplaceAuthorResult, useMarketplaceAuthor } from "./use-marketplace";

const INSTANCE = "instance-1" as InstanceId;

function authorPage(displayName: string): AuthorPage {
  return { author: { displayName }, listings: [], total: 0 } as unknown as AuthorPage;
}

interface PendingRequest {
  slug: string;
  resolve: (page: AuthorPage | null) => void;
  reject: (error: Error) => void;
}

let pending: PendingRequest[] = [];
const request = (slug: string) =>
  new Promise<AuthorPage | null>((resolve, reject) => {
    pending.push({ slug, resolve, reject });
  });
const gateway = { marketplace: { useAuthorRequest: () => request } } as unknown as EngineGateway;

let latest: MarketplaceAuthorResult;
function Probe({ slug }: { slug: string }) {
  latest = useMarketplaceAuthor(INSTANCE, slug);
  return null;
}

function tree(slug: string) {
  return (
    <EngineGatewayProvider gateway={gateway}>
      <Probe slug={slug} />
    </EngineGatewayProvider>
  );
}

async function render(slug: string): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(tree(slug));
  });
  if (!renderer) {
    throw new Error("render: the renderer was not created");
  }
  return renderer;
}

describe("useMarketplaceAuthor", () => {
  beforeEach(() => {
    pending = [];
  });

  test("shows the page once the request resolves, having asked once", async () => {
    await render("wolfy");
    expect(latest.loading).toBe(true);
    expect(pending.map((call) => call.slug)).toEqual(["wolfy"]);

    await act(async () => {
      pending[0]?.resolve(authorPage("Wolfy"));
    });

    expect(latest.page?.author.displayName).toBe("Wolfy");
    expect(latest.loading).toBe(false);
    expect(pending).toHaveLength(1);
  });

  test("reports an author the marketplace does not know", async () => {
    await render("nobody");
    await act(async () => {
      pending[0]?.resolve(null);
    });

    expect(latest.notFound).toBe(true);
    expect(latest.loading).toBe(false);
  });

  test("reports a failure once, without asking again", async () => {
    await render("wolfy");
    await act(async () => {
      pending[0]?.reject(new Error("marketplace is down"));
    });

    expect(latest.error).toContain("marketplace is down");
    expect(latest.loading).toBe(false);
    expect(pending).toHaveLength(1);
  });

  test("a slower answer for the previous author never shows on the next one", async () => {
    const renderer = await render("first");
    await act(async () => {
      renderer.update(tree("second"));
    });
    expect(pending.map((call) => call.slug)).toEqual(["first", "second"]);

    await act(async () => {
      pending[1]?.resolve(authorPage("Second"));
    });
    await act(async () => {
      pending[0]?.resolve(authorPage("First"));
    });

    expect(latest.page?.author.displayName).toBe("Second");
    expect(latest.loading).toBe(false);
  });
});
