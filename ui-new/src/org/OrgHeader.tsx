import { A } from "@solidjs/router";
import { Activity, AlignLeft, FolderGit2, Gauge, LayoutGrid, Plus, Settings, Sparkles, UserPlus, Users } from "lucide-solid";
import type { JSX } from "solid-js";
import { activeAgents } from "@/api/agents";
import { openProjects } from "@/api/projects";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, usePeopleQuery, useProjectsQuery } from "@/lib/company-data";
import { InitialsDisc } from "@/ui/Avatar";
import { buttonClass } from "@/ui/Button";
import { PageHeader, Tabs } from "@/ui/PageHeader";
import "./Org.css";

/*
 * The organization's header (boards 19, 20, 33): the company, how many agents, people and projects
 * it has, Invite people and Hire agent, and the organization's tabs in a track under the card.
 *
 * Workload is board 33 (`src/workload/CompanyWorkload.tsx`), which draws this header too, as do
 * Workspaces (`src/workspaces/`), Skills (`src/skills/`), Apps (`src/apps/`) and Activity (`src/activity/`).
 */

function count(value: number | undefined, one: string, many: string) {
  return value === undefined ? null : `${value} ${value === 1 ? one : many}`;
}

export function OrgHeader(props: { actions?: JSX.Element }) {
  const company = useCompany();
  const agents = useAgentsQuery();
  const people = usePeopleQuery();
  const projects = useProjectsQuery();
  const base = () => `/${company().issuePrefix}`;

  const summary = () =>
    [
      "Organization",
      count(agents.data ? activeAgents(agents.data).length : undefined, "agent", "agents"),
      count(people.data?.users.filter((user) => user.status === "active").length, "person", "people"),
      count(projects.data ? openProjects(projects.data).length : undefined, "project", "projects"),
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div class="org-head">
      <PageHeader
        size="compact"
        mark={<InitialsDisc name={company().name.slice(0, 1)} seed={company().id} size={32} />}
        title={company().name}
        numbers={<span>{summary()}</span>}
        actions={
          <>
            {props.actions}
            <A class={buttonClass({ size: "compact" })} href={`${base()}/company/settings/members`}>
              <UserPlus size={14} aria-hidden="true" />
              Invite people
            </A>
            <A class={buttonClass({ variant: "primary", size: "compact" })} href={`${base()}/agents/new`}>
              <Plus size={14} stroke-width={2.2} aria-hidden="true" />
              Hire agent
            </A>
          </>
        }
      />
      <div class="org-tabs">
        <Tabs
          label="Organization"
          items={[
            { label: "Dashboard", href: `${base()}/dashboard`, end: true, icon: <Gauge size={15} aria-hidden="true" /> },
            { label: "Agents", href: `${base()}/agents`, end: true, icon: <Users size={15} aria-hidden="true" /> },
            { label: "Workload", href: `${base()}/workload`, icon: <AlignLeft size={15} aria-hidden="true" /> },
            { label: "Workspaces", href: `${base()}/workspaces`, icon: <FolderGit2 size={15} aria-hidden="true" /> },
            { label: "Skills", href: `${base()}/skills`, icon: <Sparkles size={15} aria-hidden="true" /> },
            { label: "Apps", href: `${base()}/apps`, icon: <LayoutGrid size={15} aria-hidden="true" /> },
            { label: "Activity", href: `${base()}/activity`, icon: <Activity size={15} aria-hidden="true" /> },
            { label: "Settings", href: `${base()}/company/settings`, icon: <Settings size={15} aria-hidden="true" /> },
          ]}
        />
      </div>
    </div>
  );
}
