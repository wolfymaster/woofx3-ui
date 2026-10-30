import { DashboardView } from "@/components/dashboard/dashboard-view";
import { DashboardCatalogProvider } from "@/lib/dashboard-widgets/catalog";
import { localDashboardCatalog } from "@/lib/dashboard-widgets/local-catalog";

/** Local mode's dashboard, with the widgets a lone engine can serve. */
export default function LocalDashboard() {
  return (
    <DashboardCatalogProvider catalog={localDashboardCatalog}>
      <DashboardView />
    </DashboardCatalogProvider>
  );
}
