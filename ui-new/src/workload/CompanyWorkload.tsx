import { useAgentsQuery, useProjectsQuery } from "@/lib/company-data";
import { useCompany } from "@/lib/company";
import { activeAgents } from "@/api/agents";
import { useTaskList } from "@/tasks/TasksView";
import { InitialsDisc } from "@/ui/Avatar";
import { PageHeader, Tabs } from "@/ui/PageHeader";
import { WorkloadView } from "./Workload";

/*
 * `/:companyPrefix/workload`: the company's agent workload (board 33), the organization's Workload
 * tab. Board 31 for the whole company: agents grouped by team, run bars and open work coloured by
 * project. It reads the company's whole task list, the same cached list as the Tasks page.
 *
 * The header and tabs stand in for the organization header the Org dashboard (board 19) brings;
 * when that lands, this page takes its header and tab row.
 */

export function CompanyWorkload() {
  const company = useCompany();
  const agents = useAgentsQuery();
  const projects = useProjectsQuery();
  const tasks = useTaskList(() => ({}));
  const base = () => `/${company().issuePrefix}`;
  const facts = () => {
    const parts = ["Organization"];
    if (agents.data) {
      const count = activeAgents(agents.data).length;
      parts.push(`${count} ${count === 1 ? "agent" : "agents"}`);
    }
    if (projects.data) parts.push(`${projects.data.length} ${projects.data.length === 1 ? "project" : "projects"}`);
    return parts.join(" · ");
  };
  return (
    <>
      <PageHeader
        size="compact"
        mark={<InitialsDisc name={company().name} seed={company().id} size={32} />}
        title={company().name}
        numbers={<span class="muted">{facts()}</span>}
        tabs={
          <Tabs
            label="Organization"
            items={[
              { label: "Dashboard", href: `${base()}/dashboard` },
              { label: "Agents", href: `${base()}/agents`, end: true },
              { label: "Workload", href: `${base()}/workload` },
              { label: "Settings", href: `${base()}/company/settings` },
            ]}
          />
        }
      />
      <WorkloadView scope={{ kind: "company" }} tasks={() => (tasks.isSuccess ? (tasks.data ?? []) : undefined)} scopeName={company().name} />
    </>
  );
}
