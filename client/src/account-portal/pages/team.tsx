import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import Team from "@/pages/team";
import { useOptionalOrganization } from "../organization-context";
import { ACCOUNT_PORTAL_PATH } from "../portal-pages";
import { TeamMembers } from "./team-members";

export const TEAM_PATH = `${ACCOUNT_PORTAL_PATH}/team`;

type TeamView = "organization" | "engine";

const VIEW_LABELS: Record<TeamView, string> = { organization: "Organization", engine: "Engine access" };

/**
 * One Team page for both halves of "who can do what": the organization's members and roles, and who can open the
 * selected engine, with its invitations. A viewer who cannot manage members, or has no organization, has only the
 * engine half.
 */
export default function TeamPage() {
  const organization = useOptionalOrganization()?.organization ?? null;
  const [view, setView] = useState<TeamView>("organization");
  if (organization === null || !organization.can.manageMembers) {
    return <Team basePath={TEAM_PATH} />;
  }
  return (
    <div className="space-y-6">
      <ToggleGroup
        type="single"
        value={view}
        onValueChange={(value) => setView(value === "" ? view : (value as TeamView))}
        aria-label="Team view"
        data-testid="toggle-team-view"
      >
        {(Object.keys(VIEW_LABELS) as TeamView[]).map((option) => (
          <ToggleGroupItem key={option} value={option} data-testid={`toggle-team-view-${option}`}>
            {VIEW_LABELS[option]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {view === "organization" ? <TeamMembers /> : <Team basePath={TEAM_PATH} />}
    </div>
  );
}
