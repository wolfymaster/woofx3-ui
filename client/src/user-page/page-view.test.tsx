import { describe, expect, test } from "bun:test";
import type { PublicPageLookup, PublicPageSection, PublicPageWidget } from "@shared/user-pages";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type Clock, ClockProvider } from "./clock";
import { documentTitle, type PublishedPage, UserPageView } from "./page-view";
import PageMarkdown from "./widgets/markdown";
import { PageWidgetView } from "./widgets/page-widget";

const NOW = 1_800_000_000_000;
const fixedClock: Clock = { now: () => NOW, after: () => () => {} };

function render(element: ReactElement): string {
  return renderToStaticMarkup(<ClockProvider clock={fixedClock}>{element}</ClockProvider>);
}

function page(overrides: Partial<PublishedPage> = {}): PublishedPage {
  return {
    kind: "page",
    slug: "wolfy",
    layout: "single",
    theme: { accent: "teal" },
    sections: [],
    publishedAt: NOW,
    ...overrides,
  };
}

function section(id: string, region: PublicPageSection["region"], widgets: PublicPageWidget[] = []): PublicPageSection {
  return { id, region, title: `Section ${id}`, widgets };
}

const COUNTER_KIND = "woofx3:counter";
const TIMER_KIND = "woofx3:timer";

