import { useParams } from "@solidjs/router";
import { createMemo, Show, type JSX } from "solid-js";
import { activeAgents } from "@/api/agents";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useProjectsQuery } from "@/lib/company-data";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { HeaderNumber, PageHeader, RailLayout, SectionRail, Tabs } from "@/ui/PageHeader";
import "./Planned.css";

/*
 * Pages the nav links to that later milestones build. Each draws its real header card (with tabs or
 * the settings rail where the boards have them) and says when the rest arrives, so moving around the
 * app works from M1 on and old-UI links keep resolving.
 */

export function PlannedNote(props: { milestone: string; children: JSX.Element }) {
  return (
    <section class="card planned">
      <p class="cap">Arrives in {props.milestone}</p>
      <p>{props.children}</p>
    </section>
  );
}

export function InboxPage() {
  return (
    <>
      <PageHeader title="Inbox" crumbs={<span>Everything waiting on you</span>} />
      <PlannedNote milestone="M3">Questions, proposals, approvals and suggested tasks, as one stack of request cards.</PlannedNote>
    </>
  );
}

export function AgentPage() {
  const params = useParams<{ agentKey: string }>();
  const agents = useAgentsQuery();
  const agent = createMemo(() =>
    activeAgents(agents.data).find((candidate) => candidate.urlKey === params.agentKey || candidate.id === params.agentKey),
  );
  return (
    <>
      <PageHeader
        crumbs={<span>Agents</span>}
        title={agent()?.name ?? params.agentKey}
        mark={<Show when={agent()}>{(found) => <AgentAvatar agent={found()} size={64} />}</Show>}
        numbers={<Show when={agent()?.title}>{(title) => <span>{title()}</span>}</Show>}
      />
      <PlannedNote milestone="M5">The agent's chat, activity and settings.</PlannedNote>
    </>
  );
}

const SETTINGS_SECTIONS = [
  { heading: "Organization" },
  { label: "General", path: "" },
  { label: "Members", path: "/members" },
  { label: "Connections", path: "/connections" },
  { label: "Secrets", path: "/secrets" },
  { label: "Budgets", path: "/budgets" },
  { heading: "This instance" },
  { label: "Account", path: "/instance/profile" },
  { label: "Plugins", path: "/instance/plugins" },
] as const;

export function SettingsPage() {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/company/settings`;
  return (
    <>
      <PageHeader
        size="compact"
        mark={<InitialsDisc name={company().name.slice(0, 1)} seed={company().id} size={32} />}
        title={company().name}
        numbers={<span>Organization settings</span>}
      />
      <RailLayout
        rail={
          <SectionRail
            label="Settings sections"
            entries={SETTINGS_SECTIONS.map((entry) =>
              "heading" in entry ? entry : { label: entry.label, href: `${base()}${entry.path}`, end: entry.path === "" },
            )}
          />
        }
      >
        <PlannedNote milestone="M6">Organization and instance settings, ported from the classic UI with board 30's outline.</PlannedNote>
      </RailLayout>
    </>
  );
}
