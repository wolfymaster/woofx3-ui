import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const SPONSOR_START_PATH = "/sponsor/start";

interface SponsorshipSlotProps {
  title: string;
  description: string;
  testId: string;
}

/** Where a viewer's own sponsorship shows; until they sponsor, a pitch and a way to start. */
export function SponsorshipSlot({ title, description, testId }: SponsorshipSlotProps) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href={SPONSOR_START_PATH} data-testid="link-become-sponsor">
            Become a sponsor
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
