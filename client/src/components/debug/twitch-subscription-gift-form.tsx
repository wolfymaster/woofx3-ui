import { useState } from "react";
import { TriggerCard } from "@/components/debug/trigger-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFireTrigger } from "@/hooks/use-fire-trigger";
import { TWITCH_EVENT_SUBJECTS, type TwitchSubscriptionGiftPayload } from "@/lib/debug/twitch-events";

const DEFAULTS: TwitchSubscriptionGiftPayload = {
  amount: 5,
  gifterId: "12345",
  gifterName: "test_gifter",
  isAnonymous: false,
  tier: "1000",
};

export function TwitchSubscriptionGiftForm() {
  const fire = useFireTrigger();
  const [payload, setPayload] = useState<TwitchSubscriptionGiftPayload>(DEFAULTS);

  return (
    <TriggerCard
      title="Subscription Gift"
      description="Simulate a bulk-gifted-subs event."
      eventSubject={TWITCH_EVENT_SUBJECTS.subscriptionGift}
      onFire={() =>
        fire(TWITCH_EVENT_SUBJECTS.subscriptionGift, payload as unknown as Record<string, unknown>)
      }
    >
      <div className="space-y-2">
        <Label htmlFor="gift-amount">Subs gifted</Label>
        <Input
          id="gift-amount"
          type="number"
          min={1}
          value={payload.amount}
          onChange={(e) => setPayload({ ...payload, amount: Math.max(1, Number(e.target.value) || 1) })}
          data-testid="input-gift-amount"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="gift-tier">Tier</Label>
        <Select value={payload.tier} onValueChange={(value) => setPayload({ ...payload, tier: value })}>
          <SelectTrigger id="gift-tier" data-testid="select-gift-tier">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1000">Tier 1 (1000)</SelectItem>
            <SelectItem value="2000">Tier 2 (2000)</SelectItem>
            <SelectItem value="3000">Tier 3 (3000)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="gift-gifterId">Gifter ID</Label>
        <Input
          id="gift-gifterId"
          value={payload.gifterId}
          onChange={(e) => setPayload({ ...payload, gifterId: e.target.value })}
          data-testid="input-gift-gifterId"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="gift-gifterName">Gifter name</Label>
        <Input
          id="gift-gifterName"
          value={payload.gifterName}
          onChange={(e) => setPayload({ ...payload, gifterName: e.target.value })}
          data-testid="input-gift-gifterName"
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="gift-isAnonymous">Anonymous</Label>
        <Switch
          id="gift-isAnonymous"
          checked={payload.isAnonymous}
          onCheckedChange={(checked) => setPayload({ ...payload, isAnonymous: checked })}
          data-testid="switch-gift-isAnonymous"
        />
      </div>
    </TriggerCard>
  );
}
