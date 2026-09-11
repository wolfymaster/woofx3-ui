import { useState } from "react";
import { TriggerCard } from "@/components/debug/trigger-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSimulateTwitchEvent } from "@/hooks/use-simulate-twitch-event";
import { TWITCH_EVENT_SUBJECTS, type TwitchSubscribePayload } from "@/lib/debug/twitch-events";

const DEFAULTS: TwitchSubscribePayload = {
  isGift: false,
  tier: "1000",
  userId: "12345",
  userName: "test_subscriber",
};

export function TwitchSubscribeForm() {
  const fire = useSimulateTwitchEvent();
  const [payload, setPayload] = useState<TwitchSubscribePayload>(DEFAULTS);

  return (
    <TriggerCard
      title="Subscription"
      description="Simulate a channel subscription."
      eventSubject={TWITCH_EVENT_SUBJECTS.subscribe}
      onFire={() => fire(TWITCH_EVENT_SUBJECTS.subscribe, payload as unknown as Record<string, unknown>)}
    >
      <div className="space-y-2">
        <Label htmlFor="sub-tier">Tier</Label>
        <Select value={payload.tier} onValueChange={(value) => setPayload({ ...payload, tier: value })}>
          <SelectTrigger id="sub-tier" data-testid="select-sub-tier">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1000">Tier 1 (1000)</SelectItem>
            <SelectItem value="2000">Tier 2 (2000)</SelectItem>
            <SelectItem value="3000">Tier 3 (3000)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="sub-isGift">Gift</Label>
        <Switch
          id="sub-isGift"
          checked={payload.isGift}
          onCheckedChange={(checked) => setPayload({ ...payload, isGift: checked })}
          data-testid="switch-sub-isGift"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sub-userId">User ID</Label>
        <Input
          id="sub-userId"
          value={payload.userId ?? ""}
          onChange={(e) => setPayload({ ...payload, userId: e.target.value })}
          data-testid="input-sub-userId"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sub-userName">User name</Label>
        <Input
          id="sub-userName"
          value={payload.userName ?? ""}
          onChange={(e) => setPayload({ ...payload, userName: e.target.value })}
          data-testid="input-sub-userName"
        />
      </div>
    </TriggerCard>
  );
}
