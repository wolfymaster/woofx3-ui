import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export function FeedbackBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      data-testid="link-feedback-back"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </Link>
  );
}
