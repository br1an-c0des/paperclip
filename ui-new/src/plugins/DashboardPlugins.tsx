import { useCompany } from "@/lib/company";
import { PluginSlotOutlet } from "./PluginSlot";
import "./plugins.css";

/*
 * Plugins' `dashboardWidget` slots on the org dashboard (ui/src/pages/Dashboard.tsx), each in its
 * own card, two to a row. Nothing renders, and React doesn't load, without one.
 */

export function DashboardWidgets() {
  const company = useCompany();
  return (
    <PluginSlotOutlet
      slotTypes={["dashboardWidget"]}
      context={{ companyId: company().id, companyPrefix: company().issuePrefix }}
      class="plugin-widgets"
      itemClass="card plugin-widget"
      missing="placeholder"
      errorBehavior="hidden"
    />
  );
}
