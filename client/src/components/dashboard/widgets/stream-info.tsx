import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  lengthCounter,
  MAX_MARKER_DESCRIPTION_LENGTH,
  MAX_PRESET_NAME_LENGTH,
  STREAM_INFO_SCOPE,
  type StreamInfo,
  titleCounter,
} from "@convex/lib/streamInfo";
import { useAction, useMutation, useQuery } from "convex/react";
import { Bookmark, Check, Flag, Loader2, Radio, RotateCcw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { comparePreset, draftProblem, formatStreamPosition, isDirty, rebaseDraft } from "@/lib/stream-info-edit";
import { cn } from "@/lib/utils";
import { CategoryBoxArt, CategoryPicker } from "./stream-info-category-picker";
import { TagEditor } from "./stream-info-tag-editor";

/** Twitch pushes nothing when the title changes from its own dashboard, so the card polls. */
const REFRESH_MS = 60_000;

interface EditState {
  /** What Twitch holds, or what it is being told to hold while a save is in flight. */
  saved: StreamInfo;
  draft: StreamInfo;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Counter({ counter }: { counter: { length: number; max: number; over: boolean; near: boolean } }) {
  return (
    <span
      className={cn(
        "shrink-0 text-[10px] tabular-nums",
        counter.over ? "text-destructive" : counter.near ? "text-amber-500" : "text-muted-foreground"
      )}
    >
      {counter.length}/{counter.max}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{children}</span>;
}

export function StreamInfoWidget() {
  const { instance } = useInstance();
  const instanceId = instance?._id;

  const platformLinks = useQuery(api.instances.getPlatformLinks, instanceId ? { instanceId } : "skip");
  const twitchLink = platformLinks?.find((link) => link.platform === "twitch");
  const canManage = !!twitchLink?.scopes.includes(STREAM_INFO_SCOPE);

  if (platformLinks !== undefined && !twitchLink) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <Radio className="mb-3 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">Connect Twitch in Settings to edit your stream info</p>
      </div>
    );
  }
  if (platformLinks !== undefined && !canManage) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <Radio className="mb-3 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          Your Twitch connection is missing the "{STREAM_INFO_SCOPE}" permission. Reconnect Twitch in Settings →
          Integrations to grant it.
        </p>
      </div>
    );
  }
  if (!instanceId || platformLinks === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <StreamInfoEditor instanceId={instanceId} />;
}

