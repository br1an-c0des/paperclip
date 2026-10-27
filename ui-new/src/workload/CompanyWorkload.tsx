import { useCompany } from "@/lib/company";
import { OrgHeader } from "@/org/OrgHeader";
import { useTaskList } from "@/tasks/TasksView";
import { WorkloadView } from "./Workload";

/*
 * `/:companyPrefix/workload`: the company's agent workload (board 33), the organization's Workload
 * tab. Board 31 for the whole company: agents grouped by team, run bars and open work coloured by
 * project. It reads the company's whole task list, the same cached list as the Tasks page.
 *
 * The header and tabs are the organization's own (OrgHeader, shared with boards 19 and 20).
 */

export function CompanyWorkload() {
  const company = useCompany();
  const tasks = useTaskList(() => ({}));
  return (
    <>
      <OrgHeader />
      <WorkloadView scope={{ kind: "company" }} tasks={() => (tasks.isSuccess ? (tasks.data ?? []) : undefined)} scopeName={company().name} />
    </>
  );
}
