import { useEffect, useRef, useState } from "react";
import { appendChatLine, type DuckHopChatLine, type DuckHopEvent, pickChatLine } from "@/lib/duck-hop";

interface StreamChatProps {
  event: DuckHopEvent | null;
}

/**
 * A pretend chat for the wait room, reacting to what the duck does. It is
 * decoration, so it stays out of the accessibility tree; the live game status
 * carries the same information for anyone who cannot see it.
 */
export function StreamChat({ event }: StreamChatProps) {
  const [lines, setLines] = useState<readonly DuckHopChatLine[]>([]);
  const lastSequence = useRef(0);

  useEffect(() => {
    if (event === null || event.sequence <= lastSequence.current) {
      return;
    }
    lastSequence.current = event.sequence;
    setLines((previous) => {
      const text = pickChatLine(
        event,
        previous.map((line) => line.text)
      );
      return appendChatLine(previous, text, event.sequence);
    });
  }, [event]);

  return (
    <aside
      aria-hidden="true"
      className="flex max-h-40 min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/60 text-xs"
      data-testid="stream-chat"
    >
      <p className="shrink-0 border-b border-neutral-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        Stream chat
      </p>
      {lines.length === 0 ? (
        <p className="px-3 py-2 text-neutral-600">It&apos;s quiet. Hop and see who shows up.</p>
      ) : (
        <ol className="space-y-1 overflow-hidden px-3 py-2" data-testid="stream-chat-lines">
          {lines.map((line) => (
            <li key={line.sequence} className="truncate motion-safe:animate-in motion-safe:fade-in">
              <span className="font-semibold text-neutral-400">{line.author}</span>{" "}
              <span className="text-neutral-300">{line.text}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
