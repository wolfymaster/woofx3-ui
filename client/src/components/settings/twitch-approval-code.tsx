import { Button } from "@/components/ui/button";
import type { TwitchLinking } from "@/engine/types";

type AwaitingApproval = Extract<TwitchLinking, { status: "awaitingApproval" }>;

interface TwitchApprovalCodeProps {
  linking: TwitchLinking;
  onCancel: () => void;
}

/** The code to type on Twitch's activation page, shown while a link waits for approval. Nothing for a redirecting link. */
export function TwitchApprovalCode({ linking, onCancel }: TwitchApprovalCodeProps) {
  if (linking.status !== "awaitingApproval") {
    return null;
  }
  const { userCode, verificationUri }: AwaitingApproval = linking;
  return (
    <div className="space-y-2 rounded-lg border p-4 text-sm" data-testid="twitch-approval-code">
      <p>
        Open{" "}
        <a href={verificationUri} target="_blank" rel="noreferrer" className="underline">
          {verificationUri}
        </a>{" "}
        on any device and enter this code:
      </p>
      <p className="font-mono text-2xl tracking-widest" data-testid="text-twitch-user-code">
        {userCode}
      </p>
      <Button variant="outline" size="sm" onClick={onCancel} data-testid="button-cancel-twitch-link">
        Cancel
      </Button>
    </div>
  );
}
