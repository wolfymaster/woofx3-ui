import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { UserPageForEditing } from "@convex/userPages";
import {
  checkPageContent,
  PAGE_LAYOUTS,
  type PageContent,
  type PageProblem,
  type PageRegion,
  type PageWidgetType,
  USER_PAGE_LIMITS,
} from "@shared/user-pages";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, Globe, Loader2, Plus, RotateCcw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageLook } from "@/components/user-page/page-look";
import { SectionCard } from "@/components/user-page/section-card";
import { SortableList } from "@/components/user-page/sortable";
import { useInstance } from "@/hooks/use-instance";
import { useIsInstanceAdmin } from "@/hooks/use-instance-role";
import { toast } from "@/hooks/use-toast";
import { itemPath, ProblemIndex } from "@/lib/page-problems";
import {
  initialEditorState,
  isDirty,
  pageEditorReducer,
  REGION_LABELS,
  sectionIndex,
  sectionsInRegion,
} from "@/lib/user-page-editor";
import {
  type ButtonGate,
  NO_SLUG_MESSAGE,
  NOT_ENTITLED_MESSAGE,
  type PageStatus,
  pageStatus,
  publishGate,
  unpublishGate,
} from "@/lib/user-page-publishing";
import { type PageFailure, pageFailure } from "@/lib/user-page-refusal";
import { userPageBaseUrl, userPageUrl } from "@/lib/user-page-url";

/** Section, widget and question ids: unique, opaque and within the shared checks' id rules. */
function newPageId(): string {
  return crypto.randomUUID();
}

export default function UserPageScreen() {
  const { instance, isLoading } = useInstance();
  const page = useQuery(api.userPages.forEditing, instance ? { instanceId: instance._id } : "skip");
  const isAdmin = useIsInstanceAdmin();

  if (isLoading || (instance && page === undefined) || isAdmin === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!instance || !page) {
    return (
      <div className="mx-auto max-w-md p-6 py-16 text-center text-sm text-muted-foreground">
        Choose an engine you are a member of to edit its page.
      </div>
    );
  }
  // Keyed by instance, so switching engines starts a fresh editor rather than carrying edits across.
  return <UserPageEditor key={instance._id} instanceId={instance._id} page={page} isAdmin={isAdmin} />;
}

type Busy = "save" | "publish" | "unpublish" | null;

/** Problems the server reported for one exact content, shown until the content changes. */
interface ServerProblems {
  content: PageContent;
  problems: PageProblem[];
}