function StreamInfoEditor({ instanceId }: { instanceId: Id<"instances"> }) {
  const { toast } = useToast();
  const getChannelInfo = useAction(api.streamInfo.getChannelInfo);
  const updateChannelInfo = useAction(api.streamInfo.updateChannelInfo);

  const [edit, setEdit] = useState<EditState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Bumped by every save, so a poll that set off before the save cannot land
  // after it and put the old values back on screen.
  const generation = useRef(0);

  const refresh = useCallback(() => {
    const started = generation.current;
    getChannelInfo({ instanceId })
      .then((fresh) => {
        if (started !== generation.current) {
          return;
        }
        setEdit((prev) =>
          prev ? { saved: fresh, draft: rebaseDraft(prev.saved, prev.draft, fresh) } : { saved: fresh, draft: fresh }
        );
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (started === generation.current) {
          setLoadError(errorMessage(error));
        }
      });
  }, [instanceId, getChannelInfo]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useVisibleInterval(refresh, REFRESH_MS, !saving);

  /**
   * Shows `next` straight away and puts the previous state back if Twitch
   * refuses. Inputs are disabled while this runs, so the rollback cannot
   * discard anything typed after the save began.
   */
  const save = async (next: StreamInfo, successTitle: string) => {
    if (!edit || saving) {
      return;
    }
    const before = edit;
    generation.current += 1;
    setEdit({ saved: next, draft: next });
    setSaving(true);
    try {
      const result = await updateChannelInfo({
        instanceId,
        title: next.title,
        category: next.category,
        tags: next.tags,
      });
      generation.current += 1;
      setEdit({ saved: result, draft: result });
      toast({ title: successTitle });
    } catch (error) {
      generation.current += 1;
      setEdit(before);
      toast({ title: "Couldn't update stream info", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!edit) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        {loadError ? (
          <>
            <p className="text-xs text-destructive">{loadError}</p>
            <Button size="sm" variant="outline" onClick={refresh}>
              Try again
            </Button>
          </>
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>
    );
  }

  const { saved, draft } = edit;
  const dirty = isDirty(saved, draft);
  const problem = draftProblem(draft);
  const setDraft = (patch: Partial<StreamInfo>) => {
    setEdit((prev) => (prev ? { ...prev, draft: { ...prev.draft, ...patch } } : prev));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-auto p-3">
        <section className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>Title</SectionLabel>
            <Counter counter={titleCounter(draft.title)} />
          </div>
          <Input
            value={draft.title}
            onChange={(e) => setDraft({ title: e.target.value })}
            placeholder="Stream title"
            className="h-8 text-sm"
            disabled={saving}
            aria-label="Stream title"
            data-testid="input-stream-info-title"
          />
        </section>

        <section className="space-y-1.5">
          <SectionLabel>Category</SectionLabel>
          <CategoryPicker
            instanceId={instanceId}
            value={draft.category}
            onChange={(category) => setDraft({ category })}
            disabled={saving}
          />
        </section>

        <section className="space-y-1.5">
          <SectionLabel>Tags</SectionLabel>
          <TagEditor tags={draft.tags} onChange={(tags) => setDraft({ tags })} disabled={saving} />
        </section>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => void save(draft, "Stream info updated")}
              disabled={saving || !dirty || problem !== null}
              data-testid="button-stream-info-save"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setEdit({ saved, draft: saved })}
              disabled={saving || !dirty}
              data-testid="button-stream-info-revert"
            >
              <RotateCcw className="h-4 w-4" />
              Revert
            </Button>
          </div>
          {dirty && problem && <p className="text-xs text-destructive">{problem}</p>}
        </div>

        <PresetsSection
          instanceId={instanceId}
          current={saved}
          draft={draft}
          draftProblem={problem}
          busy={saving}
          onApply={(info, name) => void save(info, `Applied "${name}"`)}
        />

        <MarkerSection instanceId={instanceId} />
      </div>
    </div>
  );
}

interface PresetsSectionProps {
  instanceId: Id<"instances">;
  current: StreamInfo;
  draft: StreamInfo;
  draftProblem: string | null;
  busy: boolean;
  onApply: (info: StreamInfo, name: string) => void;
}

function PresetsSection({ instanceId, current, draft, draftProblem, busy, onApply }: PresetsSectionProps) {
  const { toast } = useToast();
  const presets = useQuery(api.streamInfo.listPresets, { instanceId });
  const savePreset = useMutation(api.streamInfo.savePreset);
  const removePreset = useMutation(api.streamInfo.removePreset).withOptimisticUpdate((localStore, args) => {
    const list = localStore.getQuery(api.streamInfo.listPresets, { instanceId });
    if (list) {
      localStore.setQuery(
        api.streamInfo.listPresets,
        { instanceId },
        list.filter((preset) => preset.id !== args.presetId)
      );
    }
  });
  const [name, setName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);

  const trimmedName = name.trim();
  const replaces = presets?.some((preset) => preset.name === trimmedName) ?? false;

  const handleSave = async () => {
    if (!trimmedName || draftProblem) {
      return;
    }
    setSavingPreset(true);
    try {
      await savePreset({
        instanceId,
        name: trimmedName,
        title: draft.title,
        category: draft.category,
        tags: draft.tags,
      });
      setName("");
      toast({ title: replaces ? `Updated "${trimmedName}"` : `Saved "${trimmedName}"` });
    } catch (error) {
      toast({ title: "Couldn't save preset", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSavingPreset(false);
    }
  };

  const handleRemove = (presetId: Id<"streamInfoPresets">) => {
    removePreset({ instanceId, presetId }).catch((error: unknown) => {
      toast({ title: "Couldn't delete preset", description: errorMessage(error), variant: "destructive" });
    });
  };

  return (
    <section className="space-y-1.5">
      <SectionLabel>Saved presets</SectionLabel>
      {presets === undefined ? (
        <div className="flex justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : presets.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Save the title, category and tags above as a preset to switch back to them in one click.
        </p>
      ) : (
        <ul className="space-y-1">
          {presets.map((preset) => {
            const comparison = comparePreset(current, preset.info);
            return (
              <li key={preset.id} className="flex items-center gap-1" data-testid={`stream-info-preset-${preset.id}`}>
                <button
                  type="button"
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border p-1.5 text-left",
                    comparison.active ? "border-primary/50 bg-primary/5" : "hover:bg-accent",
                    "disabled:cursor-not-allowed disabled:opacity-60"
                  )}
                  onClick={() => onApply(preset.info, preset.name)}
                  disabled={busy || comparison.active}
                  title={comparison.summary}
                  aria-label={`Apply preset ${preset.name}: ${comparison.summary}`}
                >
                  <CategoryBoxArt category={preset.info.category} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{preset.name}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{preset.info.title}</span>
                  </span>
                  {comparison.active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemove(preset.id)}
                  aria-label={`Delete preset ${preset.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, MAX_PRESET_NAME_LENGTH))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSave();
            }
          }}
          placeholder="Preset name, e.g. Ranked grind"
          className="h-8 text-sm"
          aria-label="Preset name"
          data-testid="input-stream-info-preset-name"
        />
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5"
          onClick={() => void handleSave()}
          disabled={savingPreset || !trimmedName || draftProblem !== null}
          data-testid="button-stream-info-save-preset"
        >
          {savingPreset ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />}
          {replaces ? "Replace" : "Save"}
        </Button>
      </div>
      {trimmedName && replaces && (
        <p className="text-[10px] text-muted-foreground">Replaces the preset already called "{trimmedName}".</p>
      )}
    </section>
  );
}

function MarkerSection({ instanceId }: { instanceId: Id<"instances"> }) {
  const { toast } = useToast();
  const createMarker = useAction(api.streamInfo.createMarker);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counter = lengthCounter(description, MAX_MARKER_DESCRIPTION_LENGTH);

  const handleAdd = async () => {
    if (counter.over) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const marker = await createMarker({ instanceId, description: description.trim() || undefined });
      setDescription("");
      toast({
        title: "Marker added",
        description:
          marker.positionSeconds === null ? undefined : `At ${formatStreamPosition(marker.positionSeconds)} in the VOD`,
      });
    } catch (err) {
      // Inline rather than a toast: "you're offline" is the common answer, and
      // it should sit next to the button until the next try.
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Stream marker</SectionLabel>
        <Counter counter={counter} />
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleAdd();
            }
          }}
          placeholder="What happened? (optional)"
          className="h-8 text-sm"
          aria-label="Marker description"
          data-testid="input-stream-info-marker"
        />
        <Button
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => void handleAdd()}
          disabled={busy || counter.over}
          data-testid="button-stream-info-add-marker"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
          Add marker
        </Button>
      </div>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
