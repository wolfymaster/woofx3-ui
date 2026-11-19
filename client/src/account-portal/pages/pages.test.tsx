import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Id } from "@convex/_generated/dataModel";
import type { Invoice, Sponsorship } from "@convex/lib/billingClient";
import type { OrgMember } from "@convex/organizations";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { createContext, type ReactNode, useContext } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { MASKED_EMAIL } from "@/components/team/member-emails";
import { appLogger } from "@/lib/app-logger";
import { LoggerProvider } from "@/lib/logger-context";
import { OrganizationProvider, type OrganizationSelection, PortalScopeProvider } from "../organization-context";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The portal pages read Convex through convex/react; this fake answers their
// queries from the answers each render provides. Bun runs every test file in
// one process and a module mock is not undone, so the rest of convex/react
// stays real for later files.
interface ConvexAnswers {
  members: OrgMember[] | null;
  meId: string;
}
const ConvexAnswersContext = createContext<ConvexAnswers>({ members: null, meId: "owner-user" });
const PRICES_READY = {
  state: "ready",
  names: { starter: "Starter", pro: "Pro" },
  prices: [
    { plan: "starter", interval: "month", amountCents: 7_500, currency: "usd" },
    { plan: "starter", interval: "year", amountCents: 75_000, currency: "usd" },
    { plan: "pro", interval: "month", amountCents: 15_000, currency: "usd" },
    { plan: "pro", interval: "year", amountCents: 150_000, currency: "usd" },
  ],
};

// One function for every render: the pages list invoices in an effect keyed on the action.
let search = "";
const useTestSearch = () => search;
// Answers per action, by function name; an action with no answer returns an empty list. `askedActions` records each ask.
// An answer that never arrives, to hold a page in its loading state.
const NEVER = Symbol("never");
let actionAnswers: Record<string, unknown> = {};
let askedActions: string[] = [];
const actionFns = new Map<string, () => Promise<unknown>>();
function actionFor(name: string) {
  let fn = actionFns.get(name);
  if (fn === undefined) {
    fn = async () => {
      askedActions.push(name);
      const answer = name in actionAnswers ? actionAnswers[name] : [];
      if (answer === NEVER) {
        return new Promise(() => undefined);
      }
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    };
    actionFns.set(name, fn);
  }
  return fn;
}
const convexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...convexReact,
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useAction: (action: Parameters<typeof getFunctionName>[0]) => actionFor(getFunctionName(action)),
  useMutation: () => async () => null,
  useQuery: (query: Parameters<typeof getFunctionName>[0]) => {
    const answers = useContext(ConvexAnswersContext);
    const name = getFunctionName(query);
    if (name === "provisioning:isAvailable") {
      return { available: true };
    }
    if (name === "organizations:members") {
      return answers.members;
    }
    if (name === "instances:get") {
      return { lastEngineActivityAt: 1, url: "https://engine.example" };
    }
    if (name === "instances:getPlatformLinks" || name === "moduleRepository:list") {
      return [];
    }
    if (name === "engineMembers:listForEngine") {
      return { members: [], canManage: true, canManageOrganization: true };
    }
    if (name === "invitations:listForOrganization") {
      return [];
    }
    if (name === "instances:listForCurrentUser") {
      return [];
    }
    if (name === "users:getMe") {
      return { _id: answers.meId };
    }
    throw new Error(`pages.test: no fake for query ${name}`);
  },
}));

// Radix's avatar image loads through window.Image, which the test renderer has
// no window for. Its Select needs one too, so the member lists below only hold
// rows the viewer can't change: the owner, and the viewer themselves.
mock.module("@/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AvatarImage: () => null,
  AvatarFallback: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

// Radix's radio and collapsible read the DOM, which the test renderer lacks; the plan chooser only needs the markup.
mock.module("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  RadioGroupItem: () => null,
}));

mock.module("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  CollapsibleContent: () => null,
}));

