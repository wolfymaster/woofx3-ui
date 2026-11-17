import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { MyOrganization } from "@convex/organizations";
import { useQuery } from "convex/react";
import {
  Building2,
  Check,
  ChevronDown,
  Loader2,
  Receipt,
  Server,
  Sparkles,
  UserCog,
  Users,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import { Redirect, Route, Switch, useLocation, useSearch } from "wouter";
import type { NavItem } from "@/components/layout/nav-config";
import { SectionMenu } from "@/components/layout/section-menu";
import { SectionSidebar } from "@/components/layout/section-sidebar";
import { ThemeMenuSub } from "@/components/layout/theme-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthActions, useConvexUser } from "@/hooks/use-convex-auth";
import { useInstance } from "@/hooks/use-instance";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { BackToDashboard } from "./back-to-dashboard";
import { OrganizationProvider, useOptionalOrganization, useOrganization } from "./organization-context";
import { organizationLabels } from "./organization-labels";
import EnginesPage from "./pages/engines";
import PaymentsPage from "./pages/payments";
import PeoplePage from "./pages/people";
import PlanPage from "./pages/plan";
import SettingsPage from "./pages/settings";
import TeamPage from "./pages/team";
import TeamInvitePage, { TEAM_INVITE_PATH } from "./pages/team-invite";
import { ACCOUNT_PORTAL_PATH, PORTAL_PAGES, type PortalPageId, portalPage, visiblePages } from "./portal-pages";
import { resumesOnboarding, START_TRIAL_PATH, startsTrial } from "./start-trial";

const PAGES: Record<PortalPageId, () => React.ReactElement> = {
  plan: PlanPage,
  payments: PaymentsPage,
  people: PeoplePage,
  engines: EnginesPage,
  settings: SettingsPage,
  team: TeamPage,
};

/** The org the selected engine belongs to, else the one the caller owns, else the first. */
function defaultOrganization(organizations: MyOrganization[], engineAccountId: Id<"accounts"> | undefined) {
  return (
    organizations.find((org) => org.accountId === engineAccountId) ??
    organizations.find((org) => org.role === "owner") ??
    organizations[0]
  );
}

function OrganizationSwitcher() {
  const { organization, organizations, select } = useOrganization();
  const labels = organizationLabels(organizations);
  const labelOf = (org: MyOrganization) => labels.get(org.accountId) ?? org.name;
  if (organizations.length < 2) {
    return <span className="font-medium truncate">{organization.name}</span>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 font-medium" data-testid="button-switch-organization">
          <span className="truncate">{labelOf(organization)}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.accountId}
            onClick={() => select(org.accountId)}
            className="flex items-center justify-between"
          >
            <span className="truncate">{labelOf(org)}</span>
            {org.accountId === organization.accountId && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const PAGE_ICONS: Record<PortalPageId, NavItem["icon"]> = {
  plan: Sparkles,
  payments: Receipt,
  people: Users,
  engines: Server,
  settings: UserCog,
  team: UsersRound,
};

function PortalHeader({ nav, location }: { nav: NavItem[]; location: string }) {
  const organization = useOptionalOrganization()?.organization ?? null;
  const { instance } = useInstance();
  const { user } = useConvexUser();
  const { signOut } = useAuthActions();
  const displayName = user?.name || "User";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <header className="h-14 bg-card border-b border-border flex items-center px-4 gap-3 shrink-0">
      <SectionMenu title="Account" items={nav} location={location} />
      <span className="font-semibold tracking-tight">woofx3</span>
      <div className="flex items-center gap-1 text-sm min-w-0 flex-1">
        {organization === null ? null : (
          <>
            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground shrink-0">Organization:</span>
            <OrganizationSwitcher />
          </>
        )}
      </div>
      <BackToDashboard hasEngine={Boolean(instance)} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-9 w-9 rounded-full p-0" data-testid="button-user-menu">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user?.image} />
              <AvatarFallback className="bg-muted text-muted-foreground text-xs font-medium">{initials}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium">{displayName}</p>
              <p className="text-xs text-muted-foreground">{user?.email || ""}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <ThemeMenuSub />
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => signOut()} className="text-destructive focus:text-destructive">
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

/** The dashboard's frame (header, section rail, scrolling content) with the portal's pages as the section. */
function PortalLayout({ children }: { children: React.ReactNode }) {
  const organization = useOptionalOrganization()?.organization ?? null;
  const [location] = useLocation();
  const nav: NavItem[] = visiblePages(organization?.can ?? null).map((page) => ({
    id: `account-${page.id}`,
    label: page.label,
    icon: PAGE_ICONS[page.id],
    href: page.path,
    exact: page.path === ACCOUNT_PORTAL_PATH,
  }));
  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-background">
      <PortalHeader nav={nav} location={location} />
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <SectionSidebar title="Account" items={nav} location={location} />
        <main className="flex-1 overflow-auto">
          <div
            key={location}
            className="p-6 lg:p-8 max-w-[1100px] mx-auto animate-in fade-in duration-200 motion-reduce:animate-none"
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

/** A page the viewer's role can't see sends them to the index, which every signed-in user can see. */
function PortalPageRoute({ id }: { id: PortalPageId }) {
  const organization = useOptionalOrganization()?.organization ?? null;
  const page = portalPage(id);
  if (!visiblePages(organization?.can ?? null).includes(page)) {
    return <Redirect to={ACCOUNT_PORTAL_PATH} replace />;
  }
  const Page = PAGES[id];
  return <Page />;
}

/**
 * The account portal at `/account/*`, keyed to the signed-in person, with or without an organization: a slim layout of its own,
 * outside the dashboard shell, on the dashboard's origin so it shares the
 * session. The web build only; App.tsx never registers it in the desktop app.
 */
export default function AccountPortal() {
  const now = useMinuteClock();
  const organizations = useQuery(api.organizations.mine, { now });
  const { instance } = useInstance();
  const search = useSearch();
  const [selectedId, setSelectedId] = useState<Id<"accounts"> | null>(null);

  if (organizations === undefined) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (startsTrial(search, organizations)) {
    return <Redirect to={START_TRIAL_PATH} replace />;
  }
  if (resumesOnboarding(search, organizations)) {
    return <Redirect to={`${START_TRIAL_PATH}?${new URLSearchParams(search)}`} replace />;
  }
  const organization =
    organizations.find((org) => org.accountId === selectedId) ??
    defaultOrganization(organizations, instance?.accountId);

  const pages = (
    <PortalLayout>
      <Switch>
        {PORTAL_PAGES.map((page) => (
          <Route key={page.id} path={page.path}>
            <PortalPageRoute id={page.id} />
          </Route>
        ))}
        <Route path={TEAM_INVITE_PATH} component={TeamInvitePage} />
        <Route>
          <p className="text-muted-foreground">There&apos;s no such page in the account portal.</p>
        </Route>
      </Switch>
    </PortalLayout>
  );
  if (organization === undefined) {
    return pages;
  }
  return (
    <OrganizationProvider value={{ organization, organizations, select: setSelectedId }}>{pages}</OrganizationProvider>
  );
}