function UserPageEditor({
  instanceId,
  page,
  isAdmin,
}: {
  instanceId: Id<"instances">;
  page: UserPageForEditing;
  isAdmin: boolean;
}) {
  const [state, dispatch] = useReducer(pageEditorReducer, page.draft, initialEditorState);
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<PageFailure | null>(null);
  const [serverProblems, setServerProblems] = useState<ServerProblems | null>(null);
  const [addedWidgetId, setAddedWidgetId] = useState<string | null>(null);
  const saveDraft = useMutation(api.userPages.saveDraft);
  const publish = useMutation(api.userPages.publish);
  const unpublish = useMutation(api.userPages.unpublish);

  useEffect(() => {
    dispatch({ type: "serverDraft", draft: page.draft });
  }, [page.draft]);

  const dirty = isDirty(state);
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const localProblems = useMemo(() => {
    const checked = checkPageContent(state.content);
    return checked.ok ? [] : checked.problems;
  }, [state.content]);
  const problems = useMemo(() => {
    const fromServer = serverProblems?.content === state.content ? serverProblems.problems : [];
    return new ProblemIndex([...localProblems, ...fromServer]);
  }, [localProblems, serverProblems, state.content]);

  const facts = {
    isAdmin,
    slug: page.slug,
    canPublish: page.canPublish,
    draftRevision: state.base.revision,
    published: page.published,
    dirty,
    hasProblems: problems.size > 0,
  };
  const status = pageStatus(facts);
  const stale = failure?.kind === "stale" || state.remoteRevision !== null;

  const fail = useCallback((error: unknown, content: PageContent) => {
    const next = pageFailure(error);
    if (next.kind === "problems") {
      setServerProblems({ content, problems: next.problems });
    }
    setFailure(next);
  }, []);

  const run = async (kind: Exclude<Busy, null>, content: PageContent, work: () => Promise<void>) => {
    setBusy(kind);
    setFailure(null);
    try {
      await work();
    } catch (error) {
      fail(error, content);
    } finally {
      setBusy(null);
    }
  };

  const onSave = () => {
    const content = state.content;
    void run("save", content, async () => {
      const { revision } = await saveDraft({ instanceId, baseRevision: state.base.revision, content });
      dispatch({ type: "saved", revision, content });
      toast({ title: "Draft saved" });
    });
  };

  const onPublish = () => {
    void run("publish", state.content, async () => {
      await publish({ instanceId, revision: state.base.revision });
      toast({ title: "Published", description: "Visitors now see this version of your page." });
    });
  };

  const onUnpublish = () => {
    void run("unpublish", state.content, async () => {
      await unpublish({ instanceId });
      toast({ title: "Unpublished", description: "Your page is offline. The draft is kept." });
    });
  };

  const onReload = () => {
    dispatch({ type: "load", draft: page.draft });
    setFailure(null);
    setServerProblems(null);
  };

  const onAddWidget = (sectionId: string, widgetType: PageWidgetType) => {
    const id = newPageId();
    dispatch({ type: "addWidget", sectionId, widgetType, id });
    setAddedWidgetId(id);
  };

  const widgetCount = state.content.sections.reduce((count, section) => count + section.widgets.length, 0);
  const pageHasRoom = widgetCount < USER_PAGE_LIMITS.widgetsPerPage;
  const canAddSection = state.content.sections.length < USER_PAGE_LIMITS.sections;
  const regions = regionsToShow(state.content);
  const pageUrl = page.slug === null ? null : userPageUrl(userPageBaseUrl(), page.slug);

  const saveGate: ButtonGate =
    localProblems.length > 0
      ? { kind: "disabled", reason: "Fix the problems marked on the page first." }
      : stale
        ? { kind: "disabled", reason: "Reload the newer draft first." }
        : dirty
          ? { kind: "enabled" }
          : { kind: "disabled", reason: "Nothing to save." };

  return (
    <div className="container mx-auto p-4 sm:p-6">
      <PageHeader
        title="Your page"
        description={
          pageUrl
            ? `A public page for your viewers at ${pageUrl.replace(/^https?:\/\//, "")}.`
            : "A public page for your viewers."
        }
        actions={
          <>
            <StatusBadge status={status} dirty={dirty} />
            {pageUrl && page.published && (
              <Button variant="ghost" size="sm" asChild>
                <a href={pageUrl} target="_blank" rel="noopener noreferrer" data-testid="link-view-page">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  View page
                </a>
              </Button>
            )}
            <GatedButton
              gate={unpublishGate(facts)}
              variant="outline"
              busy={busy === "unpublish"}
              disabled={busy !== null}
              onClick={onUnpublish}
              testId="button-unpublish"
            >
              Unpublish
            </GatedButton>
            <GatedButton
              gate={saveGate}
              variant="outline"
              busy={busy === "save"}
              disabled={busy !== null}
              onClick={onSave}
              testId="button-save-draft"
            >
              Save draft
            </GatedButton>
            <GatedButton
              gate={publishGate(facts)}
              busy={busy === "publish"}
              disabled={busy !== null}
              onClick={onPublish}
              testId="button-publish"
            >
              <Globe className="mr-1.5 h-3.5 w-3.5" />
              Publish
            </GatedButton>
          </>
        }
      />

      <div className="mb-6 space-y-3 empty:hidden">
        {page.slug === null && (
          <Alert data-testid="alert-no-slug">
            <AlertTitle>This engine has no woofx3 address</AlertTitle>
            <AlertDescription>{NO_SLUG_MESSAGE} You can still build the page here.</AlertDescription>
          </Alert>
        )}
        {page.slug !== null && !page.canPublish && (
          <Alert data-testid="alert-not-entitled">
            <AlertTitle>Publishing needs an upgrade</AlertTitle>
            <AlertDescription>{NOT_ENTITLED_MESSAGE}</AlertDescription>
          </Alert>
        )}
        {stale && (
          <Alert variant="destructive" data-testid="alert-stale">
            <AlertTitle>Someone else saved this page</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>
                Their draft is newer than the one you started from. Reload to see it; your unsaved changes here will be
                lost.
              </span>
              <Button size="sm" variant="outline" onClick={onReload} data-testid="button-reload-draft">
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Reload
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {failure && failure.kind !== "stale" && (
          <Alert variant="destructive" data-testid="alert-failure">
            <AlertDescription>{failure.message}</AlertDescription>
          </Alert>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-8">
          {regions.map((region) => {
            const sections = sectionsInRegion(state.content, region);
            return (
              <RegionGroup
                key={region}
                region={region}
                count={sections.length}
                canAdd={canAddSection}
                onAdd={() => dispatch({ type: "addSection", id: newPageId(), region })}
              >
                {sections.length > 0 && (
                  <SortableList
                    ids={sections.map((section) => section.id)}
                    onMove={(sectionId, overSectionId) => dispatch({ type: "moveSection", sectionId, overSectionId })}
                    className="space-y-3"
                  >
                    {sections.map((section) => (
                      <SectionCard
                        key={section.id}
                        section={section}
                        layout={state.content.layout}
                        path={itemPath("sections", sectionIndex(state.content, section.id))}
                        problems={problems}
                        canDrag={sections.length > 1}
                        pageHasRoom={pageHasRoom}
                        addedWidgetId={addedWidgetId}
                        newId={newPageId}
                        onAddWidget={onAddWidget}
                        dispatch={dispatch}
                      />
                    ))}
                  </SortableList>
                )}
              </RegionGroup>
            );
          })}
          <PageWideProblems problems={problems} />
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Look</CardTitle>
            </CardHeader>
            <CardContent>
              <PageLook content={state.content} problems={problems} dispatch={dispatch} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/**
 * The regions to list sections under: the layout's own, then any region a
 * section sits in that the layout lacks, so no section is ever hidden (the
 * checks report it as misplaced).
 */
function regionsToShow(content: PageContent): PageRegion[] {
  const regions: PageRegion[] = [...PAGE_LAYOUTS[content.layout].regions];
  for (const section of content.sections) {
    if (!regions.includes(section.region)) {
      regions.push(section.region);
    }
  }
  return regions;
}

function RegionGroup({
  region,
  count,
  canAdd,
  onAdd,
  children,
}: {
  region: PageRegion;
  count: number;
  canAdd: boolean;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3" aria-label={REGION_LABELS[region]} data-testid={`region-${region}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-medium">
          {REGION_LABELS[region]}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {count === 0 ? "empty" : count === 1 ? "1 section" : `${count} sections`}
          </span>
        </h2>
        <Button
          variant="outline"
          size="sm"
          disabled={!canAdd}
          onClick={onAdd}
          data-testid={`button-add-section-${region}`}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add section
        </Button>
      </div>
      {count === 0 && (
        <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Add a section to put text, links, counters and more here.
        </div>
      )}
      {children}
    </section>
  );
}

/** Problems about the page as a whole (too many sections or widgets), which no single field owns. */
function PageWideProblems({ problems }: { problems: ProblemIndex }) {
  const messages = problems.at("sections");
  if (messages.length === 0) {
    return null;
  }
  return (
    <Alert variant="destructive">
      <AlertDescription>
        <ul className="space-y-1">
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function StatusBadge({ status, dirty }: { status: PageStatus; dirty: boolean }) {
  const label =
    status.kind === "unpublished" ? "Not published" : status.kind === "live" ? "Live" : "Live, newer draft saved";
  return (
    <div className="mr-1 flex items-center gap-2" data-testid="page-status">
      <Badge variant={status.kind === "unpublished" ? "secondary" : "default"}>
        {status.kind !== "unpublished" && (
          <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
        )}
        {label}
      </Badge>
      {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
    </div>
  );
}

/**
 * A button that follows its gate: absent when hidden, and explaining itself
 * when disabled. A gated-off button stays focusable (`aria-disabled` rather
 * than `disabled`), so keyboard users reach the reason as well as pointer users.
 */
function GatedButton({
  gate,
  busy,
  disabled,
  onClick,
  variant = "default",
  testId,
  children,
}: {
  gate: ButtonGate;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  variant?: "default" | "outline";
  testId: string;
  children: ReactNode;
}) {
  if (gate.kind === "hidden") {
    return null;
  }
  const content = (
    <>
      {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
      {children}
    </>
  );
  if (gate.kind === "enabled") {
    return (
      <Button size="sm" variant={variant} disabled={disabled} onClick={onClick} data-testid={testId}>
        {content}
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant={variant}
          aria-disabled="true"
          className="cursor-not-allowed opacity-50"
          data-testid={testId}
          data-reason={gate.reason}
        >
          {content}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{gate.reason}</TooltipContent>
    </Tooltip>
  );
}
