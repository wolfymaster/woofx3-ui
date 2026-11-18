import { Redirect, useSearch } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { parseCheckoutReturn } from "@/lib/checkout-return";
import { useOptionalOrganization } from "../organization-context";
import { PLANS_PATH } from "../portal-pages";
import { EngineList } from "./engine-list";

/**
 * The portal's home: the engines the person can launch. The payment provider returns checkouts here, so one that
 * lands on an organization's billing owner goes on to the Plans page, which reports how it ended.
 */
export default function OverviewPage() {
  const organization = useOptionalOrganization()?.organization ?? null;
  const search = useSearch();
  if (organization?.can.manageBilling && parseCheckoutReturn(search).kind !== "none") {
    return <Redirect to={`${PLANS_PATH}?${search}`} replace />;
  }
  return (
    <>
      <PageHeader
        title={organization?.name ?? "Overview"}
        description={organization === null ? "Every engine you can open." : "This organization's engines."}
      />
      <EngineList />
    </>
  );
}
