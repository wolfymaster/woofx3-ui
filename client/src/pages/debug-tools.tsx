import { useState } from "react";
import { useMutation } from "convex/react";
import { Bug, Send, Clock, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@convex/_generated/api";
import { useInstance } from "@/hooks/use-instance";

const EVENT_TYPES = [
  { value: "channel.follow", label: "Follow" },
  { value: "channel.subscribe", label: "Subscribe" },
  { value: "channel.cheer", label: "Cheer" },
  { value: "channel.raid", label: "Raid" },
  { value: "channel.channel_points_custom_reward_redemption.add", label: "Channel Points" },
  { value: "channel.hype_train.begin", label: "Hype Train" },
];

interface EventHistoryEntry {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  sentAt: string;
  success: boolean;
  errorMessage?: string;
}

export default function DebugTools() {
  const { instance } = useInstance();
  const [eventType, setEventType] = useState("channel.follow");
  const [username, setUsername] = useState("testuser");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<EventHistoryEntry[]>([]);
  const [isSending, setIsSending] = useState(false);

  const sendTestEvent = useMutation(api.debug.sendTestEvent);

  const handleSendEvent = async () => {
    if (!instance) return;
    setIsSending(true);

    const payload: Record<string, unknown> = {
      user_name: username,
      ...(amount ? { amount: parseInt(amount, 10) } : {}),
      ...(message ? { message } : {}),
    };

    try {
      await sendTestEvent({
        instanceId: instance._id,
        eventType,
        payload,
      });

      setHistory((prev) => [
        {
          id: Date.now().toString(),
          eventType,
          payload,
          sentAt: new Date().toLocaleTimeString(),
          success: true,
        },
        ...prev,
      ]);
    } catch (error) {
      setHistory((prev) => [
        {
          id: Date.now().toString(),
          eventType,
          payload,
          sentAt: new Date().toLocaleTimeString(),
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        },
        ...prev,
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <Bug className="h-5 w-5" />
        <h1 className="text-lg font-semibold">Debug Tools</h1>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-2xl mx-auto space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-medium mb-4">Simulate Twitch Event</h2>
            <div className="space-y-4">
              <div>
                <Label htmlFor="event-type">Event Type</Label>
                <Select value={eventType} onValueChange={setEventType}>
                  <SelectTrigger id="event-type">
                    <SelectValue placeholder="Select event type" />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                />
              </div>

              {(eventType === "channel.cheer" || eventType === "channel.raid") && (
                <div>
                  <Label htmlFor="amount">Amount</Label>
                  <Input
                    id="amount"
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Enter amount"
                  />
                </div>
              )}

              {eventType === "channel.cheer" && (
                <div>
                  <Label htmlFor="message">Message</Label>
                  <Input
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Enter message"
                  />
                </div>
              )}

              <Button
                onClick={handleSendEvent}
                disabled={isSending || !instance}
                className="w-full"
              >
                <Send className="h-4 w-4 mr-2" />
                {isSending ? "Sending..." : "Send Test Event"}
              </Button>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-medium mb-4">Event History</h2>
            <div className="space-y-2">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between p-3 rounded-md bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    {entry.success ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <div>
                      <span className="text-sm font-medium">{entry.eventType}</span>
                      {entry.errorMessage && (
                        <p className="text-xs text-red-500">{entry.errorMessage}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {entry.sentAt}
                  </div>
                </div>
              ))}
              {history.length === 0 && (
                <div className="text-center text-muted-foreground py-8">
                  No events sent yet
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
