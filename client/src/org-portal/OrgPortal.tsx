import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { MyOrganization } from "@convex/organizations";
import { useQuery } from "convex/react";
import { ArrowLeft, Building2, Check, ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, Redirect, Route, Switch, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useInstance } from "@/hooks/use-instance";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { cn } from "@/lib/utils";
import { OrganizationProvider, useOrganization } from "./organization-context";
import EnginesPage from "./pages/engines";
import PaymentsPage from "./pages/payments";
import PeoplePage from "./pages/people";
import PlanPage from "./pages/plan";
import {
  isActivePage,
  ORG_PORTAL_PATH,
  PORTAL_PAGES,
  type PortalPageId,
  portalPage,
  visiblePages,
} from "./portal-pages";
import { START_TRIAL_PATH, startsTrial } from "./start-trial";

const PAGES: Record<PortalPageId, () => React.ReactElement> = {
  plan: PlanPage,
  payments: PaymentsPage,
  people: PeoplePage,
  engines: EnginesPage,
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
  if (organizations.length < 2) {
    return <span className="font-medium truncate">{organization.name}</span>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 font-medium" data-testid="button-switch-organization">
          <span className="truncate">{organization.name}</span>
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
            <span className="truncate">{org.name}</span>
            {org.accountId === organization.accountId && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PortalLayout({ children }: { children: React.ReactNode }) {
  const { organization } = useOrganization();
  const [location] = useLocation();
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="flex h-14 items-center gap-3 px-4">
          <span className="font-semibold tracking-tight">woofx3</span>
          <div className="flex items-center gap-1 text-sm min-w-0 flex-1">
            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground shrink-0">Organization:</span>
            <OrganizationSwitcher />
          </div>
          <Button variant="outline" size="sm" asChild data-testid="link-back-to-dashboard">
            <Link href="/">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to dashboard
            </Link>
          </Button>
        </div>
        <nav className="px-4 pb-3" aria-label="Organization portal">
          <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
            {visiblePages(organization.can).map((page) => {
              const active = isActivePage(location, page.path);
              return (
                <Link
                  key={page.id}
                  href={page.path}
                  className={cn(
                    "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors",
                    active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid={`nav-org-${page.id}`}
                >
                  {page.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>
      <main
        key={location}
        className="p-6 lg:p-8 max-w-[1100px] mx-auto animate-in fade-in duration-200 motion-reduce:animate-none"
      >
        {children}
      </main>
    </div>
  );
}

/** A page whose action the caller's role lacks: it isn't in their nav, and its data answers null. */
function PortalPageRoute({ id }: { id: PortalPageId }) {
  const { organization } = useOrganization();
  const page = portalPage(id);
  if (!organization.can[page.visibleWith]) {
    return <p className="text-muted-foreground">Your role in this organization doesn&apos;t include {page.label}.</p>;
  }
  const Page = PAGES[id];
  return <Page />;
}

function NoOrganization() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="text-center space-y-4 max-w-sm">
        <h1 className="text-xl font-semibold">You aren&apos;t in an organization yet</h1>
        <p className="text-muted-foreground">Create your engine and an organization comes with it.</p>
        <Button asChild>
          <Link href="/auth/onboarding">Create your engine</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * The organization and billing portal at `/org/*`: a slim layout of its own,
 * outside the dashboard shell, on the dashboard's origin so it shares the
 * session. The web build only; App.tsx never registers it in the desktop app.
 */
export default function OrgPortal() {
  const now = useMinuteClock();
  const organizations = useQuery(api.organizations.mine, { now });
  const { instance } = useInstance();
  const [location] = useLocation();
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
  const organization =
    organizations.find((org) => org.accountId === selectedId) ??
    defaultOrganization(organizations, instance?.accountId);
  if (organization === undefined) {
    return <NoOrganization />;
  }

  // The index is the Plan tab, which a member can't see; send them to their first tab instead.
  const firstPage = visiblePages(organization.can)[0];
  if (location === ORG_PORTAL_PATH && firstPage !== undefined && firstPage.path !== ORG_PORTAL_PATH) {
    return <Redirect to={firstPage.path} replace />;
  }

  return (
    <OrganizationProvider value={{ organization, organizations, select: setSelectedId }}>
      <PortalLayout>
        <Switch>
          {/* Old paths, kept working for billing banners, emails and bookmarks. */}
          <Route path={`${ORG_PORTAL_PATH}/billing`}>
            <Redirect to={ORG_PORTAL_PATH} replace />
          </Route>
          <Route path={`${ORG_PORTAL_PATH}/invoices`}>
            <Redirect to={`${ORG_PORTAL_PATH}/payments`} replace />
          </Route>
          <Route path={`${ORG_PORTAL_PATH}/members`}>
            <Redirect to={`${ORG_PORTAL_PATH}/people`} replace />
          </Route>
          {PORTAL_PAGES.map((page) => (
            <Route key={page.id} path={page.path}>
              <PortalPageRoute id={page.id} />
            </Route>
          ))}
          <Route>
            <p className="text-muted-foreground">There&apos;s no such page in the organization portal.</p>
          </Route>
        </Switch>
      </PortalLayout>
    </OrganizationProvider>
  );
}
