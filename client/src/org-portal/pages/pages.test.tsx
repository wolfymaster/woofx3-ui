import { describe, expect, mock, test } from "bun:test";
import type { Id } from "@convex/_generated/dataModel";
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
const convexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...convexReact,
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => async () => null,
  useQuery: (query: Parameters<typeof getFunctionName>[0]) => {
    const answers = useContext(ConvexAnswersContext);
    const name = getFunctionName(query);
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

const { default: EnginesPage } = await import("./engines");
const { default: MembersPage } = await import("./members");

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
      viewMemberEmails: owner,
      manageEngines: true,
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
  role: "owner" | "admin",
  page: ReactNode,
  answers: ConvexAnswers = { members: null, meId: "owner-user" }
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <Router hook={memoryLocation({ path: "/org" }).hook}>
        <ConvexAnswersContext.Provider value={answers}>
          <OrganizationProvider value={selection(role)}>{page}</OrganizationProvider>
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
  test("offers no way to create another engine, even to the owner", async () => {
    const renderer = await render("owner", <EnginesPage />);
    expect(byTestId(renderer, "row-engine-instance-1").length).toBe(1);
    expect(byTestId(renderer, "button-create-engine").length).toBe(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Create another engine");
  });
});

describe("Members page", () => {
  test("the owner sees a masked address until they choose to show it", async () => {
    const answers = { members: [member("owner-user", "owner", "owner@example.com")], meId: "owner-user" };
    const renderer = await render("owner", <MembersPage />, answers);
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
    const first = await render("owner", <MembersPage />, answers);
    await act(async () => {
      byTestId(first, "button-toggle-emails")[0].props.onClick();
    });
    const second = await render("owner", <MembersPage />, answers);
    expect(byTestId(second, "text-member-email").map(textOf)).toEqual([MASKED_EMAIL]);
  });

  test("someone sent no addresses gets no toggle and no email lines", async () => {
    const answers = { members: [member("owner-user", "owner"), member("admin-user", "admin")], meId: "admin-user" };
    const renderer = await render("admin", <MembersPage />, answers);
    const [row] = byTestId(renderer, "row-org-member-admin-user");
    expect(textOf(row)).not.toContain("—");
    expect(byTestId(renderer, "button-toggle-emails").length).toBe(0);
    expect(byTestId(renderer, "text-member-email").length).toBe(0);
  });
});
