import TeamInvite from "@/pages/team-invite";
import { TEAM_PATH } from "./team";

export const TEAM_INVITE_PATH = `${TEAM_PATH}/invite`;

export default function TeamInvitePage() {
  return <TeamInvite basePath={TEAM_PATH} />;
}
