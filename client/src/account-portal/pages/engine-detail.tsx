import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatStorageBytes } from "@convex/lib/hostedStorage";
import type { OrgEngine } from "@convex/organizations";
import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowLeft, Boxes, HeartPulse, Server, Users } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, Redirect, useParams } from "wouter";
import { formatSeats } from "@/billing/format";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { toast } from "@/hooks/use-toast";
import { actionErrorMessage } from "@/lib/action-error";
import { useLogger } from "@/lib/logger-context";
import { $currentInstanceId } from "@/lib/stores";
import { cn } from "@/lib/utils";
import { type EngineHealth, engineHealth, type HealthTone, TONE_CLASS } from "../engine-health";
import { isUnsettled, visibleModules } from "../engine-modules";
import { formatAgo } from "../format-ago";
import { useOrganization } from "../organization-context";
import { ENGINES_PATH } from "../portal-pages";
import { RenameDialog } from "../rename-dialog";
import { useEngineUpgrade } from "../use-engine-upgrade";

/** A search box only helps once the list is long enough to scan by eye no longer. */
const MODULES_SEARCHABLE_FROM = 8;

function Stat({
  icon,
  label,
  value,
  detail,
  tone,
  testId,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: ReactNode;
  tone?: HealthTone;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="space-y-1 pt-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {icon}
          {label}
        </div>
        <p className={cn("text-2xl font-semibold tracking-tight", tone && TONE_CLASS[tone])}>{value}</p>
        {detail ? <div className="text-sm text-muted-foreground">{detail}</div> : null}
      </CardContent>
    </Card>
  );
}

function Meter({
  label,
  usedBytes,
  limitBytes,
  testId,
}: {
  label: string;
  usedBytes: number;
  limitBytes: number | null;
  testId: string;
}) {
  const percent = limitBytes === null ? 0 : limitBytes === 0 ? 100 : Math.min(100, (usedBytes / limitBytes) * 100);
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {formatStorageBytes(usedBytes)}{" "}
          {limitBytes === null ? "used, no limit" : `of ${formatStorageBytes(limitBytes)}`}
        </span>
      </div>
      {limitBytes === null ? null : <Progress value={percent} aria-label={`${label} used`} />}
    </div>
  );
}

