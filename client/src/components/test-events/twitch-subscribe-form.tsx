import { useState } from "react";
import { TestEventForm, type TestEventProps } from "@/components/test-events/test-event-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { TwitchSubscribePayload } from "@/lib/debug/twitch-events";

const DEFAULTS: TwitchSubscribePayload = {
  isGift: false,
  tier: "1000",
  userId: "12345",
  userName: "test_subscriber",
};

export function TwitchSubscribeForm({ preset }: TestEventProps) {
  const [payload, setPayload] = useState<TwitchSubscribePayload>(DEFAULTS);

  return (
    <TestEventForm preset={preset} payload={payload}>
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
    </TestEventForm>
  );
}
