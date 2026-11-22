import { api } from "@convex/_generated/api";
import type { MyOrganization } from "@convex/organizations";
import { useQuery } from "convex/react";
import {
  Building2,
  Check,
  ChevronDown,
  Heart,
  LayoutDashboard,
  Loader2,
  Receipt,
  Server,
  Sparkles,
  User,
  UserCog,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import { Link, Redirect, Route, Switch, useLocation, useSearch } from "wouter";
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
import { BackToDashboard } from "./back-to-dashboard";
import {
  OrganizationProvider,
  PortalScopeProvider,
  useOptionalOrganization,
  useOptionalPortalScope,
  usePortalScope,
} from "./organization-context";
import { organizationLabels } from "./organization-labels";
import EngineDetailPage from "./pages/engine-detail";
import EnginesPage from "./pages/engines";
import OverviewPage from "./pages/overview";
import PaymentsPage from "./pages/payments";
import PlansPage from "./pages/plans";
import SettingsPage from "./pages/settings";
import SponsorshipPage from "./pages/sponsorship";
import TeamPage from "./pages/team";
import TeamInvitePage, { TEAM_INVITE_PATH } from "./pages/team-invite";
import {
  ACCOUNT_PORTAL_PATH,
  ENGINES_PATH,
  PORTAL_PAGES,
  type PortalPage,
  type PortalPageId,
  portalPage,
  visiblePages,
} from "./portal-pages";
import { PERSONAL_SCOPE, type PortalScope, resolveScope } from "./portal-scope";
import { resumesOnboarding, START_TRIAL_PATH, startsTrial } from "./start-trial";

const PAGES: Record<PortalPageId, () => React.ReactElement> = {
  overview: OverviewPage,
  engines: EnginesPage,
  sponsorship: SponsorshipPage,
  payments: PaymentsPage,
  settings: SettingsPage,
  team: TeamPage,
  plans: PlansPage,
};

/** Top-left switch between the person's own account and each organization they belong to. */
function ScopeSwitcher() {
  const portal = useOptionalPortalScope();
  const { user } = useConvexUser();
  if (portal === null) {
    return null;
  }
  const { scope, organizations, selectScope } = portal;
  const labels = organizationLabels(organizations);
  const labelOf = (org: MyOrganization) => labels.get(org.accountId) ?? org.name;
  const current =
    scope.kind === "organization" ? organizations.find((org) => org.accountId === scope.accountId) : undefined;
  const currentLabel = current === undefined ? "Personal" : labelOf(current);
  const CurrentIcon = current === undefined ? User : Building2;
  if (organizations.length === 0) {
    return (
      <span className="flex items-center gap-1.5 text-sm font-medium" data-testid="text-portal-scope">
        <CurrentIcon className="h-4 w-4 text-muted-foreground" />
        {currentLabel}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 font-medium" data-testid="button-switch-scope">
          <CurrentIcon className="h-4 w-4 text-muted-foreground" />
          <span className="truncate">{currentLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuItem
          onClick={() => selectScope(PERSONAL_SCOPE)}
          className="flex items-center justify-between"
          data-testid="item-scope-personal"
        >
          <span className="flex items-center gap-2 min-w-0">
            <User className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="truncate">{user?.name || "Personal"}</span>
          </span>
          {scope.kind === "personal" && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Organizations</DropdownMenuLabel>
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.accountId}
            onClick={() => selectScope({ kind: "organization", accountId: org.accountId })}
            className="flex items-center justify-between"
            data-testid={`item-scope-${org.accountId}`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">{labelOf(org)}</span>
            </span>
            {current?.accountId === org.accountId && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const PAGE_ICONS: Record<PortalPageId, NavItem["icon"]> = {
  overview: LayoutDashboard,
  engines: Server,
  sponsorship: Heart,
  payments: Receipt,
  settings: UserCog,
  team: UsersRound,
  plans: Sparkles,
};

function PortalHeader({ nav, location }: { nav: NavItem[]; location: string }) {
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
      <div className="flex items-center min-w-0 flex-1">
        <ScopeSwitcher />
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

function navItemOf(page: PortalPage): NavItem {
  return {
    id: `account-${page.id}`,
    label: page.label,
    icon: PAGE_ICONS[page.id],
    href: page.path,
    exact: page.path === ACCOUNT_PORTAL_PATH,
    docked: page.docked,
  };
}

/** The dashboard's frame (header, section rail, scrolling content) with the portal's pages as the section. */
function PortalLayout({ children }: { children: React.ReactNode }) {
  const organization = useOptionalOrganization()?.organization ?? null;
  const { scope } = usePortalScope();
  const [location] = useLocation();
  const nav = visiblePages(scope.kind, organization?.can ?? null).map(navItemOf);
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
  const { scope } = usePortalScope();
  const page = portalPage(id);
  if (!visiblePages(scope.kind, organization?.can ?? null).includes(page)) {
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
  const organizations = useQuery(api.organizations.mine, {});
  const { instance } = useInstance();
  const search = useSearch();
  const [picked, setPicked] = useState<PortalScope | null>(null);

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
  const scope = resolveScope(organizations, picked, instance?.accountId);
  const organization =
    scope.kind === "organization" ? organizations.find((org) => org.accountId === scope.accountId) : undefined;

  const pages = (
    <PortalLayout>
      <Switch>
        {PORTAL_PAGES.map((page) => (
          <Route key={page.id} path={page.path}>
            <PortalPageRoute id={page.id} />
          </Route>
        ))}
        <Route path={TEAM_INVITE_PATH} component={TeamInvitePage} />
        <Route path={`${ENGINES_PATH}/:instanceId`} component={EngineDetailPage} />
        <Route>
          <p className="text-muted-foreground">
            We couldn&apos;t find that page.{" "}
            <Link href={ACCOUNT_PORTAL_PATH} className="underline underline-offset-2">
              Back to overview
            </Link>
          </p>
        </Route>
      </Switch>
    </PortalLayout>
  );
  return (
    <PortalScopeProvider value={{ scope, organizations, selectScope: setPicked }}>
      {organization === undefined ? (
        pages
      ) : (
        <OrganizationProvider value={{ organization, organizations }}>{pages}</OrganizationProvider>
      )}
    </PortalScopeProvider>
  );
}
