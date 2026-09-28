import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { BLOCKED_TERM_MAX_LENGTH, type CapabilityStatus, validateBlockedTerm } from "@convex/lib/moderation";
import { useAction } from "convex/react";
import { Ban, ChevronRight, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { actionErrorMessage } from "@/lib/action-error";
import { cn } from "@/lib/utils";
import { CapabilityNote, SectionHeading } from "./moderation-shared";

interface BlockedTerm {
  id: string;
  text: string;
}

export function BlockedTermsSection({
  instanceId,
  addStatus,
  removeStatus,
}: {
  instanceId: Id<"instances">;
  addStatus: CapabilityStatus;
  removeStatus: CapabilityStatus;
}) {
  const listBlockedTerms = useAction(api.moderation.listBlockedTerms);
  const addBlockedTerm = useAction(api.moderation.addBlockedTerm);
  const removeBlockedTerm = useAction(api.moderation.removeBlockedTerm);

  const [terms, setTerms] = useState<BlockedTerm[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  /** One removal at a time, so a double click cannot send the same DELETE twice. */
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Session-local, not persisted: the list is reference, the input is the point. */
  const [listOpen, setListOpen] = useState(false);

  const ready = addStatus === "ready";
  const canRemove = removeStatus === "ready";

  // Twitch pushes nothing when terms change, and the list is only needed when
  // opened or edited, so it loads once rather than on a timer.
  const load = useCallback(() => {
    listBlockedTerms({ instanceId })
      .then((result) => {
        setTerms(result.terms);
        setTruncated(result.truncated);
      })
      .catch((err: unknown) => setError(actionErrorMessage(err)));
  }, [instanceId, listBlockedTerms]);

  useEffect(() => {
    if (ready) {
      load();
    }
  }, [ready, load]);

  const handleAdd = async () => {
    const validated = validateBlockedTerm(draft);
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const added = await addBlockedTerm({ instanceId, text: validated.value });
      setTerms((current) => [added, ...(current ?? []).filter((term) => term.id !== added.id)]);
      setDraft("");
    } catch (err) {
      setError(actionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (termId: string) => {
    if (removingId !== null) {
      return;
    }
    setRemovingId(termId);
    setError(null);
    try {
      await removeBlockedTerm({ instanceId, termId });
      setTerms((current) => (current ?? []).filter((term) => term.id !== termId));
    } catch (err) {
      setError(actionErrorMessage(err));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section className="space-y-1.5" data-testid="moderation-blocked-terms">
      <SectionHeading>Block a phrase</SectionHeading>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void handleAdd();
        }}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, BLOCKED_TERM_MAX_LENGTH))}
          placeholder="Word or phrase, * for wildcard"
          className="h-8 text-sm"
          disabled={!ready}
          data-testid="input-blocked-term"
        />
        <Button
          type="submit"
          size="sm"
          className="h-8 gap-1.5"
          disabled={!ready || busy || !draft.trim()}
          data-testid="button-add-blocked-term"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
          Block
        </Button>
      </form>
      <CapabilityNote status={addStatus} capability="addBlockedTerm" />
      {error && <p className="text-xs text-destructive">{error}</p>}

      {ready && terms !== null && terms.length > 0 && (
        <Collapsible open={listOpen} onOpenChange={setListOpen}>
          <CollapsibleTrigger className="flex w-full items-center gap-1 text-[10px] tabular-nums text-muted-foreground hover:text-foreground">
            <ChevronRight className={cn("h-3 w-3 transition-transform", listOpen && "rotate-90")} />
            {terms.length}
            {truncated ? "+" : ""} blocked
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1.5">
            <ul className="flex flex-wrap gap-1.5">
              {terms.map((term) => (
                <li
                  key={term.id}
                  className={cn(
                    "flex max-w-full items-center gap-1 rounded-md border border-border py-0.5 pl-2 text-xs",
                    canRemove ? "pr-0.5" : "pr-2"
                  )}
                >
                  <span className="truncate">{term.text}</span>
                  {canRemove && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={removingId !== null}
                      onClick={() => void handleRemove(term.id)}
                      aria-label={`Unblock "${term.text}"`}
                      data-testid={`button-remove-blocked-term-${term.id}`}
                    >
                      {removingId === term.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <div className="pt-1.5">
              <CapabilityNote status={removeStatus} capability="removeBlockedTerm" />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}
