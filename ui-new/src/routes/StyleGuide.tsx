import type { IssuePriority, IssueStatus } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { Lightbulb, Plus, Search } from "lucide-solid";
import { createSignal, For, onMount, Show } from "solid-js";
import { Dock, Panel } from "@/layout/Panel";
import { theme, toggleTheme, type Theme } from "@/lib/theme";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, FieldButton, SettingsCard, SettingsRow, TextArea, TextInput } from "@/ui/Field";
import { Grain } from "@/ui/Grain";
import { HeaderNumber, PageHeader, SectionRail, Tabs } from "@/ui/PageHeader";
import { Menu } from "@/ui/Menu";
import { Popover } from "@/ui/Popover";
import { Segmented } from "@/ui/Segmented";
import { Capsule, LabelPill, PriorityBars, RunningPill, StatusCapsule, StatusPill, TonePill } from "@/ui/Status";
import { PRIORITY_META, STATUS_META, type Gradient } from "@/ui/status-meta";
import { Switch } from "@/ui/Switch";
import { ThemeScope } from "@/ui/ThemeScope";
import { pushToast, type ToastTone } from "@/ui/Toast";
import { Tooltip } from "@/ui/Tooltip";
import "@/ui/nav.css";
import "./StyleGuide.css";

/*
 * `/style-guide`: the tokens and the shared components, drawn in both themes side by side, ported
 * from docs/design/style-guide.html. Everything here is the real component, so this page is where
 * components are checked in light and dark. Composite pieces from later milestones (disc stacks,
 * group cards, request cards, workload) join it as they're built.
 *
 * Outside the session gate, so it renders without a server. Agent avatars need the server.
 */

const SWATCHES = ["--ground", "--card", "--well", "--sel", "--edge", "--line", "--text", "--body", "--muted", "--primary"];

const GRADIENTS: { name: string; role: string; gradient: Gradient }[] = [
  { name: "Ion", role: "In progress, running, live", gradient: "ion" },
  { name: "Orchid", role: "In review; proposals", gradient: "orchid" },
  { name: "Ember", role: "Todo, waiting on you; approvals", gradient: "ember" },
  { name: "Flare", role: "Blocked, failed", gradient: "flare" },
  { name: "Ash", role: "Backlog, idle", gradient: "ash" },
  { name: "Lagoon", role: "Done, healthy; suggestions", gradient: "lagoon" },
  { name: "Tide", role: "Questions", gradient: "tide" },
];

const STATUSES: IssueStatus[] = ["in_progress", "in_review", "todo", "blocked", "backlog", "done", "cancelled"];
const PRIORITIES = Object.keys(PRIORITY_META) as IssuePriority[];

const SAMPLE_AGENTS = [
  { id: "quant-researcher", name: "Quant Researcher", status: "running" },
  { id: "strategy-engineer", name: "Strategy Engineer", status: "idle" },
  { id: "ml-engineer", name: "ML Engineer", status: "error" },
];

function Swatches(props: { root: () => HTMLElement | undefined }) {
  const [values, setValues] = createSignal<Record<string, string>>({});
  // Read the resolved values once the column is in the document.
  onMount(() =>
    requestAnimationFrame(() => {
      const root = props.root();
      if (!root) return;
      const css = getComputedStyle(root);
      setValues(Object.fromEntries(SWATCHES.map((token) => [token, css.getPropertyValue(token).trim()])));
    }),
  );
  return (
    <div class="sg-swatches">
      <For each={SWATCHES}>
        {(token) => (
          <div class="sg-swatch">
            <span style={{ background: `var(${token})` }} />
            <span class="mono sg-swatch-name">{token}</span>
            <span class="mono cap">{values()[token]}</span>
          </div>
        )}
      </For>
    </div>
  );
}

