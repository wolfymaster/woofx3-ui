import { api } from "@convex/_generated/api";
import type { InstanceNote } from "@convex/dashboardNotes";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useInstance } from "@/hooks/use-instance";

const SAVE_DEBOUNCE_MS = 800;

function lastEditLabel(note: InstanceNote | null): string {
  if (!note || note.updatedByMe || !note.updatedByName) {
    return "Shared with your team · saved automatically";
  }
  const when = new Date(note.updatedAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Last edited by ${note.updatedByName} · ${when}`;
}

/**
 * Freeform scratch pad, one per instance and shared by its members. Saves on a
 * debounce while typing, and flushes any pending edit on unmount so closing
 * the rail flyout mid-sentence doesn't drop the last keystrokes.
 *
 * Another member's save replaces the text on screen only while this widget has
 * no edit of its own waiting to be saved, so it never overwrites what is being
 * typed. Two people typing at once is last write wins, and the footer says
 * whose write that was.
 */
export function NotesWidget() {
  const { instance } = useInstance();
  const stored = useQuery(api.dashboardNotes.get, instance ? { instanceId: instance._id } : "skip");
  const saveNotes = useMutation(api.dashboardNotes.save);

  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors what's actually in flight/typed so the unmount flush can read it
  // without re-running the effect on every keystroke.
  const pendingRef = useRef<string | null>(null);
  const saveRef = useRef(saveNotes);
  saveRef.current = saveNotes;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const remoteContent = stored === undefined ? undefined : (stored?.content ?? "");

  useEffect(() => {
    if (remoteContent === undefined || pendingRef.current !== null) {
      return;
    }
    // Restores the caret so a remote edit landing while the note is focused
    // does not throw it to the end of the text.
    const textarea = textareaRef.current;
    const caret = textarea && document.activeElement === textarea ? textarea.selectionStart : null;
    setDraft(remoteContent);
    if (caret !== null) {
      requestAnimationFrame(() => {
        const position = Math.min(caret, remoteContent.length);
        textareaRef.current?.setSelectionRange(position, position);
      });
    }
  }, [remoteContent]);

  const instanceId = instance?._id;

  // Flush on unmount (and on instance switch) so closing the flyout mid-sentence
  // doesn't drop the last keystrokes. Reads pendingRef rather than `draft` so it
  // isn't re-armed on every character typed.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      const pending = pendingRef.current;
      if (pending !== null && instanceId) {
        void saveRef.current({ instanceId, content: pending });
        pendingRef.current = null;
      }
    };
  }, [instanceId]);

  const handleChange = (value: string) => {
    setDraft(value);
    pendingRef.current = value;
    if (!instanceId) {
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setSaving(true);
      void saveRef.current({ instanceId, content: value }).finally(() => {
        // Only this save's text: anything typed while it was in flight is
        // still waiting for its own save, and must keep remote edits out.
        if (pendingRef.current === value) {
          pendingRef.current = null;
        }
        setSaving(false);
      });
    }, SAVE_DEBOUNCE_MS);
  };

  if (!instance) {
    return (
      <div className="h-full flex items-center justify-center p-4 text-sm text-muted-foreground">
        Select an instance to take notes.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <Textarea
        ref={textareaRef}
        value={draft ?? ""}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Anything worth remembering this stream… Everyone on this account sees these notes."
        className="flex-1 min-h-0 resize-none border-0 rounded-none focus-visible:ring-0 text-sm"
        data-testid="input-dashboard-notes"
      />
      <div className="shrink-0 px-3 py-1.5 border-t border-border text-[10px] uppercase tracking-wider text-muted-foreground">
        {saving ? "Saving…" : lastEditLabel(stored ?? null)}
      </div>
    </div>
  );
}
