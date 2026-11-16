import type { SponsorshipTerms } from "@convex/lib/billingClient";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { amountProblem, parseDollars } from "./amount";

interface AmountFieldProps {
  id: string;
  text: string;
  onTextChange: (text: string) => void;
  terms: SponsorshipTerms;
  testId: string;
}

/** A dollar amount the plane's terms are checked against as it is typed. */
export function AmountField({ id, text, onTextChange, terms, testId }: AmountFieldProps) {
  const problem = amountProblem(parseDollars(text), terms);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Amount (USD)</Label>
      <Input
        id={id}
        inputMode="decimal"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        aria-invalid={problem !== null}
        data-testid={testId}
      />
      {problem === null ? null : (
        <p className="text-sm text-destructive" data-testid={`${testId}-problem`}>
          {problem}
        </p>
      )}
    </div>
  );
}
