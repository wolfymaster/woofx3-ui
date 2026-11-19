import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import TeamInvite from "@/pages/team-invite";
import { useOrganization } from "../organization-context";
import { TEAM_PATH } from "./team";

export const TEAM_INVITE_PATH = `${TEAM_PATH}/invite`;

/** An invitation is to one engine of the selected organization; the person picks which before the usual form. */
export default function TeamInvitePage() {
  const { organization } = useOrganization();
  const [engineId, setEngineId] = useState(organization.engines[0]?.instanceId ?? null);
  return (
    <div className="space-y-4">
      {organization.engines.length > 1 ? (
        <div className="mx-auto max-w-2xl space-y-2 px-6 lg:px-8">
          <Label>Engine</Label>
          <Select value={engineId ?? undefined} onValueChange={(id) => setEngineId(id as typeof engineId)}>
            <SelectTrigger data-testid="select-invite-engine">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {organization.engines.map((engine) => (
                <SelectItem key={engine.instanceId} value={engine.instanceId}>
                  {engine.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <TeamInvite basePath={TEAM_PATH} engineId={engineId} />
    </div>
  );
}
