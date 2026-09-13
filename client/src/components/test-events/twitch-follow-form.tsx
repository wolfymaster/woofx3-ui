import { useState } from "react";
import { TestEventForm, type TestEventProps } from "@/components/test-events/test-event-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TwitchFollowPayload } from "@/lib/debug/twitch-events";

const DEFAULTS: TwitchFollowPayload = {
  userName: "test_follower",
};

export function TwitchFollowForm({ preset }: TestEventProps) {
  const [payload, setPayload] = useState<TwitchFollowPayload>(DEFAULTS);

  return (
    <TestEventForm preset={preset} payload={payload}>
      <div className="space-y-2">
        <Label htmlFor="follow-userName">User name</Label>
        <Input
          id="follow-userName"
          value={payload.userName}
          onChange={(e) => setPayload({ ...payload, userName: e.target.value })}
          data-testid="input-follow-userName"
        />
      </div>
    </TestEventForm>
  );
}
