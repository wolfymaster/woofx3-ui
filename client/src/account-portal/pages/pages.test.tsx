import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Id } from "@convex/_generated/dataModel";
import type { Invoice, Sponsorship } from "@convex/lib/billingClient";
import type { OrgMember } from "@convex/organizations";
import { getFunctionName } from "convex/server";
import { createContext, type ReactNode, useContext } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { MASKED_EMAIL } from "@/components/team/member-emails";
import { OrganizationProvider, type OrganizationSelection } from "../organization-context";

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

const { default: EnginesPage } = await import("./engines");
const { default: PeoplePage } = await import("./people");
const { default: PaymentsPage } = await import("./payments");
const { default: PlanPage } = await import("./plan");

const ACCOUNT_ID = "account-1" as Id<"accounts">;

beforeEach(() => {
  search = "";
  actionAnswers = {};
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
      viewMemberEmails: owner,
      manageEngines: true,
      renameEngine: owner,
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
  answers: ConvexAnswers = { members: null, meId: "owner-user" }
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  const memory = memoryLocation({ path: "/account" });
  await act(async () => {
    renderer = create(
      <Router hook={memory.hook} searchHook={useTestSearch}>
        <ConvexAnswersContext.Provider value={answers}>
          {role === null ? page : <OrganizationProvider value={selection(role)}>{page}</OrganizationProvider>}
        </ConvexAnswersContext.Provider>
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

describe("Engines page", () => {
  test("offers the owner a way to create another engine", async () => {
    const renderer = await render("owner", <EnginesPage />);
    expect(byTestId(renderer, "row-engine-instance-1").length).toBe(1);
    expect(byTestId(renderer, "button-create-engine").map(textOf)).toEqual(["Create another engine"]);
  });

  test("offers an admin no way to create one", async () => {
    const renderer = await render("admin", <EnginesPage />);
    expect(byTestId(renderer, "row-engine-instance-1").length).toBe(1);
    expect(byTestId(renderer, "button-create-engine").length).toBe(0);
  });
});

describe("People page", () => {
  test("the owner sees a masked address until they choose to show it", async () => {
    const answers = { members: [member("owner-user", "owner", "owner@example.com")], meId: "owner-user" };
    const renderer = await render("owner", <PeoplePage />, answers);
    expect(byTestId(renderer, "text-member-email").map(textOf)).toEqual([MASKED_EMAIL]);
    const [toggle] = byTestId(renderer, "button-toggle-emails");
    expect(toggle.props["aria-pressed"]).toBe(false);
    expect(textOf(toggle)).toContain("Show emails");

    await act(async () => {
      toggle.props.onClick();
    });
    const [pressed] = byTestId(renderer, "button-toggle-emails");
    expect(pressed.props["aria-pressed"]).toBe(true);
    expect(textOf(pressed)).toContain("Show emails");
    expect(text(renderer, "text-member-email")).toEqual(["owner@example.com"]);
  });

  test("hides addresses again on a fresh load", async () => {
    const answers = { members: [member("owner-user", "owner", "owner@example.com")], meId: "owner-user" };
    const first = await render("owner", <PeoplePage />, answers);
    await act(async () => {
      byTestId(first, "button-toggle-emails")[0].props.onClick();
    });
    const second = await render("owner", <PeoplePage />, answers);
    expect(byTestId(second, "text-member-email").map(textOf)).toEqual([MASKED_EMAIL]);
  });

  test("someone sent no addresses gets no toggle and no email lines", async () => {
    const answers = { members: [member("owner-user", "owner"), member("admin-user", "admin")], meId: "admin-user" };
    const renderer = await render("admin", <PeoplePage />, answers);
    const [row] = byTestId(renderer, "row-org-member-admin-user");
    expect(textOf(row)).not.toContain("—");
    expect(byTestId(renderer, "button-toggle-emails").length).toBe(0);
    expect(byTestId(renderer, "text-member-email").length).toBe(0);
  });
});

describe("Engines page rename", () => {
  test("only the owner sees the rename control", async () => {
    expect(byTestId(await render("owner", <EnginesPage />), "button-rename-engine-instance-1").length).toBe(1);
    expect(byTestId(await render("admin", <EnginesPage />), "button-rename-engine-instance-1").length).toBe(0);
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

describe("Plan page", () => {
  test("the owner sees the organization's subscription and the sponsorship card", async () => {
    const renderer = await render("owner", <PlanPage />);
    expect(JSON.stringify(renderer.toJSON())).toContain("Subscription");
    expect(byTestId(renderer, "card-sponsorship").length).toBe(1);
  });

  test("only the owner's header has the rename control", async () => {
    expect(byTestId(await render("owner", <PlanPage />), "button-rename-organization").length).toBe(1);
    expect(byTestId(await render("admin", <PlanPage />), "button-rename-organization").length).toBe(0);
  });

  test.each([["admin" as const], [null]])("%p with no sponsorship sees the pitch alone", async (role) => {
    actionAnswers["sponsorships:mine"] = [];
    const renderer = await render(role, <PlanPage />);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Subscription");
    expect(byTestId(renderer, "card-sponsorship").length).toBe(1);
    expect(byTestId(renderer, "link-become-sponsor")[0].props.href).toBe("/sponsor/start");
  });

  test.each([["owner" as const], ["admin" as const], [null]])(
    "%p sees their monthly sponsorship and can manage it",
    async (role) => {
      actionAnswers["sponsorships:mine"] = [SPONSORSHIP];
      const renderer = await render(role, <PlanPage />);
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
    const renderer = await render(null, <PlanPage />);
    expect(text(renderer, "text-sponsorship-amount")).toEqual(["$250 once"]);
    for (const id of MANAGE_BUTTONS) {
      expect(byTestId(renderer, id).length).toBe(0);
    }
  });

  test("a sponsorship set to end offers no changes", async () => {
    actionAnswers["sponsorships:mine"] = [{ ...SPONSORSHIP, cancelAtPeriodEnd: true }];
    const renderer = await render(null, <PlanPage />);
    expect(JSON.stringify(renderer.toJSON())).toContain("Canceled. Your sponsorship ends on");
    for (const id of MANAGE_BUTTONS) {
      expect(byTestId(renderer, id).length).toBe(0);
    }
  });

  test("a failed payment says so and still offers the card update", async () => {
    actionAnswers["sponsorships:mine"] = [{ ...SPONSORSHIP, state: "past_due" }];
    const renderer = await render(null, <PlanPage />);
    expect(JSON.stringify(renderer.toJSON())).toContain("didn't go through");
    expect(byTestId(renderer, "button-update-payment-method-sp1").length).toBe(1);
  });
});

describe("Plan page checkout return", () => {
  test("stays pending while the plane has not completed the checkout", async () => {
    search = "sponsorship=done&sponsorshipCheckout=c1";
    actionAnswers["sponsorships:checkoutState"] = { state: "awaiting_payment" };
    const renderer = await render(null, <PlanPage />);
    await settle();
    expect(text(renderer, "text-sponsorship-done")).toEqual(["Finalizing your payment..."]);
    expect(askedActions).toContain("sponsorships:checkoutState");
  });

  test("confirms only once the plane says complete, then reloads the sponsorships", async () => {
    search = "sponsorship=done&sponsorshipCheckout=c1";
    actionAnswers["sponsorships:checkoutState"] = { state: "complete" };
    const renderer = await render(null, <PlanPage />);
    await settle();
    expect(text(renderer, "text-sponsorship-done")[0]).toContain("Your payment is confirmed");
    expect(askedActions.filter((name) => name === "sponsorships:mine").length).toBeGreaterThan(1);
  });

  test("a return with no checkout id is pending without asking", async () => {
    search = "sponsorship=done";
    const renderer = await render(null, <PlanPage />);
    expect(text(renderer, "text-sponsorship-done")[0]).toContain("being confirmed");
    expect(askedActions).not.toContain("sponsorships:checkoutState");
  });

  test("a cancelled checkout says nothing was charged", async () => {
    search = "sponsorship=cancelled";
    const renderer = await render(null, <PlanPage />);
    expect(text(renderer, "text-sponsorship-cancelled")).toEqual(["Checkout cancelled. Nothing was charged."]);
  });

  test("the organization's checkout keys do not start a sponsorship return", async () => {
    search = "checkout=done&checkoutId=c1";
    const renderer = await render(null, <PlanPage />);
    expect(byTestId(renderer, "text-sponsorship-done").length).toBe(0);
    expect(askedActions).not.toContain("sponsorships:checkoutState");
  });
});

describe("Payments page", () => {
  test("the owner with both kinds sees one history and the filter", async () => {
    actionAnswers["billingCommands:invoices"] = [INVOICE];
    actionAnswers["sponsorships:mine"] = [SPONSORSHIP];
    const renderer = await render("owner", <PaymentsPage />);
    expect(byTestId(renderer, "filter-payments").length).toBeGreaterThan(0);
    expect(JSON.stringify(renderer.toJSON())).toContain("Monthly sponsorship");
    expect(JSON.stringify(renderer.toJSON())).toContain("Plan");
  });

  test("the owner with invoices alone gets no filter", async () => {
    actionAnswers["billingCommands:invoices"] = [INVOICE];
    actionAnswers["sponsorships:mine"] = [];
    const renderer = await render("owner", <PaymentsPage />);
    expect(byTestId(renderer, "filter-payments").length).toBe(0);
  });

  test.each([["admin" as const], [null]])("%p sees sponsor rows alone and never asks for invoices", async (role) => {
    actionAnswers["billingCommands:invoices"] = [INVOICE];
    actionAnswers["sponsorships:mine"] = [SPONSORSHIP];
    const renderer = await render(role, <PaymentsPage />);
    expect(askedActions).not.toContain("billingCommands:invoices");
    expect(byTestId(renderer, "filter-payments").length).toBe(0);
    expect(JSON.stringify(renderer.toJSON())).toContain("Monthly sponsorship");
  });

  test("with no payments of either kind, offers to sponsor", async () => {
    const renderer = await render(null, <PaymentsPage />);
    expect(JSON.stringify(renderer.toJSON())).toContain("No payments yet.");
    expect(byTestId(renderer, "link-become-sponsor")[0].props.href).toBe("/sponsor/start");
  });
});

describe("when a billing lookup fails", () => {
  const failed = new Error("Billing hit a problem.");

  test.each([["owner" as const], ["admin" as const], [null]])(
    "%p's Payments shows one error and no empty state",
    async (role) => {
      actionAnswers["sponsorships:mine"] = failed;
      actionAnswers["billingCommands:invoices"] = failed;
      const renderer = await render(role, <PaymentsPage />);
      expect(byTestId(renderer, "text-payments-failed").length).toBe(1);
      expect(JSON.stringify(renderer.toJSON())).not.toContain("No payments yet.");
      expect(byTestId(renderer, "link-become-sponsor").length).toBe(0);
    }
  );

  test("an owner whose invoices fail but whose sponsorships load sees the error and the loaded rows", async () => {
    actionAnswers["billingCommands:invoices"] = failed;
    actionAnswers["sponsorships:mine"] = [SPONSORSHIP];
    const renderer = await render("owner", <PaymentsPage />);
    expect(byTestId(renderer, "text-payments-failed").length).toBe(1);
    expect(JSON.stringify(renderer.toJSON())).toContain("Monthly sponsorship");
  });

  test.each([["owner" as const], [null]])("%p's Plan shows the error or the pitch, never both", async (role) => {
    actionAnswers["sponsorships:mine"] = failed;
    const renderer = await render(role, <PlanPage />);
    expect(JSON.stringify(renderer.toJSON())).toContain("Billing hit a problem.");
    expect(byTestId(renderer, "link-become-sponsor").length).toBe(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("aren't sponsoring");
  });
});

describe("loading, empty and loaded states", () => {
  test.each([["owner" as const], [null]])(
    "%p's Payments while loading shows neither rows, empty state nor error",
    async (role) => {
      actionAnswers["sponsorships:mine"] = NEVER;
      actionAnswers["billingCommands:invoices"] = NEVER;
      const renderer = await render(role, <PaymentsPage />);
      expect(JSON.stringify(renderer.toJSON())).toContain("Loading payments...");
      expect(JSON.stringify(renderer.toJSON())).not.toContain("No payments yet.");
      expect(byTestId(renderer, "text-payments-failed").length).toBe(0);
    }
  );

  test.each([["owner" as const], [null]])("%p's Plan while loading shows no pitch", async (role) => {
    actionAnswers["sponsorships:mine"] = NEVER;
    const renderer = await render(role, <PlanPage />);
    expect(byTestId(renderer, "link-become-sponsor").length).toBe(0);
  });

  test.each([["owner" as const], [null]])("%p's empty Payments says so once", async (role) => {
    actionAnswers["billingCommands:invoices"] = [];
    const renderer = await render(role, <PaymentsPage />);
    expect(JSON.stringify(renderer.toJSON()).split("No payments yet.").length - 1).toBe(1);
    expect(byTestId(renderer, "text-payments-failed").length).toBe(0);
  });
});

describe("narrow widths", () => {
  test("engine rows stack their actions instead of clipping them in a table", async () => {
    const renderer = await render("owner", <EnginesPage />);
    const [row] = byTestId(renderer, "row-engine-instance-1");
    expect(row.props.className).toContain("flex-col");
    expect(renderer.root.findAll((node) => node.type === "table").length).toBe(0);
  });

  test("member rows stack their controls instead of clipping them in a table", async () => {
    const answers = { members: [member("owner-user", "owner")], meId: "owner-user" };
    const renderer = await render("owner", <PeoplePage />, answers);
    const [row] = byTestId(renderer, "row-org-member-owner-user");
    expect(row.props.className).toContain("flex-col");
    expect(renderer.root.findAll((node) => node.type === "table").length).toBe(0);
  });
});
