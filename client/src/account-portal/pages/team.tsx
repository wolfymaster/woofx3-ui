import Team from "@/pages/team";
import { ACCOUNT_PORTAL_PATH } from "../portal-pages";

export const TEAM_PATH = `${ACCOUNT_PORTAL_PATH}/team`;

export default function TeamPage() {
  return <Team basePath={TEAM_PATH} />;
}
