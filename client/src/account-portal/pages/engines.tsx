import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "../organization-context";
import { EngineList } from "./engine-list";

/** Every engine of the selected organization; each one's page is behind its Manage button. */
export default function EnginesPage() {
  const { organization } = useOrganization();
  return (
    <>
      <PageHeader title="Engines" description={`The engines ${organization.name} runs.`} />
      <EngineList />
    </>
  );
}
