import { CircleAlert } from "lucide-react";

/** The problems reported at one field, under it, in the destructive colour. Renders nothing when there are none. */
export function FieldProblems({ messages }: { messages: readonly string[] }) {
  if (messages.length === 0) {
    return null;
  }
  return (
    <ul className="space-y-0.5" data-testid="field-problems">
      {messages.map((message) => (
        <li key={message} className="flex items-start gap-1.5 text-xs text-destructive">
          <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{message}</span>
        </li>
      ))}
    </ul>
  );
}
