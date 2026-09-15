import { useState } from "react";
import { TestEventForm, type TestEventProps } from "@/components/test-events/test-event-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { TwitchCheerPayload } from "@/lib/debug/twitch-events";

interface FormState {
  amount: number;
  message: string;
  userId: string;
  userName: string;
  isAnonymous: boolean;
}

const DEFAULTS: FormState = {
  amount: 100,
  message: "Cheer100 nice stream!",
  userId: "12345",
  userName: "test_cheerer",
  isAnonymous: false,
};

function toPayload(state: FormState): TwitchCheerPayload {
  return {
    amount: state.amount,
    isAnonymous: state.isAnonymous,
    message: state.message,
    userId: state.isAnonymous ? null : state.userId,
    userName: state.isAnonymous ? null : state.userName,
  };
}

export function TwitchCheerForm({ preset }: TestEventProps) {
  const [state, setState] = useState<FormState>(DEFAULTS);

  return (
    <TestEventForm preset={preset} payload={toPayload(state)}>
      <div className="space-y-2">
        <Label htmlFor="cheer-amount">Bits</Label>
        <Input
          id="cheer-amount"
          type="number"
          min={0}
          value={state.amount}
          onChange={(e) => setState({ ...state, amount: Math.max(0, Number(e.target.value) || 0) })}
          data-testid="input-cheer-amount"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cheer-message">Message</Label>
        <Input
          id="cheer-message"
          value={state.message}
          onChange={(e) => setState({ ...state, message: e.target.value })}
          data-testid="input-cheer-message"
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="cheer-anon">Anonymous</Label>
        <Switch
          id="cheer-anon"
          checked={state.isAnonymous}
          onCheckedChange={(checked) => setState({ ...state, isAnonymous: checked })}
          data-testid="switch-cheer-anon"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cheer-userId">User ID</Label>
        <Input
          id="cheer-userId"
          value={state.userId}
          disabled={state.isAnonymous}
          onChange={(e) => setState({ ...state, userId: e.target.value })}
          data-testid="input-cheer-userId"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cheer-userName">User name</Label>
        <Input
          id="cheer-userName"
          value={state.userName}
          disabled={state.isAnonymous}
          onChange={(e) => setState({ ...state, userName: e.target.value })}
          data-testid="input-cheer-userName"
        />
      </div>
    </TestEventForm>
  );
}
