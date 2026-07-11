import type { ReactNode } from "react";
import { useState } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

interface TriggerCardProps {
  title: string;
  description: string;
  eventSubject: string;
  children: ReactNode;
  onFire: () => Promise<void>;
}

export function TriggerCard({ title, description, eventSubject, children, onFire }: TriggerCardProps) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      await onFire();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid={`trigger-card-${eventSubject}`}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {description}
          <span className="block mt-1 font-mono text-xs text-muted-foreground/80">{eventSubject}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
      <CardFooter>
        <Button onClick={handleClick} disabled={busy} className="gap-2">
          <Zap className="h-4 w-4" />
          {busy ? "Firing..." : "Fire"}
        </Button>
      </CardFooter>
    </Card>
  );
}
