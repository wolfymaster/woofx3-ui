import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EditorBackLinkProps {
  /** Where the arrow goes, named for the screen reader: "Back to {label}". */
  label: string;
  onClick: () => void;
}

/** The arrow out of a full-page editor, sized for touch on a phone and tighter on desktop. */
export function EditorBackLink({ label, onClick }: EditorBackLinkProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-11 w-11 shrink-0 lg:h-10 lg:w-10"
      onClick={onClick}
      aria-label={`Back to ${label}`}
    >
      <ArrowLeft className="h-4 w-4" />
    </Button>
  );
}