describe("UserPageView per lookup", () => {
  test("loading shows the skeleton", () => {
    const html = render(<UserPageView lookup={undefined} claimable={false} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading page");
  });

  test("a page shows its name, accent and sections", () => {
    const html = render(<UserPageView lookup={page({ sections: [section("a", "main")] })} claimable={false} />);
    expect(html).toContain("<h1");
    expect(html).toContain("wolfy");
    expect(html).toContain("--accent:20 184 166");
    expect(html).toContain("Section a");
  });

  test("unavailable is a plain not-found page", () => {
    const html = render(<UserPageView lookup={{ kind: "unavailable" }} claimable={true} />);
    expect(html).toContain("There&#x27;s no page here");
    expect(html).not.toContain("Claim this page");
  });

  test("unclaimed and claimable invites the visitor to claim it", () => {
    const html = render(<UserPageView lookup={{ kind: "unclaimed" }} claimable={true} />);
    expect(html).toContain("Claim this page");
    expect(html).toContain('href="https://stream.woofx3.tv/auth/register"');
  });

  test("unclaimed but not claimable reads like unavailable", () => {
    const unclaimed = render(<UserPageView lookup={{ kind: "unclaimed" }} claimable={false} />);
    const unavailable = render(<UserPageView lookup={{ kind: "unavailable" }} claimable={false} />);
    expect(unclaimed).toBe(unavailable);
  });

  test("the banner and avatar load only from https", () => {
    const secure = render(
      <UserPageView
        lookup={page({
          theme: {
            accent: "rose",
            banner: { kind: "url", url: "https://cdn.example.com/banner.png" },
            avatar: { kind: "url", url: "https://cdn.example.com/avatar.png" },
          },
        })}
        claimable={false}
      />
    );
    expect(secure).toContain('src="https://cdn.example.com/banner.png"');
    expect(secure).toContain('src="https://cdn.example.com/avatar.png"');
    const insecure = render(
      <UserPageView
        lookup={page({ theme: { accent: "rose", banner: { kind: "url", url: "http://cdn.example.com/b.png" } } })}
        claimable={false}
      />
    );
    expect(insecure).not.toContain("cdn.example.com");
    expect(insecure).toContain("banner-fallback");
  });
});

describe("layouts", () => {
  function regionOrder(html: string): string[] {
    return [...html.matchAll(/data-region="([a-z]+)"/g)].map((match) => match[1]);
  }

  test("sidebar renders main then aside, each region's sections in page order", () => {
    const html = render(
      <UserPageView
        lookup={page({
          layout: "sidebar",
          sections: [section("s1", "aside"), section("m1", "main"), section("s2", "aside"), section("m2", "main")],
        })}
        claimable={false}
      />
    );
    expect(regionOrder(html)).toEqual(["main", "aside"]);
    const order = ["m1", "m2", "s1", "s2"].map((id) => html.indexOf(`Section ${id}`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("hero-grid renders the hero above the grid", () => {
    const html = render(
      <UserPageView
        lookup={page({ layout: "hero-grid", sections: [section("g", "grid"), section("h", "hero")] })}
        claimable={false}
      />
    );
    expect(regionOrder(html)).toEqual(["hero", "grid"]);
    expect(html.indexOf("Section h")).toBeLessThan(html.indexOf("Section g"));
  });
});

describe("widgets", () => {
  test("text waits for the Markdown chunk behind a placeholder", () => {
    const html = render(<PageWidgetView widget={{ id: "t", type: "text", config: { markdown: "**hi**" } }} />);
    expect(html).toContain('aria-hidden="true"');
  });

  test("Markdown renders formatting but no HTML and no unsafe links", () => {
    const html = renderToStaticMarkup(
      <PageMarkdown
        markdown={
          "**bold** <script>alert(1)</script> <b>raw</b> [ok](https://twitch.tv/wolfy) [bad](javascript:alert(1)) ![pic](http://insecure.example.com/a.png)"
        }
      />
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>");
    expect(html).toContain('href="https://twitch.tv/wolfy"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("insecure.example.com");
  });

  test("a counter shows its value and its next goal", () => {
    const html = render(
      <PageWidgetView
        widget={{
          id: "c",
          type: "counter",
          config: { label: "Deaths", showGoals: true },
          state: {
            kind: COUNTER_KIND,
            value: { value: 1234, reached: {} },
            settings: { goals: [{ value: 2000, name: "Rage quit" }] },
          },
        }}
      />
    );
    expect(html).toContain("Deaths");
    expect(html).toContain((1234).toLocaleString());
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("Rage quit");
  });

  test("a counter hides its goals when told to", () => {
    const html = render(
      <PageWidgetView
        widget={{
          id: "c",
          type: "counter",
          config: { showGoals: false },
          state: { kind: COUNTER_KIND, value: 3, settings: { goals: "10" } },
        }}
      />
    );
    expect(html).not.toContain("progressbar");
  });

  test("a counter with no value yet says so", () => {
    const html = render(
      <PageWidgetView widget={{ id: "c", type: "counter", config: { showGoals: true }, state: null }} />
    );
    expect(html).toContain("Nothing counted yet.");
  });

  test("a running timer counts down from when it ends", () => {
    const html = render(
      <PageWidgetView
        widget={{
          id: "t",
          type: "timer",
          config: { label: "Subathon" },
          state: { kind: TIMER_KIND, value: { running: true, endsAt: NOW + 61_500 }, settings: { duration: 300 } },
        }}
      />
    );
    expect(html).toContain("Subathon");
    expect(html).toContain("1:02");
    expect(html).toContain("Counting down");
  });

  test("a paused timer shows its time left", () => {
    const html = render(
      <PageWidgetView
        widget={{
          id: "t",
          type: "timer",
          config: {},
          state: { kind: TIMER_KIND, value: { running: false, remainingMs: 3_600_000 }, settings: {} },
        }}
      />
    );
    expect(html).toContain("1:00:00");
    expect(html).toContain("Paused");
  });

  test("a running timer past its end is finished", () => {
    const html = render(
      <PageWidgetView
        widget={{
          id: "t",
          type: "timer",
          config: {},
          state: { kind: TIMER_KIND, value: { running: true, endsAt: NOW - 1000 }, settings: {} },
        }}
      />
    );
    expect(html).toContain("0:00");
    expect(html).toContain("Time&#x27;s up");
  });

  test("live status shows what is streaming", () => {
    const html = render(
      <PageWidgetView
        widget={{
          id: "l",
          type: "live-status",
          config: { showTitle: true, showGame: true, showViewerCount: true },
          live: { isLive: true, title: "Speedrunning", game: "Celeste", viewerCount: 42 },
        }}
      />
    );
    expect(html).toContain("Live now");
    expect(html).toContain("Speedrunning");
    expect(html).toContain("Celeste");
    expect(html).toContain("42 watching");
  });

  test("live status offline", () => {
    const html = render(
      <PageWidgetView
        widget={{
          id: "l",
          type: "live-status",
          config: { showTitle: true, showGame: true, showViewerCount: false },
          live: { isLive: false },
        }}
      />
    );
    expect(html).toContain("Offline right now");
  });

  test("links open safely and skip anything not http or https", () => {
    const html = render(
      <PageWidgetView
        widget={{
          id: "k",
          type: "links",
          config: {
            links: [
              { label: "Twitch", url: "https://www.twitch.tv/wolfy" },
              { label: "Bad", url: "javascript:alert(1)" },
            ],
          },
        }}
      />
    );
    expect(html).toContain('href="https://www.twitch.tv/wolfy"');
    expect(html).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(html).toContain("twitch.tv");
    expect(html).not.toContain("Bad");
  });

  test("an image renders as given when https, linked when it has a link", () => {
    const html = render(
      <PageWidgetView
        widget={{
          id: "i",
          type: "image",
          config: {
            image: { kind: "url", url: "https://cdn.example.com/emote.png" },
            alt: "My emote",
            linkUrl: "https://example.com",
          },
        }}
      />
    );
    expect(html).toContain('src="https://cdn.example.com/emote.png"');
    expect(html).toContain('alt="My emote"');
    expect(html).toContain('href="https://example.com/"');
  });

  test("an image over http is not loaded", () => {
    const html = render(
      <PageWidgetView
        widget={{
          id: "i",
          type: "image",
          config: { image: { kind: "url", url: "http://x.example.com/a.png" }, alt: "" },
        }}
      />
    );
    expect(html).toBe("");
  });

  test("a form shows its questions disabled and says it is not taking answers", () => {
    const html = render(
      <PageWidgetView
        widget={{
          id: "f",
          type: "form",
          config: {
            title: "Song requests",
            submitLabel: "Request",
            fields: [
              { id: "song", type: "text", label: "Song", required: true, maxLength: 100 },
              { id: "why", type: "textarea", label: "Why", required: false, maxLength: 500 },
              {
                id: "mood",
                type: "select",
                label: "Mood",
                required: false,
                options: [{ value: "hype", label: "Hype" }],
              },
              { id: "ok", type: "checkbox", label: "I follow", required: false },
            ],
          },
        }}
      />
    );
    expect(html).toContain("Song requests");
    expect(html).toContain("<fieldset disabled");
    expect(html).toContain("This form isn&#x27;t taking answers yet.");
    for (const label of ["Song", "Why", "Hype", "I follow", "Request"]) {
      expect(html).toContain(label);
    }
  });
});

describe("documentTitle", () => {
  const cases: Array<{ lookup: PublicPageLookup | undefined; title: string }> = [
    { lookup: undefined, title: "woofx3" },
    { lookup: page(), title: "wolfy on woofx3" },
    { lookup: { kind: "unavailable" }, title: "Page not found | woofx3" },
    { lookup: { kind: "unclaimed" }, title: "Page not found | woofx3" },
  ];
  for (const { lookup, title } of cases) {
    test(`${lookup?.kind ?? "loading"} is titled "${title}"`, () => {
      expect(documentTitle(lookup)).toBe(title);
    });
  }
});