/** Storage and module storage read from the engine; each shows nothing for an engine that has no limit to report. */
function Limits({ instanceId, hosted }: { instanceId: Id<"instances">; hosted: boolean }) {
  const { organization } = useOrganization();
  const hostedStorageUsage = useAction(api.resources.hostedStorageUsage);
  const moduleStorageUsage = useAction(api.moduleStorage.usage);
  const logger = useLogger();
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof hostedStorageUsage>> | undefined>(undefined);
  const [moduleStorage, setModuleStorage] = useState<Awaited<ReturnType<typeof moduleStorageUsage>> | undefined>(
    undefined
  );
  useEffect(() => {
    if (!hosted) {
      return;
    }
    let current = true;
    hostedStorageUsage({ instanceId }).then(
      (usage) => current && setStorage(usage),
      (error: unknown) => logger.warn("Could not read the engine's storage", { error, instanceId })
    );
    moduleStorageUsage({ instanceId }).then(
      (usage) => current && setModuleStorage(usage),
      (error: unknown) => logger.warn("Could not read the engine's module storage", { error, instanceId })
    );
    return () => {
      current = false;
    };
  }, [hostedStorageUsage, moduleStorageUsage, instanceId, hosted, logger]);

  return (
    <Card data-testid="card-engine-limits">
      <CardHeader>
        <CardTitle>Limits</CardTitle>
        <CardDescription>What this engine uses of what its plan includes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!hosted ? (
          <p className="text-sm text-muted-foreground">
            A self-hosted engine keeps its own storage, so no plan limits apply.
          </p>
        ) : null}
        {hosted && storage === undefined ? <p className="text-sm text-muted-foreground">Reading storage...</p> : null}
        {storage ? (
          <Meter label="Storage" usedBytes={storage.usedBytes} limitBytes={storage.limitBytes} testId="meter-storage" />
        ) : null}
        {moduleStorage ? (
          <Meter
            label="Module storage"
            usedBytes={moduleStorage.usedBytes}
            limitBytes={moduleStorage.limitBytes}
            testId="meter-module-storage"
          />
        ) : null}
        {organization.seats ? (
          <div className="flex justify-between text-sm" data-testid="text-engine-seats">
            <span>Seats (the whole organization)</span>
            <span className="text-muted-foreground">{formatSeats(organization.seats)}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function People({ instanceId }: { instanceId: Id<"instances"> }) {
  const team = useQuery(api.engineMembers.listForEngine, { instanceId });
  return (
    <Card data-testid="card-engine-people">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>People</CardTitle>
          <CardDescription>Who can open this engine, and their role on it.</CardDescription>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/account/team">Manage team</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {team === undefined ? <p className="text-sm text-muted-foreground">Loading people...</p> : null}
        {team === null ? <p className="text-sm text-muted-foreground">You can't see who is on this engine.</p> : null}
        {team ? (
          <ul className="divide-y">
            {team.members.map((member) => (
              <li
                key={member.userId}
                className="flex items-center justify-between gap-3 py-2.5"
                data-testid={`row-engine-person-${member.userId}`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={member.image ?? undefined} />
                    <AvatarFallback className="text-xs">{member.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="truncate font-medium">{member.name}</span>
                </span>
                <Badge variant="outline" className="capitalize">
                  {member.engineRole}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Modules that are not running yet or failed are listed first; one that is running needs no mark. */
function Modules({ instanceId }: { instanceId: Id<"instances"> }) {
  const modules = useQuery(api.moduleRepository.list, { instanceId });
  const [search, setSearch] = useState("");
  const unsettled = modules?.filter(isUnsettled) ?? [];
  const shown = visibleModules(modules ?? [], search);
  return (
    <Card data-testid="card-engine-modules">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Modules
          {modules ? <Badge variant="secondary">{modules.length}</Badge> : null}
        </CardTitle>
        <CardDescription>
          {unsettled.length > 0 ? `${unsettled.length} not running yet or failed.` : "Everything installed is running."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {modules === undefined ? <p className="text-sm text-muted-foreground">Loading modules...</p> : null}
        {modules?.length === 0 ? <p className="text-sm text-muted-foreground">No modules installed.</p> : null}
        {modules && modules.length > MODULES_SEARCHABLE_FROM ? (
          <Input
            aria-label="Search modules"
            placeholder="Search modules..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            data-testid="input-search-modules"
          />
        ) : null}
        <ul className="max-h-80 divide-y overflow-y-auto" data-testid="list-engine-modules">
          {shown.map((module) => (
            <li
              key={module._id}
              className="flex items-center justify-between gap-3 py-2"
              data-testid={`row-engine-module-${module._id}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{module.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[module.version, module.category, module.author].filter(Boolean).join(" · ")}
                </span>
                {isUnsettled(module) && module.statusMessage ? (
                  <span className="block truncate text-xs text-destructive">{module.statusMessage}</span>
                ) : null}
              </span>
              {isUnsettled(module) ? (
                <Badge variant={module.status === "failed" ? "destructive" : "secondary"}>
                  {module.status === "failed" ? "Failed" : "Installing"}
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
        {modules && modules.length > 0 && shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No module matches that search.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Integrations({ instanceId }: { instanceId: Id<"instances"> }) {
  const links = useQuery(api.instances.getPlatformLinks, { instanceId });
  return (
    <Card data-testid="card-engine-integrations">
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <CardDescription>The streaming accounts this engine acts on.</CardDescription>
      </CardHeader>
      <CardContent>
        {links === undefined ? <p className="text-sm text-muted-foreground">Loading integrations...</p> : null}
        {links?.length === 0 ? <p className="text-sm text-muted-foreground">No streaming account linked.</p> : null}
        <ul className="divide-y">
          {links?.map((link) => (
            <li
              key={link._id}
              className="flex items-center justify-between gap-3 py-2.5"
              data-testid={`row-engine-link-${link._id}`}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{link.platformUsername}</span>
                <span className="text-xs capitalize text-muted-foreground">{link.platform}</span>
              </span>
              {link.authFailedAt === undefined ? (
                <Badge variant="secondary">Connected</Badge>
              ) : (
                <Badge variant="destructive">Needs reconnecting</Badge>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Reads the engine's own health: its build, its streaming links, and a live check that it answers. */
function HealthCard({
  health,
  lastActivityAt,
  url,
}: {
  health: EngineHealth;
  lastActivityAt: number | null;
  url: string | null;
}) {
  const now = useMinuteClock();
  const testConnection = useAction(api.engineHealth.testConnection);
  const [check, setCheck] = useState<"idle" | "checking" | "ok" | { error: string }>("idle");

  async function runCheck() {
    if (url === null) {
      return;
    }
    setCheck("checking");
    try {
      const result = await testConnection({ url });
      setCheck(result.ok ? "ok" : { error: result.error });
    } catch (error) {
      toast({ title: "Could not check the engine", description: actionErrorMessage(error), variant: "destructive" });
      setCheck("idle");
    }
  }

  return (
    <Card data-testid="card-engine-health">
      <CardHeader>
        <CardTitle>Health</CardTitle>
        <CardDescription>How this engine is doing right now.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className={cn("text-lg font-semibold", TONE_CLASS[health.tone])} data-testid="text-engine-health">
          {health.label}
        </p>
        {health.reasons.map((reason) => (
          <p key={reason} className="text-muted-foreground">
            {reason}
          </p>
        ))}
        <p className="text-muted-foreground" data-testid="text-engine-last-heard">
          Last heard from the engine: {lastActivityAt === null ? "never" : formatAgo(lastActivityAt, now)}
        </p>
        {url === null ? null : (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={check === "checking"}
              onClick={runCheck}
              data-testid="button-check-connection"
            >
              Check connection
            </Button>
            {check === "ok" ? <span className="text-emerald-600 dark:text-emerald-400">Answered</span> : null}
            {typeof check === "object" ? <span className="text-destructive">{check.error}</span> : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EngineDashboard({ engine }: { engine: OrgEngine }) {
  const { organization } = useOrganization();
  const instance = useQuery(api.instances.get, { instanceId: engine.instanceId });
  const links = useQuery(api.instances.getPlatformLinks, { instanceId: engine.instanceId });
  const team = useQuery(api.engineMembers.listForEngine, { instanceId: engine.instanceId });
  const modules = useQuery(api.moduleRepository.list, { instanceId: engine.instanceId });
  const rename = useMutation(api.instances.update);
  const upgrade = useEngineUpgrade(engine.instanceId, engine.hosting === "managed" && engine.status === "registered");
  const hosted = engine.hosting === "managed";
  const health = engineHealth({
    engine,
    linkNeedsReconnect: links?.some((link) => link.authFailedAt !== undefined) ?? false,
    lastEngineActivityAt: instance?.lastEngineActivityAt ?? null,
  });

  function launch() {
    $currentInstanceId.set(engine.instanceId);
  }

  return (
    <div className="space-y-6" data-testid="section-engine-dashboard">
      <PageHeader
        title={engine.name}
        description={hosted ? "Hosted by woofx3." : "Runs on your own machine."}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={ENGINES_PATH}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Engines
              </Link>
            </Button>
            {organization.can.renameEngine ? (
              <RenameDialog
                title="Rename engine"
                current={engine.name}
                onRename={(name) => rename({ instanceId: engine.instanceId, name })}
                testId={`button-rename-engine-${engine.instanceId}`}
              />
            ) : null}
            {engine.canOpen ? (
              <Button asChild onClick={launch} data-testid="button-launch-engine">
                <Link href="/">Launch dashboard</Link>
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="section-engine-stats">
        <Stat
          testId="stat-engine-health"
          icon={<HeartPulse className="h-4 w-4" />}
          label="Health"
          value={health.label}
          tone={health.tone}
        />
        <Stat
          testId="stat-engine-version"
          icon={<Server className="h-4 w-4" />}
          label="Version"
          value={upgrade?.current ?? (hosted ? "Unknown" : "Self-managed")}
          detail={
            upgrade?.available ? (
              <span className="flex items-center gap-2">
                <Badge data-testid="badge-engine-upgrade">Upgrade available</Badge>
                {upgrade.offered}
              </span>
            ) : upgrade?.current ? (
              "Up to date"
            ) : undefined
          }
        />
        <Stat
          testId="stat-engine-people"
          icon={<Users className="h-4 w-4" />}
          label="People"
          value={team ? String(team.members.length) : "..."}
        />
        <Stat
          testId="stat-engine-modules"
          icon={<Boxes className="h-4 w-4" />}
          label="Modules"
          value={modules ? String(modules.length) : "..."}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <HealthCard
          health={health}
          lastActivityAt={instance?.lastEngineActivityAt ?? null}
          url={instance?.url ?? null}
        />
        <Limits instanceId={engine.instanceId} hosted={hosted} />
      </div>
      <People instanceId={engine.instanceId} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Modules instanceId={engine.instanceId} />
        <Integrations instanceId={engine.instanceId} />
      </div>
    </div>
  );
}

/** One engine of the selected organization, laid out as a dashboard: health, version, limits, people, modules, integrations. */
export default function EngineDetailPage() {
  const { instanceId } = useParams<{ instanceId: string }>();
  const { organization } = useOrganization();
  const engine = organization.engines.find((candidate) => candidate.instanceId === instanceId);
  if (engine === undefined) {
    return <Redirect to={ENGINES_PATH} replace />;
  }
  return <EngineDashboard engine={engine} />;
}