const TOAST_SAMPLES: { tone: ToastTone; title: string; body: string; action?: { label: string; href: string } }[] = [
  { tone: "info", title: "Quant Researcher updated TRA-41", body: "status → in review" },
  { tone: "success", title: "Created TRA-42", body: "H4 download derivatives price data", action: { label: "Open TRA-42", href: "/style-guide" } },
  { tone: "warn", title: "Created TRA-42, but a file didn't upload", body: "prices.csv" },
  { tone: "error", title: "Quant Researcher's run failed", body: "Out of credits", action: { label: "View run", href: "/style-guide" } },
];

function ThemeColumn(props: { theme: Theme }) {
  const [root, setRoot] = createSignal<HTMLElement>();
  const [range, setRange] = createSignal<"today" | "7d" | "30d">("7d");
  const [approval, setApproval] = createSignal(true);
  const [share, setShare] = createSignal(false);
  const [priority, setPriority] = createSignal<IssuePriority>("high");
  const [labels, setLabels] = createSignal<Record<string, boolean>>({ data: true, bug: false });
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [panelOpen, setPanelOpen] = createSignal(false);

  return (
    <ThemeScope theme={props.theme} class="sg-theme" aria-label={`${props.theme === "dark" ? "Dark" : "Light"} theme`}>
      <div ref={setRoot} class="sg-col">
        <div class="sg-col-head">
          <h2 class="disp">{props.theme === "dark" ? "Dark" : "Light"}</h2>
          <span class="mono cap">
            {props.theme === "dark" ? "bone on ink; cards lift with an edge · default" : "ink on paper; cards lift with a shadow"}
          </span>
        </div>

        <div class="sg-stack">
          <h3 class="lbl">Surfaces and text</h3>
          <Swatches root={root} />
        </div>

        <div class="sg-stack">
          <h3 class="lbl">Status gradients</h3>
          <div class="sg-gradients">
            <For each={GRADIENTS}>
              {(item) => (
                <div class="card sg-gradient">
                  <span class="sg-gradient-bar grained" style={{ background: `var(--g-${item.gradient})` }}>
                    <Grain />
                  </span>
                  <span class="sg-gradient-text">
                    <b>{item.name}</b>
                    <span>{item.role}</span>
                    <span class="mono cap">--g-{item.gradient}</span>
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>

        <section class="card sg-block">
          <h3 class="lbl">Tones: tinted background with matching text</h3>
          <div class="sg-row">
            <RunningPill />
            <TonePill tone="violet">Proposal</TonePill>
            <TonePill tone="amber">Needs your approval</TonePill>
            <TonePill tone="red">Blocked by TRA-41</TonePill>
            <TonePill tone="green">Merged</TonePill>
            <TonePill tone="cyan">Question</TonePill>
          </div>
        </section>

        <section class="card sg-block">
          <h3 class="lbl">Indicators</h3>
          <div class="sg-row">
            <For each={STATUSES}>{(status, index) => <StatusPill status={status} count={index() + 1} />}</For>
          </div>
          <div class="sg-row sg-row--wide">
            <For each={PRIORITIES}>{(item) => <PriorityBars priority={item} withLabel />}</For>
          </div>
          <div class="sg-row">
            <LabelPill name="data" color="#2fd12f" />
            <LabelPill name="strategies" color="#ff2bd6" />
            <LabelPill name="bug" color="#f2272c" />
            <LabelPill name="no color" />
          </div>
          <div class="sg-row sg-row--wide">
            <For each={SAMPLE_AGENTS}>
              {(agent) => (
                <span class="sg-row sg-row--tight">
                  <AgentAvatar agent={agent} size={32} label={agent.name} />
                  <span class="cap">{agent.status}</span>
                </span>
              )}
            </For>
            <InitialsDisc name="Quant Researcher" seed="quant-researcher" label="Quant Researcher" />
            <InitialsDisc name="Brian A." you label="You" />
            <span class="sg-badge">8</span>
          </div>
          <span class="cap">
            Agents are ClipLab avatars served by the API, posed by status; initials discs stand in at small sizes or when
            the image fails (for example, with no server running).
          </span>
        </section>

        <div class="sg-grid2">
          <div class="sg-stack">
            <h3 class="lbl">Selection</h3>
            <Segmented
              label="Example range"
              value={range()}
              onChange={setRange}
              options={[
                { value: "today", label: "Today" },
                { value: "7d", label: "7 days" },
                { value: "30d", label: "30 days" },
              ]}
            />
            <div class="sg-nav">
              <a class="navi" href="#selection" onClick={(event) => event.preventDefault()}>
                <InitialsDisc name="g" seed="gearbase" size={24} />
                gearBase<span class="sg-nav-count muted">11</span>
              </a>
              <a class="navi" href="#selection" aria-current="page" onClick={(event) => event.preventDefault()}>
                <InitialsDisc name="t" seed="trading" size={24} />
                trading workbench<span class="sg-nav-count">16</span>
              </a>
            </div>
          </div>
          <div class="sg-stack">
            <h3 class="lbl">Buttons</h3>
            <div class="sg-row">
              <Button variant="primary" icon={<Plus size={15} stroke-width={2.4} aria-hidden="true" />}>
                Task
              </Button>
              <Button>Request changes</Button>
            </div>
            <div class="sg-row">
              <Button variant="primary" size="compact">Approve</Button>
              <Button size="compact">Pick someone else</Button>
              <Button variant="danger">Archive</Button>
              <Button variant="quiet">Not now</Button>
            </div>
            <div class="sg-row">
              <Button variant="well" icon={<span class="sg-dot" aria-hidden="true" />}>
                1 filter
              </Button>
              <Button variant="icon" aria-label="Search">
                <Search size={16} aria-hidden="true" />
              </Button>
              <Button variant="suggestion" icon={<Lightbulb size={14} aria-hidden="true" />}>
                1 suggestion
              </Button>
            </div>
          </div>
        </div>

        <section class="card sg-block">
          <h3 class="lbl">Inputs</h3>
          <TextInput variant="title" value="Backfill OKX funding history to 2022" aria-label="Example title" />
          <TextArea rows={2} placeholder="Add a description, or paste a spec" aria-label="Example description" />
          <div class="sg-grid2 sg-grid2--tight">
            <div class="sg-stack">
              <Field label="Workspace" for={`sg-ws-${props.theme}`}>
                <FieldButton id={`sg-ws-${props.theme}`}>Shared workspace</FieldButton>
              </Field>
              <Switch checked={approval()} onChange={setApproval} label="Require approval for new hires" />
              <Switch checked={share()} onChange={setShare} label="Share rated outputs" />
            </div>
            <Field label="Branch" for={`sg-branch-${props.theme}`} help="Agents push to this branch.">
              <TextInput id={`sg-branch-${props.theme}`} placeholder="main" />
            </Field>
          </div>
        </section>

        <SettingsCard
          title="General"
          description="Settings rows: a label column with help text, the control on the right. They stack in a narrow card."
          footer={
            <>
              <Button variant="primary" size="compact">Save</Button>
              <Button variant="quiet">Cancel</Button>
            </>
          }
        >
          <SettingsRow label="Name" for={`sg-name-${props.theme}`}>
            <TextInput id={`sg-name-${props.theme}`} value="Cuebik Creative" />
          </SettingsRow>
          <SettingsRow label="Default owner" help="Gets tasks and requests that have no owner.">
            <FieldButton icon={<InitialsDisc name="Brian A." you size={20} />}>Brian A. (you)</FieldButton>
          </SettingsRow>
        </SettingsCard>

        <section class="card sg-block">
          <h3 class="lbl">Layers: menu, popover, tooltip, dialog and panel (each starts closed)</h3>
          <div class="sg-row">
            <Menu>
              <Menu.Trigger as={Button} size="compact" icon={<PriorityBars priority={priority()} />}>
                Priority: {PRIORITY_META[priority()].label}
              </Menu.Trigger>
              <Menu.Content label="Priority" width={220}>
                <Menu.Group label="Priority">
                  <For each={PRIORITIES}>
                    {(item) => (
                      <Menu.Item
                        onSelect={() => setPriority(item)}
                        icon={<PriorityBars priority={item} />}
                        hint={item === priority() ? "Selected" : undefined}
                      >
                        {PRIORITY_META[item].label}
                      </Menu.Item>
                    )}
                  </For>
                </Menu.Group>
              </Menu.Content>
            </Menu>

            <Menu>
              <Menu.Trigger as={Button} size="compact">
                Labels
              </Menu.Trigger>
              <Menu.Content label="Labels" width={240}>
                <Menu.Group label="Pick several, then close">
                  <For each={Object.keys(labels())}>
                    {(name) => (
                      <Menu.CheckboxItem
                        checked={labels()[name] ?? false}
                        onChange={(checked) => setLabels({ ...labels(), [name]: checked })}
                        icon={<Capsule gradient={name === "bug" ? "flare" : "lagoon"} size="row" />}
                      >
                        {name}
                      </Menu.CheckboxItem>
                    )}
                  </For>
                </Menu.Group>
              </Menu.Content>
            </Menu>

            <Popover>
              <Popover.Trigger as={Button} variant="suggestion" icon={<Lightbulb size={14} aria-hidden="true" />}>
                1 suggestion
              </Popover.Trigger>
              <Popover.Content title="Move TRA-45 to ML Engineer?">
                <p class="sg-body">
                  Quant Researcher has had it for 5 hours without a run. ML Engineer has spare capacity this week.
                </p>
                <div class="sg-row">
                  <Popover.Close as={Button} variant="primary" size="compact">
                    Reassign
                  </Popover.Close>
                  <Popover.Close as={Button} variant="quiet">
                    Not now
                  </Popover.Close>
                </div>
              </Popover.Content>
            </Popover>

            <Tooltip title={<><Capsule gradient="ember" size="row" />Busiest</>} content="59h of runs this week, 1.6× the average agent.">
              {(p) => (
                <span {...p} class="sg-flag" tabindex="0" aria-label="Busiest: 59h of runs this week">
                  !
                </span>
              )}
            </Tooltip>

            <Button size="compact" onClick={() => setDialogOpen(true)}>
              Open dialog
            </Button>
            <Button size="compact" onClick={() => setPanelOpen(!panelOpen())} aria-expanded={panelOpen()}>
              {panelOpen() ? "Close panel" : "Open panel"}
            </Button>
          </div>
          <span class="cap">
            On a phone-sized window, menus and popovers become bottom sheets and the dialog and panel go full screen.
          </span>
        </section>

        <PageHeader
          crumbs={<span>Projects</span>}
          title="trading workbench"
          titleHref="/style-guide"
          titleHint="Project dashboard"
          mark={<InitialsDisc name="trading workbench" seed="trading-workbench" size={40} />}
          numbers={
            <>
              <HeaderNumber value={12} label="open" />
              <HeaderNumber value={2} label="blocked" tone="red" />
            </>
          }
          tabs={
            <Tabs
              label="Project views"
              items={[
                { label: "List", href: "/style-guide", end: true },
                { label: "Board", href: "/style-guide/board" },
                { label: "Docs", href: "/style-guide/docs" },
              ]}
            />
          }
        />

        <section class="card sg-block">
          <h3 class="lbl">Section rail, for settings</h3>
          <SectionRail
            label="Settings sections"
            entries={[
              { heading: "Organization" },
              { label: "General", href: "/style-guide", end: true },
              { label: "Members", href: "/style-guide/members" },
              { label: "Budgets", href: "/style-guide/budgets", tag: "Soon" },
            ]}
          />
        </section>

        <section class="card sg-block">
          <h3 class="lbl">Toasts</h3>
          <div class="sg-row">
            <For each={TOAST_SAMPLES}>
              {(sample) => (
                <Button size="compact" onClick={() => pushToast({ ...sample, dedupeKey: `sg-${sample.tone}-${Date.now()}` })}>
                  {sample.tone}
                </Button>
              )}
            </For>
          </div>
          <span class="cap">Bottom left, newest first, at most five; errors stay 10s and info 4s (doc/TOASTS.md).</span>
        </section>

        <Dock>
          <section class="card sg-rows" aria-label="Example task rows">
            <div class="sg-group-head">
              <StatusCapsule status="in_progress" size="group" />
              <h3>{STATUS_META.in_progress.label}</h3>
              <span class="muted">2</span>
            </div>
            <div class="sg-task">
              <StatusCapsule status="in_progress" size="row" />
              <span class="mono cap">TRA-41</span>
              <span class="sg-task-title">H4 download derivatives price data</span>
              <RunningPill compact />
              <InitialsDisc name="Quant Researcher" seed="quant-researcher" label="Quant Researcher" />
            </div>
            <div class="sg-task">
              <StatusCapsule status="in_progress" size="row" />
              <span class="mono cap">TRA-35</span>
              <span class="sg-task-title">Known bugs and limitations</span>
              <PriorityBars priority="low" />
              <InitialsDisc name="Brian A." you label="You" />
            </div>
          </section>
          <Show when={panelOpen()}>
            <Panel
              label="Example panel"
              onClose={() => setPanelOpen(false)}
              header={
                <span class="sg-row sg-row--tight">
                  <span class="mono cap">TRA-41</span>
                  <b>H4 download derivatives price data</b>
                </span>
              }
            >
              <p class="sg-body">
                Panels dock beside the list they came from and keep the list usable. Escape or ✕ closes them.
              </p>
              <div class="sg-row">
                <StatusPill status="in_progress" />
                <PriorityBars priority="high" withLabel />
                <LabelPill name="data" color="#2fd12f" />
              </div>
            </Panel>
          </Show>
        </Dock>

        <Dialog
          open={dialogOpen()}
          onOpenChange={setDialogOpen}
          title="Rename the project"
          description="Dialogs go through one wrapper: scrim, focus trap, Escape to close."
          width={560}
          footer={
            <>
              <Button variant="quiet" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="compact" onClick={() => setDialogOpen(false)}>
                Save
              </Button>
            </>
          }
        >
          <Field label="Name" for={`sg-dialog-name-${props.theme}`}>
            <TextInput id={`sg-dialog-name-${props.theme}`} value="trading workbench" />
          </Field>
        </Dialog>

      </div>
    </ThemeScope>
  );
}

export function StyleGuide() {
  return (
    <div class="sg-page">
      <header class="sg-head">
        <div class="sg-head-text">
          <span class="mono cap">Paperclip ui-new · design system</span>
          <h1 class="disp">Capsule Stack</h1>
          <p>
            Raised cards and a white selection pill, with gradient capsules for status. One set of components in two
            themes. Dark is the default.
          </p>
          <div class="sg-row">
            <A class="btn btn--secondary btn--compact" href="/">
              Back to the app
            </A>
            <Button size="compact" onClick={toggleTheme}>
              App theme: {theme() === "dark" ? "dark" : "light"}
            </Button>
          </div>
        </div>
        <div class="card sg-type">
          <span class="lbl">Type</span>
          <div class="sg-type-row">
            <span class="disp sg-type-display">trading workbench</span>
            <span class="mono cap">Display · Hanken Grotesk 800</span>
          </div>
          <div class="sg-type-row">
            <span class="sg-type-ui">H4 download derivatives price data</span>
            <span class="mono cap">UI · Hanken Grotesk 400–800</span>
          </div>
          <div class="sg-type-row">
            <span class="mono sg-type-mono">TRA-41 · run #7 · 02:14</span>
            <span class="mono cap">IDs and code · Fragment Mono</span>
          </div>
        </div>
      </header>
      <div class="sg-themes">
        <ThemeColumn theme="light" />
        <ThemeColumn theme="dark" />
      </div>
    </div>
  );
}
