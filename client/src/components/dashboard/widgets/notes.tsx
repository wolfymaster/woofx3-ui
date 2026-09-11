import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useInstance } from "@/hooks/use-instance";

const SAVE_DEBOUNCE_MS = 800;

/**
 * Freeform scratch pad, per user and per instance. Saves on a debounce while
 * typing, and flushes any pending edit on unmount so closing the rail flyout
 * mid-sentence doesn't drop the last keystrokes.
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

  // Adopt the server value once, then let local state own the text — otherwise
  // a reactive echo of our own save would fight the cursor position.
  useEffect(() => {
    if (draft === null && stored !== undefined) {
      setDraft(stored?.content ?? "");
    }
  }, [stored, draft]);

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
        pendingRef.current = null;
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
        value={draft ?? ""}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Anything worth remembering this stream…"
        className="flex-1 min-h-0 resize-none border-0 rounded-none focus-visible:ring-0 text-sm"
        data-testid="input-dashboard-notes"
      />
      <div className="shrink-0 px-3 py-1.5 border-t border-border text-[10px] uppercase tracking-wider text-muted-foreground">
        {saving ? "Saving…" : "Saved automatically"}
      </div>
    </div>
  );
}
