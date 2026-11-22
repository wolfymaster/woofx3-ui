import { PageHeader } from "@/components/layout/page-header";
import { EngineList } from "./engine-list";

/** Every woofx3 of the selected organization; each one's page is behind its Manage button. */
export default function EnginesPage() {
  return (
    <>
      <PageHeader title="Your woofx3" />
      <EngineList />
    </>
  );
}