// Radix's toggle group reads the DOM for roving focus; the filter only needs its markup here.
mock.module("@/components/ui/toggle-group", () => ({
  ToggleGroup: ({ children, "data-testid": testId }: { children: ReactNode; "data-testid"?: string }) => (
    <div data-testid={testId}>{children}</div>
  ),
  ToggleGroupItem: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}));

// Radix's dropdown positions its menu against the DOM; the team rows only need their trigger markup here.
const dropdownMenu = await import("@/components/ui/dropdown-menu");
mock.module("@/components/ui/dropdown-menu", () => ({
  ...dropdownMenu,
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: () => null,
}));

// The clock's interval needs a window, which the test renderer lacks.
mock.module("@/hooks/use-minute-clock", () => ({ useMinuteClock: () => 0 }));

const { default: TeamPage } = await import("./team");
const { default: PaymentsPage } = await import("./payments");
const { default: EngineDetailPage } = await import("./engine-detail");
const { default: EnginesPage } = await import("./engines");
const { default: OverviewPage } = await import("./overview");
const { default: PlansPage } = await import("./plans");
const { default: SponsorshipPage } = await import("./sponsorship");

const ACCOUNT_ID = "account-1" as Id<"accounts">;

let engineHosting: "managed" | "external" = "managed";

beforeEach(() => {
  engineHosting = "managed";
  search = "";
  actionAnswers = { "prices:list": PRICES_READY };
  askedActions = [];
});

function selection(role: "owner" | "admin"): OrganizationSelection {
  const owner = role === "owner";
  const organization = {
    accountId: ACCOUNT_ID,
    name: "Wolfy Streams",
    role,
    can: {
      viewOrganization: true,
      renameOrganization: owner,
      manageMembers: true,
      spendSeat: true,
      viewMemberEmails: owner,
      manageEngines: true,
      renameEngine: owner,
      createEngine: owner,
      changeEngineUrl: owner,
      deleteEngine: owner,
      viewLicenseKeys: true,
      manageBilling: owner,
    },
    engines: [
      {
        instanceId: "instance-1" as Id<"instances">,
        name: "Main",
        hosting: engineHosting,
        status: "registered" as const,
        canOpen: true,
      },
    ],
    subscription: null,
    seats: { used: 2, limit: 5 },
  };
  return { organization, organizations: [organization] };
}

function member(userId: string, role: OrgMember["role"], email?: string | null): OrgMember {
  return {
    userId: userId as Id<"users">,
    name: userId,
    ...(email === undefined ? {} : { email }),
    image: null,
    role,
    engines: [],
  };
}

