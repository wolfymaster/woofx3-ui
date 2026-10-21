import { bareKind, parseKindRef } from "@convex/lib/resourceKinds";
import { ChevronLeft, Plus, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { CreateResourceForm } from "@/components/modules/create-resource-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toInstanceId } from "@/engine/convex/ids";
import { useCreateResourceInstanceRequest, useResourceKind } from "@/engine/hooks/use-module-resources";
import { useActionObjectInstances } from "@/hooks/use-action-object-instances";
import { useInstance } from "@/hooks/use-instance";
import {
  type ActionObject,
  type ActionSearchHit,
  ADVANCED_OBJECT_KEY,
  acceptsInstance,
  actionObjects,
  FLOW_BLOCKS,
  type FlowBlock,
  type FlowStepKind,
  initialParameters,
  kindChoiceLabel,
  type ObjectAction,
  type ObjectInstance,
  objectHint,
  type ResourceInstanceRow,
  searchActionObjects,
  verbLabel,
  verbsFor,
  whichPrompt,
} from "@/lib/action-objects";
import { cn } from "@/lib/utils";
import type { ActionPreset } from "@/lib/workflow-presets";

/** What the streamer chose: an action with its starting settings, or a flow step to set up next. */
export type ObjectActionPick =
  | { kind: "action"; preset: ActionPreset; parameters: Record<string, unknown> }
  | { kind: FlowStepKind };

export interface ObjectActionPickerProps {
  presets: readonly ActionPreset[];
  /** The flow steps offered besides actions, in this order. Empty offers actions alone. */
  flowSteps?: readonly FlowStepKind[];
  /** What the picker is for, shown at its top while browsing. */
  heading?: string;
  onPick: (pick: ObjectActionPick) => void;
  onCancel: () => void;
}

const ALL_FLOW_STEPS: readonly FlowStepKind[] = ["pause", "wait", "condition"];
const MAX_SEARCH_HITS = 8;

/** Marks the controls the arrow keys move between inside one list. */
const ITEM_ATTRIBUTE = "data-picker-item";

/** Marks the picker's root, so a dialog it sits in can leave Escape to it. Must match the attribute on the root. */
const ROOT_ATTRIBUTE = "data-object-action-picker";

/**
 * Whether a key event started inside a picker, which uses Escape to step back.
 * A dialog holding a picker keeps itself open for such an Escape (by preventing
 * the event in its onEscapeKeyDown); the picker still steps back.
 */
export function isInsideActionPicker(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${ROOT_ATTRIBUTE}]`) !== null;
}

const itemClass =
  "rounded-lg text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Adds one step, in place where it is rendered: first what should change (an
 * object), then which of the streamer's things, then what to do to it, each verb
 * reading as the finished step. Search reaches every verb, the streamer's own
 * names and the flow steps from the start.
 *
 * It renders inline and never opens a dialog or popover, including to create a
 * missing counter, timer or queue.
 */
export function ObjectActionPicker({
  presets,
  flowSteps = ALL_FLOW_STEPS,
  heading = "Add a step",
  onPick,
  onCancel,
}: ObjectActionPickerProps) {
  const objects = useMemo(() => actionObjects(presets), [presets]);
  // Made here and not yet mirrored back from the engine, so still missing from the instance query.
  const [created, setCreated] = useState<ResourceInstanceRow[]>([]);
  const instances = useActionObjectInstances(objects, created);
  const blocks = useMemo(
    () =>
      flowSteps.flatMap((kind) => {
        const block = FLOW_BLOCKS.find((candidate) => candidate.kind === kind);
        return block ? [block] : [];
      }),
    [flowSteps]
  );

  const [query, setQuery] = useState("");
  const [objectKey, setObjectKey] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const searchId = useId();

  const object = objectKey ? objects.find((candidate) => candidate.key === objectKey) : undefined;
  const hits = useMemo(
    () => searchActionObjects(objects, instances, query, blocks).slice(0, MAX_SEARCH_HITS),
    [objects, instances, query, blocks]
  );

  useEffect(() => {
    if (objectKey === null) {
      searchRef.current?.focus();
    } else {
      bodyRef.current?.querySelector<HTMLElement>(`[${ITEM_ATTRIBUTE}]`)?.focus();
    }
  }, [objectKey]);

  function pickAction(action: ObjectAction, instance: ObjectInstance | undefined) {
    onPick({ kind: "action", preset: action.preset, parameters: initialParameters(action, instance) });
  }

  function pickHit(hit: ActionSearchHit) {
    if (hit.kind === "flow") {
      onPick({ kind: hit.block.kind });
    } else {
      pickAction(hit.action, hit.instance);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    // The picker's own parts that use Escape stop it. One from a menu portaled out
    // of the picker (a select's options) closes that menu only, so it is ignored by
    // where it started; defaultPrevented cannot tell, since a dialog holding the
    // picker prevents every Escape inside it to stay open.
    if (event.key !== "Escape" || !event.currentTarget.contains(event.target as Node)) {
      return;
    }
    event.preventDefault();
    if (object) {
      setObjectKey(null);
    } else if (query) {
      setQuery("");
    } else {
      onCancel();
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && hits.length > 0) {
      event.preventDefault();
      pickHit(hits[0]);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      bodyRef.current?.querySelector<HTMLElement>(`[${ITEM_ATTRIBUTE}]`)?.focus();
    }
  }

  const searching = !object && query.trim() !== "";

  return (
    <section
      aria-label={object ? object.label : heading}
      className="flex flex-col gap-3.5 rounded-xl border border-primary/40 bg-card px-4 pb-4 pt-3.5 text-card-foreground"
      onKeyDown={handleKeyDown}
      data-object-action-picker=""
      data-testid="object-action-picker"
    >
      <div className="flex items-center gap-2.5">
        {object && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 px-2 text-muted-foreground"
            onClick={() => setObjectKey(null)}
            data-testid="button-picker-back"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            All
          </Button>
        )}
        <h3 className="text-[15px] font-semibold">{object ? object.label : heading}</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto h-8 w-8 text-muted-foreground"
          aria-label="Stop adding a step"
          onClick={onCancel}
          data-testid="button-picker-cancel"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {!object && (
        <div>
          <label htmlFor={searchId} className="sr-only">
            Search actions and your things
          </label>
          <Input
            ref={searchRef}
            id={searchId}
            type="search"
            className="h-[38px]"
            placeholder={
              blocks.length > 0 ? "Try hype counter, raid alert, pause or if" : "Try hype counter or raid alert"
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            data-testid="input-picker-search"
          />
        </div>
      )}

      <div ref={bodyRef} className="flex flex-col gap-3.5">
        {searching && <SearchHits hits={hits} onPick={pickHit} />}
        {!object && !searching && (
          <>
            <ObjectGrid objects={objects} instances={instances} onOpen={setObjectKey} />
            {blocks.length > 0 && <FlowRow blocks={blocks} onPick={(kind) => onPick({ kind })} />}
          </>
        )}
        {object && (
          <ObjectVerbs
            object={object}
            instances={instances.get(object.key)}
            chosenValue={chosen[object.key]}
            onChoose={(value) => setChosen((current) => ({ ...current, [object.key]: value }))}
            onCreated={(made) => {
              setCreated((current) => [...current, made]);
              setChosen((current) => ({ ...current, [object.key]: made.canonicalId }));
            }}
            onPick={pickAction}
          />
        )}
      </div>
    </section>
  );
}

/** Moves focus between a list's items with the arrow keys; Tab still walks them too. */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
  const backward = event.key === "ArrowUp" || event.key === "ArrowLeft";
  if (!forward && !backward) {
    return;
  }
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(`[${ITEM_ATTRIBUTE}]`));
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (index < 0) {
    return;
  }
  const next = items[index + (forward ? 1 : -1)];
  if (next) {
    event.preventDefault();
    next.focus();
  }
}

function ObjectGrid({
  objects,
  instances,
  onOpen,
}: {
  objects: readonly ActionObject[];
  instances: ReturnType<typeof useActionObjectInstances>;
  onOpen: (key: string) => void;
}) {
  if (objects.length === 0) {
    return <p className="px-2.5 text-sm text-muted-foreground">No actions are installed yet.</p>;
  }
  return (
    <ul
      aria-label="What should change?"
      className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-1.5 gap-y-0.5"
      onKeyDown={moveFocus}
    >
      {objects.map((object) => {
        const Icon = object.icon;
        const advanced = object.key === ADVANCED_OBJECT_KEY;
        return (
          <li key={object.key}>
            <button
              type="button"
              data-picker-item=""
              className={cn(itemClass, "flex min-h-[52px] w-full items-center gap-2.5 px-2.5 py-2")}
              onClick={() => onOpen(object.key)}
              data-testid={`button-object-${object.key}`}
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  advanced ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-col gap-px">
                <span className="text-sm font-semibold">{object.label}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {objectHint(object, instances.get(object.key))}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function FlowRow({ blocks, onPick }: { blocks: readonly FlowBlock[]; onPick: (kind: FlowStepKind) => void }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset's border and legend would fight the row's layout.
    <div
      role="group"
      aria-label="Or control the flow"
      className="flex flex-wrap items-center gap-2 border-t pt-3"
      onKeyDown={moveFocus}
    >
      <span className="mr-1 text-[13px] text-muted-foreground" aria-hidden="true">
        Or control the flow
      </span>
      {blocks.map((block) => {
        const Icon = block.icon;
        return (
          <button
            key={block.kind}
            type="button"
            data-picker-item=""
            title={block.description}
            className={cn(
              itemClass,
              "flex min-h-9 items-center gap-2 border border-dashed px-3 text-[13px] font-medium hover:border-solid"
            )}
            onClick={() => onPick(block.kind)}
            data-testid={`button-flow-${block.kind}`}
          >
            <Icon className="h-[15px] w-[15px]" aria-hidden="true" />
            {block.label}
          </button>
        );
      })}
    </div>
  );
}

function SearchHits({ hits, onPick }: { hits: readonly ActionSearchHit[]; onPick: (hit: ActionSearchHit) => void }) {
  if (hits.length === 0) {
    return (
      <p className="mx-2.5 my-1 text-[13px] text-muted-foreground" aria-live="polite">
        Nothing matches that. Try the name of one of your counters, alerts or queues.
      </p>
    );
  }
  return (
    <ul aria-label="Matches" className="flex flex-col" onKeyDown={moveFocus}>
      {hits.map((hit) => (
        <li key={hitKey(hit)}>
          <VerbButton title={hit.label} detail={hit.where} onClick={() => onPick(hit)} />
        </li>
      ))}
    </ul>
  );
}

function hitKey(hit: ActionSearchHit): string {
  if (hit.kind === "flow") {
    return `flow:${hit.block.kind}`;
  }
  return `${hit.object.key}:${hit.action.preset.id}:${hit.instance?.value ?? ""}`;
}

function VerbButton({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-picker-item=""
      className={cn(itemClass, "flex min-h-11 w-full flex-col gap-0.5 px-2.5 py-2")}
      onClick={onClick}
    >
      <span className="text-sm font-medium">{title}</span>
      {detail && <span className="text-[13px] text-muted-foreground">{detail}</span>}
    </button>
  );
}

function ObjectVerbs({
  object,
  instances,
  chosenValue,
  onChoose,
  onCreated,
  onPick,
}: {
  object: ActionObject;
  instances: readonly ObjectInstance[] | undefined;
  chosenValue: string | undefined;
  onChoose: (value: string) => void;
  onCreated: (instance: ResourceInstanceRow) => void;
  onPick: (action: ObjectAction, instance: ObjectInstance | undefined) => void;
}) {
  const chosen = object.target
    ? (instances?.find((instance) => instance.value === chosenValue) ?? instances?.[0])
    : undefined;
  return (
    <>
      {object.target && (
        <InstanceChips
          object={object}
          instances={instances}
          chosen={chosen}
          onChoose={onChoose}
          onCreated={onCreated}
        />
      )}
      <ul
        aria-label={`What to do${chosen ? ` to ${chosen.label}` : ""}`}
        className="flex flex-col"
        onKeyDown={moveFocus}
      >
        {verbsFor(object, chosen).map((action) => {
          const instance = chosen && acceptsInstance(action, chosen) ? chosen : undefined;
          return (
            <li key={action.preset.id}>
              <VerbButton
                title={verbLabel(action, instance)}
                detail={action.preset.description}
                onClick={() => onPick(action, instance)}
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}

function InstanceChips({
  object,
  instances,
  chosen,
  onChoose,
  onCreated,
}: {
  object: ActionObject;
  instances: readonly ObjectInstance[] | undefined;
  chosen: ObjectInstance | undefined;
  onChoose: (value: string) => void;
  onCreated: (instance: ResourceInstanceRow) => void;
}) {
  const [creating, setCreating] = useState(false);
  const labelId = useId();
  const target = object.target;
  const noun = object.noun ?? "one";

  if (instances === undefined) {
    return <p className="text-[13px] text-muted-foreground">Loading your {object.label.toLowerCase()}…</p>;
  }

  const create =
    target?.type === "resource" ? (
      creating ? (
        <InlineCreateInstance
          kinds={target.kinds}
          noun={noun}
          onCreated={(made) => {
            onCreated(made);
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 rounded-full"
          onClick={() => setCreating(true)}
          data-testid={`button-create-${object.key}`}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {instances.length === 0 ? "Create one" : `New ${noun}`}
        </Button>
      )
    ) : null;

  if (instances.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">
          {object.noInstances ?? `You have no ${object.label.toLowerCase()} yet.`} The steps below can still be added
          and pointed at one later.
        </p>
        {create}
        {target?.type === "source" && (
          <Link href="/stream/scenes" className="text-xs text-primary underline-offset-4 hover:underline">
            {target.source === "scenes"
              ? "Make a scene in the scene editor"
              : "Add a spot for alerts in the scene editor"}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-[13px] font-medium">
        {whichPrompt(object)}
      </span>
      {/* biome-ignore lint/a11y/useSemanticElements: toggle chips, not a form field set. */}
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2" onKeyDown={moveFocus}>
        {instances.map((instance) => {
          const pressed = instance.value === chosen?.value;
          return (
            <button
              key={instance.value}
              type="button"
              data-picker-item=""
              aria-pressed={pressed}
              className={cn(
                "flex min-h-8 items-center rounded-full border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                pressed ? "border-primary/50 bg-primary/10 text-primary" : "bg-background hover:bg-muted"
              )}
              onClick={() => onChoose(instance.value)}
              data-testid={`chip-instance-${instance.value}`}
            >
              {instance.label}
            </button>
          );
        })}
        {!creating && create}
      </div>
      {creating && create}
    </div>
  );
}

/**
 * Creates an instance of one of `kinds` (the kinds the object's actions accept)
 * in place, asking which first when there is more than one, and hands back the
 * new instance so it becomes the choice.
 */
function InlineCreateInstance({
  kinds,
  noun,
  onCreated,
  onCancel,
}: {
  kinds: readonly string[];
  noun: string;
  onCreated: (instance: ResourceInstanceRow) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<string | undefined>(kinds.length === 1 ? kinds[0] : undefined);

  if (kind === undefined) {
    return (
      <fieldset
        className="min-w-0 space-y-2 rounded-lg border bg-muted/30 px-3 pb-3 pt-1"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <legend className="px-1 text-[13px] font-medium">What kind of {noun}?</legend>
        <div className="flex flex-wrap gap-2">
          {kinds.map((candidate) => (
            <Button
              key={candidate}
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => setKind(candidate)}
              data-testid={`button-create-kind-${candidate}`}
            >
              {kindChoiceLabel(candidate)}
            </Button>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </fieldset>
    );
  }
  return (
    <InlineCreateForm
      key={kind}
      kind={kind}
      noun={noun}
      onCreated={onCreated}
      onCancel={kinds.length > 1 ? () => setKind(undefined) : onCancel}
    />
  );
}

/**
 * Creates an instance of `kind` through the same form and action the kind's own
 * page uses.
 */
function InlineCreateForm({
  kind,
  noun,
  onCreated,
  onCancel,
}: {
  kind: string;
  noun: string;
  onCreated: (instance: ResourceInstanceRow) => void;
  onCancel: () => void;
}) {
  const { instance } = useInstance();
  const instanceId = instance?._id;
  const createInstance = useCreateResourceInstanceRequest();
  const kindDefinition = useResourceKind(toInstanceId(instanceId ?? null), kind);
  const owner = kindDefinition?.moduleName ?? parseKindRef(kind)?.module;
  const createdRef = useRef<ResourceInstanceRow | null>(null);

  if (!instanceId || kindDefinition === undefined) {
    return <p className="text-[13px] text-muted-foreground">Loading…</p>;
  }
  if (!owner) {
    return (
      <p className="text-[13px] text-destructive">
        No installed module declares {noun}s, so there is nowhere to create one.
      </p>
    );
  }

  return (
    <fieldset
      className="min-w-0 space-y-3 rounded-lg border bg-muted/30 px-3 pb-3 pt-1"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <legend className="px-1 text-[13px] font-medium">New {noun}</legend>
      <CreateResourceForm
        moduleId={owner}
        kind={{ kind: bareKind(kind), name: kindDefinition?.name ?? noun, schema: kindDefinition?.schema }}
        onCreate={async (resourceInstanceId, displayName, settings) => {
          const created = await createInstance(toInstanceId(instanceId), {
            moduleName: owner,
            kind: bareKind(kind),
            resourceInstanceId,
            displayName,
            settings,
          });
          createdRef.current = {
            canonicalId: created.canonicalId,
            displayName: created.displayName,
            moduleName: owner,
            kind: bareKind(kind),
          };
        }}
        onClose={() => {
          const created = createdRef.current;
          createdRef.current = null;
          if (created) {
            onCreated(created);
          } else {
            onCancel();
          }
        }}
      />
    </fieldset>
  );
}
