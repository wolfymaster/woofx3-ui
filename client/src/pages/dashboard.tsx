import { DashboardView } from "@/components/dashboard/dashboard-view";
import { DashboardCatalogProvider } from "@/lib/dashboard-widgets/catalog";
import { hostedDashboardCatalog } from "@/lib/dashboard-widgets/hosted-catalog";

/** The hosted app's dashboard, with every widget. */
export default function Dashboard() {
  return (
    <DashboardCatalogProvider catalog={hostedDashboardCatalog}>
      <DashboardView />
    </DashboardCatalogProvider>
  );
}