async function render(
  role: "owner" | "admin" | null,
  page: ReactNode,
  answers: ConvexAnswers = { members: null, meId: "owner-user" },
  personalScopeOf: "owner" | "admin" | null = null,
  path = "/account"
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  const memory = memoryLocation({ path });
  await act(async () => {
    renderer = create(
      <Router hook={memory.hook} searchHook={useTestSearch}>
        <LoggerProvider logger={appLogger}>
          <ConvexAnswersContext.Provider value={answers}>
            {personalScopeOf !== null ? (
              <PortalScopeProvider
                value={{
                  scope: { kind: "personal" },
                  organizations: selection(personalScopeOf).organizations,
                  selectScope: () => undefined,
                }}
              >
                {page}
              </PortalScopeProvider>
            ) : role === null ? (
              page
            ) : (
              <OrganizationProvider value={selection(role)}>{page}</OrganizationProvider>
            )}
          </ConvexAnswersContext.Provider>
        </LoggerProvider>
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

/** Lets the poll's first timer and the answers it triggers run. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function byTestId(renderer: ReactTestRenderer, id: string) {
  return renderer.root.findAll((node) => node.props["data-testid"] === id && typeof node.type === "string");
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}

function text(renderer: ReactTestRenderer, id: string): string[] {
  return byTestId(renderer, id).map((node) => node.children.join(""));
}

describe("Overview engines", () => {
  test("offers the owner a way to create another engine", async () => {
    const renderer = await render("owner", <OverviewPage />);
    expect(byTestId(renderer, "row-engine-instance-1").length).toBe(1);
    expect(byTestId(renderer, "button-create-engine").map(textOf)).toEqual(["Create another engine"]);
  });

  test("offers an admin no way to create one", async () => {
    const renderer = await render("admin", <OverviewPage />);
    expect(byTestId(renderer, "row-engine-instance-1").length).toBe(1);
    expect(byTestId(renderer, "button-create-engine").length).toBe(0);
  });
});

describe("Team page", () => {
  test("lists each member with the engines they can open and their role on each", async () => {
    const answers = {
      members: [
        {
          ...member("owner-user", "owner"),
          engines: [{ instanceId: "instance-1" as Id<"instances">, name: "Main", role: "owner" as const }],
        },
        {
          ...member("plain-user", "member"),
          engines: [{ instanceId: "instance-1" as Id<"instances">, name: "Main", role: "member" as const }],
        },
      ],
      meId: "owner-user",
    };
    const renderer = await render("owner", <TeamPage />, answers);
    expect(textOf(byTestId(renderer, "engine-access-owner-user-instance-1")[0])).toBe("Main · owner");
    expect(textOf(byTestId(renderer, "engine-access-plain-user-instance-1")[0])).toBe("Main · member");
    expect(byTestId(renderer, "toggle-team-view").length).toBe(0);
  });

  test("an engine's access is changed only for a plain organization member", async () => {
    const answers = {
      members: [
        {
          ...member("admin-user", "admin"),
          engines: [{ instanceId: "instance-1" as Id<"instances">, name: "Main", role: "admin" as const }],
        },
        { ...member("plain-user", "member"), engines: [] },
      ],
      meId: "owner-user",
    };
    const renderer = await render("owner", <TeamPage />, answers);
    expect(byTestId(renderer, "engine-access-admin-user-instance-1")[0].type).not.toBe("button");
    expect(byTestId(renderer, "button-add-engine-plain-user").length).toBe(1);
    expect(byTestId(renderer, "button-add-engine-admin-user").length).toBe(0);
  });

  test("offers inviting someone to an engine", async () => {
    const renderer = await render("owner", <TeamPage />);
    expect(byTestId(renderer, "button-invite-member").length).toBe(1);
  });

  test("the owner sees a masked address until they choose to show it", async () => {
    const answers = { members: [member("owner-user", "owner", "owner@example.com")], meId: "owner-user" };
    const renderer = await render("owner", <TeamPage />, answers);
    expect(byTestId(renderer, "text-member-email").map(textOf)).toEqual([MASKED_EMAIL]);
    const [toggle] = byTestId(renderer, "button-toggle-emails");
    expect(toggle.props["aria-pressed"]).toBe(false);

    await act(async () => {
      toggle.props.onClick();
    });
    expect(text(renderer, "text-member-email")).toEqual(["owner@example.com"]);
  });

  test("hides addresses again on a fresh load", async () => {
    const answers = { members: [member("owner-user", "owner", "owner@example.com")], meId: "owner-user" };
    const first = await render("owner", <TeamPage />, answers);
    await act(async () => {
      byTestId(first, "button-toggle-emails")[0].props.onClick();
    });
    const second = await render("owner", <TeamPage />, answers);
    expect(byTestId(second, "text-member-email").map(textOf)).toEqual([MASKED_EMAIL]);
  });

  test("someone sent no addresses gets no toggle and no email lines", async () => {
    const answers = { members: [member("owner-user", "owner"), member("admin-user", "admin")], meId: "admin-user" };
    const renderer = await render("admin", <TeamPage />, answers);
    expect(byTestId(renderer, "button-toggle-emails").length).toBe(0);
    expect(byTestId(renderer, "text-member-email").length).toBe(0);
  });
});

describe("Overview in the personal scope", () => {
  test("lists every engine the person can open across their organizations, with no create or rename", async () => {
    const renderer = await render(null, <OverviewPage />, undefined, "owner");
    expect(byTestId(renderer, "button-launch-instance-1").length).toBe(1);
    expect(byTestId(renderer, "button-create-engine").length).toBe(0);
    expect(byTestId(renderer, "button-rename-engine-instance-1").length).toBe(0);
    expect(byTestId(renderer, "button-rename-organization").length).toBe(0);
  });
});

describe("Engines", () => {
  test("every engine has a Manage button and no inline rename", async () => {
    for (const role of ["owner", "admin"] as const) {
      const renderer = await render(role, <EnginesPage />);
      expect(byTestId(renderer, "button-manage-instance-1").length).toBe(1);
      expect(byTestId(renderer, "button-rename-engine-instance-1").length).toBe(0);
    }
  });

  test("the version and an available upgrade show on the engine's card", async () => {
    actionAnswers["provisioning:upgradeInfo"] = {
      available: true,
      offered: "v2",
      current: "v1",
      releaseNotesUrl: null,
    };
    const renderer = await render("owner", <EnginesPage />);
    await settle();
    expect(text(renderer, "text-version-instance-1")).toEqual(["v1"]);
    expect(byTestId(renderer, "badge-upgrade-instance-1").length).toBe(1);
  });
});

describe("Engine dashboard", () => {
  async function renderDetail(role: "owner" | "admin", id = "instance-1") {
    actionAnswers["provisioning:upgradeInfo"] = {
      available: true,
      offered: "v2",
      current: "v1",
      releaseNotesUrl: null,
    };
    actionAnswers["resources:hostedStorageUsage"] = {
      usedBytes: 1_000_000_000,
      limitBytes: 5_000_000_000,
      fileLimitBytes: null,
    };
    actionAnswers["moduleStorage:usage"] = { usedBytes: 1_000_000, limitBytes: 10_000_000, over: false };
    const renderer = await render(
      role,
      <Route path="/account/engines/:instanceId">
        <EngineDetailPage />
      </Route>,
      undefined,
      null,
      `/account/engines/${id}`
    );
    await settle();
    return renderer;
  }

  test("shows health, version with the upgrade, limits, people, modules and integrations", async () => {
    const renderer = await renderDetail("owner");
    expect(text(renderer, "text-engine-health")).toEqual(["Healthy"]);
    expect(byTestId(renderer, "badge-engine-upgrade").length).toBe(1);
    expect(byTestId(renderer, "meter-storage").length).toBe(1);
    expect(byTestId(renderer, "meter-module-storage").length).toBe(1);
    expect(byTestId(renderer, "text-engine-seats").length).toBe(1);
    for (const id of ["card-engine-people", "card-engine-modules", "card-engine-integrations"]) {
      expect(byTestId(renderer, id).length).toBe(1);
    }
    expect(byTestId(renderer, "button-rename-engine-instance-1").length).toBe(1);
  });

  test("an admin cannot rename the engine", async () => {
    expect(byTestId(await renderDetail("admin"), "button-rename-engine-instance-1").length).toBe(0);
  });

  test("an engine of another organization goes back to the list", async () => {
    const renderer = await renderDetail("owner", "someone-elses");
    expect(byTestId(renderer, "section-engine-dashboard").length).toBe(0);
  });
});

const SPONSORSHIP: Sponsorship = {
  id: "sp1",
  interval: "month",
  amountCents: 25_000,
  currency: "usd",
  state: "active",
  cancelAtPeriodEnd: false,
  currentPeriodEnd: Date.parse("2026-12-01T12:00:00Z"),
  createdAt: Date.parse("2026-11-01T12:00:00Z"),
  payments: [
    { id: "pay1", amountCents: 25_000, status: "paid", paidAt: Date.parse("2026-11-01T12:00:00Z"), receiptUrl: null },
  ],
};
const ONE_TIME: Sponsorship = {
  ...SPONSORSHIP,
  id: "sp2",
  interval: "once",
  state: "complete",
  currentPeriodEnd: null,
};
const INVOICE: Invoice = {
  id: "in1",
  periodStart: Date.parse("2026-10-01T12:00:00Z"),
  amountCents: 6_000,
  status: "paid",
  hostedUrl: null,
};

const MANAGE_BUTTONS = [
  "button-change-amount-sp1",
  "button-update-payment-method-sp1",
  "button-cancel-sponsorship-sp1",
];

describe("Overview and Sponsorship pages", () => {
  test("the owner sees the organization's engine and a way to launch it, and no plan", async () => {
    const renderer = await render("owner", <OverviewPage />);
    expect(byTestId(renderer, "button-launch-instance-1").length).toBe(1);
    expect(byTestId(renderer, "card-active-plan").length).toBe(0);
  });

  test("the owner's Plans page shows the plan they are on and the choices", async () => {
    const renderer = await render("owner", <PlansPage />);
    expect(byTestId(renderer, "card-active-plan").length).toBe(1);
    expect(byTestId(renderer, "button-choose-starter").length).toBe(1);
    expect(byTestId(renderer, "button-choose-pro").length).toBe(1);
  });

  test("an organization with only self-hosted engines still sees every plan, with nothing to buy", async () => {
    engineHosting = "external";
    const renderer = await render("owner", <PlansPage />);
    expect(byTestId(renderer, "card-plan-starter").length).toBe(1);
    expect(byTestId(renderer, "card-plan-pro").length).toBe(1);
    expect(byTestId(renderer, "button-choose-pro").length).toBe(0);
  });

  test("the plan chooser shows the plane's prices and plan names", async () => {
    const page = JSON.stringify((await render("owner", <PlansPage />)).toJSON());
    expect(page).toContain("$75/mo");
    expect(page).toContain("$150/mo");
    expect(page).not.toContain("price unavailable");
  });

  test("the plan chooser says price unavailable when the plane has no price to give", async () => {
    actionAnswers["prices:list"] = { state: "unavailable", names: { starter: "Starter", pro: "Pro" } };
    const page = JSON.stringify((await render("owner", <PlansPage />)).toJSON());
    expect(page).toContain("price unavailable");
    expect(page).not.toContain("/mo");
  });

  test("only the owner can rename the organization, from the Overview", async () => {
    expect(byTestId(await render("owner", <OverviewPage />), "button-rename-organization").length).toBe(1);
    expect(byTestId(await render("admin", <OverviewPage />), "button-rename-organization").length).toBe(0);
  });

  test.each([["admin" as const], [null]])("%p with no sponsorship sees the pitch alone", async (role) => {
    actionAnswers["sponsorships:mine"] = [];
    const renderer = await render(role, <SponsorshipPage />);
    expect(byTestId(renderer, "card-sponsorship").length).toBe(1);
    expect(byTestId(renderer, "link-become-sponsor")[0].props.href).toBe("/sponsor/start");
  });

  test("a viewer with no organization is offered a streaming engine", async () => {
    actionAnswers["sponsorships:mine"] = [];
    const renderer = await render(null, <OverviewPage />);
    expect(byTestId(renderer, "link-set-up-engine")[0].props.href).toBe("/auth/onboarding");
  });

  test.each([["owner" as const], ["admin" as const]])("%p, in an organization, is not offered one", async (role) => {
    actionAnswers["sponsorships:mine"] = [];
    expect(byTestId(await render(role, <OverviewPage />), "card-create-engine").length).toBe(0);
  });

  test.each([["owner" as const], ["admin" as const], [null]])(
    "%p sees their monthly sponsorship and can manage it",
    async (role) => {
      actionAnswers["sponsorships:mine"] = [SPONSORSHIP];
      const renderer = await render(role, <SponsorshipPage />);
      expect(text(renderer, "text-sponsorship-amount")).toEqual(["$250/mo"]);
      expect(text(renderer, "text-sponsorship-state")).toEqual(["Active"]);
      expect(byTestId(renderer, "link-become-sponsor").length).toBe(0);
      for (const id of MANAGE_BUTTONS) {
        expect(byTestId(renderer, id).length).toBe(1);
      }
    }
  );

  test("a one-time sponsorship has nothing to manage", async () => {
    actionAnswers["sponsorships:mine"] = [{ ...ONE_TIME, id: "sp1" }];
    const renderer = await render(null, <SponsorshipPage />);
    expect(text(renderer, "text-sponsorship-amount")).toEqual(["$250 once"]);
    for (const id of MANAGE_BUTTONS) {
      expect(byTestId(renderer, id).length).toBe(0);
    }
  });

  test("a sponsorship set to end offers no changes", async () => {
    actionAnswers["sponsorships:mine"] = [{ ...SPONSORSHIP, cancelAtPeriodEnd: true }];
    const renderer = await render(null, <SponsorshipPage />);
    expect(JSON.stringify(renderer.toJSON())).toContain("Canceled. Your sponsorship ends on");
    expect(text(renderer, "text-sponsorship-state")[0]).toMatch(/^Ending /);
    for (const id of MANAGE_BUTTONS) {
      expect(byTestId(renderer, id).length).toBe(0);
    }
  });

  test("a failed payment says so and still offers the card update", async () => {
    actionAnswers["sponsorships:mine"] = [{ ...SPONSORSHIP, state: "past_due" }];
    const renderer = await render(null, <SponsorshipPage />);
    expect(JSON.stringify(renderer.toJSON())).toContain("didn't go through");
    expect(byTestId(renderer, "button-update-payment-method-sp1").length).toBe(1);
  });
});

describe("Sponsorship page checkout return", () => {
  test("stays pending while the plane has not completed the checkout", async () => {
    search = "sponsorship=done&sponsorshipCheckout=c1";
    actionAnswers["sponsorships:checkoutState"] = { state: "awaiting_payment" };
    const renderer = await render(null, <SponsorshipPage />);
    await settle();
    expect(text(renderer, "text-sponsorship-done")).toEqual(["Finalizing your payment..."]);
    expect(askedActions).toContain("sponsorships:checkoutState");
  });

  test("confirms only once the plane says complete, then reloads the sponsorships", async () => {
    search = "sponsorship=done&sponsorshipCheckout=c1";
    actionAnswers["sponsorships:checkoutState"] = { state: "complete" };
    const renderer = await render(null, <SponsorshipPage />);
    await settle();
    expect(text(renderer, "text-sponsorship-done")[0]).toContain("Your payment is confirmed");
    expect(askedActions.filter((name) => name === "sponsorships:mine").length).toBeGreaterThan(1);
  });

  test("a return with no checkout id is pending without asking", async () => {
    search = "sponsorship=done";
    const renderer = await render(null, <SponsorshipPage />);
    expect(text(renderer, "text-sponsorship-done")[0]).toContain("being confirmed");
    expect(askedActions).not.toContain("sponsorships:checkoutState");
  });

  test("a return from the card-update page confirms it", async () => {
    search = "sponsorshipPaymentMethod=returned";
    actionAnswers["sponsorships:mine"] = [SPONSORSHIP];
    const renderer = await render(null, <SponsorshipPage />);
    expect(text(renderer, "text-payment-method-updated")).toEqual(["Payment method updated."]);
  });

  test("with no card-update marker there is no confirmation", async () => {
    const renderer = await render(null, <SponsorshipPage />);
    expect(byTestId(renderer, "text-payment-method-updated").length).toBe(0);
  });

  test("a cancelled checkout says nothing was charged", async () => {
    search = "sponsorship=cancelled";
    const renderer = await render(null, <SponsorshipPage />);
    expect(text(renderer, "text-sponsorship-cancelled")).toEqual(["Checkout cancelled. Nothing was charged."]);
  });

  test("the organization's checkout keys do not start a sponsorship return", async () => {
    search = "checkout=done&checkoutId=c1";
    const renderer = await render(null, <SponsorshipPage />);
    expect(byTestId(renderer, "text-sponsorship-done").length).toBe(0);
    expect(askedActions).not.toContain("sponsorships:checkoutState");
  });
});

describe("Payments page", () => {
  test("lists the organization's invoices", async () => {
    actionAnswers["billingCommands:invoices"] = [INVOICE];
    const renderer = await render("owner", <PaymentsPage />);
    expect(JSON.stringify(renderer.toJSON())).toContain("Plan");
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Monthly sponsorship");
    expect(askedActions).not.toContain("sponsorships:mine");
  });

  test("an empty history says so once", async () => {
    actionAnswers["billingCommands:invoices"] = [];
    const renderer = await render("owner", <PaymentsPage />);
    expect(JSON.stringify(renderer.toJSON()).split("No payments yet.").length - 1).toBe(1);
  });

  test("while loading shows neither rows, empty state nor error", async () => {
    actionAnswers["billingCommands:invoices"] = NEVER;
    const renderer = await render("owner", <PaymentsPage />);
    expect(JSON.stringify(renderer.toJSON())).toContain("Loading payments...");
    expect(JSON.stringify(renderer.toJSON())).not.toContain("No payments yet.");
    expect(byTestId(renderer, "text-payments-failed").length).toBe(0);
  });

  test("a failed lookup shows one error and no empty state", async () => {
    actionAnswers["billingCommands:invoices"] = new Error("Billing hit a problem.");
    const renderer = await render("owner", <PaymentsPage />);
    expect(byTestId(renderer, "text-payments-failed").length).toBe(1);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("No payments yet.");
  });

  test("an organization with no billing yet has no invoices and no error", async () => {
    actionAnswers["billingCommands:invoices"] = new ConvexError({ code: "subscription_not_found", message: "m" });
    const renderer = await render("owner", <PaymentsPage />);
    expect(byTestId(renderer, "text-payments-failed").length).toBe(0);
  });
});

describe("Sponsorship payments", () => {
  test("lists the receipts of what the person has paid", async () => {
    actionAnswers["sponsorships:mine"] = [SPONSORSHIP];
    const renderer = await render(null, <SponsorshipPage />);
    await settle();
    expect(byTestId(renderer, "card-sponsorship-payments").length).toBe(1);
  });

  test("a failed lookup shows the error and no pitch", async () => {
    actionAnswers["sponsorships:mine"] = new Error("Billing hit a problem.");
    const renderer = await render(null, <SponsorshipPage />);
    expect(JSON.stringify(renderer.toJSON())).toContain("Billing hit a problem.");
    expect(byTestId(renderer, "link-become-sponsor").length).toBe(0);
  });

  test("while loading shows no pitch", async () => {
    actionAnswers["sponsorships:mine"] = NEVER;
    const renderer = await render(null, <SponsorshipPage />);
    expect(byTestId(renderer, "link-become-sponsor").length).toBe(0);
  });
});

describe("narrow widths", () => {
  test("engines are cards, not a table", async () => {
    const renderer = await render("owner", <OverviewPage />);
    expect(renderer.root.findAll((node) => node.type === "table").length).toBe(0);
  });

  test("member rows stack their controls instead of clipping them in a table", async () => {
    const answers = { members: [member("owner-user", "owner")], meId: "owner-user" };
    const renderer = await render("owner", <TeamPage />, answers);
    const [row] = byTestId(renderer, "row-org-member-owner-user");
    expect(row.props.className).toContain("flex-col");
    expect(renderer.root.findAll((node) => node.type === "table").length).toBe(0);
  });
});
