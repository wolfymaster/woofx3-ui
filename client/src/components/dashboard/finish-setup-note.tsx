import { Link } from "wouter";

/** What a widget or page shows while there is no woofx3 to read from yet. */
export function FinishSetupNote() {
  return (
    <p className="text-sm text-muted-foreground" data-testid="finish-setup-note">
      <Link href="/setup/finish" className="text-primary underline-offset-2 hover:underline">
        Finish setup
      </Link>{" "}
      to see this.
    </p>
  );
}
