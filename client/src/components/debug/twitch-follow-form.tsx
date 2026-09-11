import { useState } from "react";
import { TriggerCard } from "@/components/debug/trigger-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSimulateTwitchEvent } from "@/hooks/use-simulate-twitch-event";
import { TWITCH_EVENT_SUBJECTS, type TwitchFollowPayload } from "@/lib/debug/twitch-events";

const DEFAULTS: TwitchFollowPayload = {
  userName: "test_follower",
};

export function TwitchFollowForm() {
  const fire = useSimulateTwitchEvent();
  const [payload, setPayload] = useState<TwitchFollowPayload>(DEFAULTS);

  return (
    <TriggerCard
      title="Follow"
      description="Simulate a new channel follow."
      eventSubject={TWITCH_EVENT_SUBJECTS.follow}
      onFire={() => fire(TWITCH_EVENT_SUBJECTS.follow, payload as unknown as Record<string, unknown>)}
    >
      <div className="space-y-2">
        <Label htmlFor="follow-userName">User name</Label>
        <Input
          id="follow-userName"
          value={payload.userName}
          onChange={(e) => setPayload({ ...payload, userName: e.target.value })}
          data-testid="input-follow-userName"
        />
      </div>
    </TriggerCard>
  );
}
