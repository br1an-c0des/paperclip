# Info-tip sweep: audit

An audit of every piece of descriptive help or hint text in `ui-new/src/` that is still shown in the
page body. It's for the sweep in the build plan's "Open (Nov 12): help text behind info icons"
([decision 52](../decisions.md#52-help-text-goes-behind-an-info-icon), CLAUDE.md "UI text"). The
user reviews this before anything changes. No source file was changed.

Audited on Nov 14, on `new-ui` at `fe8b5223c`. Line numbers are from that commit.

**The rule, as applied here**

- **Move** into an "i" tip (`info`, `ui/InfoTip.tsx`): what a section, card, field, option or page
  is for, and general guidance on using it.
- **Keep** visible: the current state, empty states, why a control is missing or disabled, save
  status, errors, and warnings the person must see before acting (destructive consequences,
  security notes that change the decision). Short.
- **No links or controls in tips.** Text that holds a link stays visible, or loses the link.
- **Split**: part moves, part stays. **Rewrite**: the text is wrong or misleading; the correction
  was checked against `server/src`, `packages/shared` or `doc/`, with a file reference.
  **Remove**: it repeats the label, the title or nearby text.

**How it was done.** Each area's files were grepped for the props and classes that carry help text
(`description=`, `help=`, `.fhelp`, `*-note`, `*-muted`, `*-sub`, `*-desc`, `*-hint`, `*-lede`,
`<p>` in headers, `Menu.Item description=`, `Switch description=`, `Dialog description=`, `title=`)
and then read region by region. Lines that only show state (counts, dates, "Saved", loading,
errors, bare empty states) aren't listed: about 800 of them. Text from data (a plugin's schema
description, a skill's or app's own description) is content, not help, and isn't listed unless the
UI wraps it in a help sentence. Text already behind an InfoTip or `info` isn't listed, except where
it's wrong. Rows marked "suspect" in their evidence weren't traced end to end; check before
changing them.

## 1. Summary

### Counts per verdict

| Verdict | Rows |
| --- | --- |
| Move | 392 |
| Keep | 396 |
| Split | 104 |
| Rewrite | 54 |
| Remove | 26 |
| **Total** | **972** |

A row can cover several texts that belong together, such as the three descriptions of one menu.

### Counts per area

"To change" is every row but Keep: the work for the change phase.

| Area | Move | Keep | Split | Rewrite | Remove | Rows | To change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [Tasks](#tasks) | 16 | 43 | 7 | 1 | 4 | 71 | 28 |
| [Inbox and requests](#inbox-and-requests) | 3 | 14 | 3 | 0 | 0 | 20 | 6 |
| [Projects](#projects) | 24 | 29 | 5 | 10 | 1 | 69 | 40 |
| [Agents](#agents) | 94 | 92 | 14 | 11 | 4 | 215 | 123 |
| [Chat](#chat) | 0 | 10 | 2 | 1 | 0 | 13 | 3 |
| [Connections/apps](#connectionsapps) | 68 | 40 | 26 | 6 | 5 | 145 | 105 |
| [Connections/apps: chat endpoints](#connectionsapps-chat-endpoints) | 52 | 33 | 12 | 1 | 2 | 100 | 67 |
| [Company settings](#company-settings) | 49 | 30 | 9 | 11 | 1 | 100 | 70 |
| [App/instance settings](#appinstance-settings) | 22 | 13 | 4 | 1 | 2 | 42 | 29 |
| [Skills](#skills) | 25 | 23 | 5 | 4 | 2 | 59 | 36 |
| [Plugins](#plugins) | 4 | 2 | 1 | 0 | 0 | 7 | 5 |
| [Onboarding](#onboarding) | 13 | 4 | 1 | 0 | 1 | 19 | 15 |
| [Activity/costs](#activitycosts) | 8 | 7 | 7 | 2 | 0 | 24 | 17 |
| [Shell/nav](#shellnav) | 1 | 12 | 1 | 2 | 4 | 20 | 8 |
| [Recurring (routines)](#recurring-routines) | 1 | 25 | 2 | 2 | 0 | 30 | 5 |
| [Status cards](#status-cards) | 9 | 7 | 5 | 1 | 0 | 22 | 15 |
| [Profile and sign-in](#profile-and-sign-in) | 3 | 12 | 0 | 0 | 0 | 15 | 3 |
| [Others](#others) | 0 | 0 | 0 | 1 | 0 | 1 | 1 |
| **Total** | **392** | **396** | **104** | **54** | **26** | **972** | **576** |

### The most important rewrites

All rewrites are listed in [Rewrites at a glance](#rewrites-at-a-glance), with the evidence in the
area tables. The ones that most mislead:

- **No-code projects** (`projects/NewProjectDialog.tsx:482`, `projects/ProjectDashboard.tsx:420`):
  there's no per-project folder. With no project workspace a run uses the task's previous session
  folder if it still exists, else the agent's working folder (`adapterConfig.cwd`), else a per-task
  folder `<instance>/isolated-workspaces/<company>/<task>`, or the agent's home folder for a run
  with no task (`server/src/services/heartbeat/workspaces.ts:3661-3690`,
  `server/src/services/isolated-task-directory.ts:26`, `server/src/home-paths.ts:50`).
- **Workspace commands and cleanup** (`projects/settings/CodeSection.tsx:632,641`): every task
  working from the project workspace inherits its commands and its cleanup, in the shared folder
  or a worktree, not only "task checkouts" (`server/src/routes/execution-workspaces.ts:358-375`,
  `server/src/services/workspace-runtime.ts:9151-9156`). The workspace's **Setup command**
  (`:631`) is stored but never run; the Task checkouts card has a second "Setup command" that is.
- **Budget hard stop** (agent, project and company budgets, the bulk budget dialog): it doesn't
  only make new runs wait. It also cancels running and queued work, and raising the limit resumes
  by itself (`server/src/services/budgets.ts:407-418,716-725,1179-1197`). "Only warn me" policies
  don't pause anything, but the bulk dialog says they do.
- **Agent variables vs. the project's** (`agents/settings/SecretsSection.tsx:74`): the project's
  value wins on the same name, the opposite of what's shown
  (`server/src/services/heartbeat/run-preparation.ts:556-560`).
- **Required personal secrets** (three menus): runs don't wait for the value; they fail with
  `user_secret_missing`, with no automatic retry (`server/src/services/secrets.ts:4371-4375`,
  `server/src/services/continuation-cause.ts:13-18`).
- **Heartbeat settings** (`agents/settings/RuntimeSection.tsx:326,327,345`): Cooldown is ignored by
  the server; turning off "When there is work" also blocks Run now and routine wakes; scheduled
  check-ins are skipped without an open task for agents made in ui-new.
- **"Organization default" environment** (`agents/settings/fields.tsx:172-178`,
  `RuntimeSection.tsx:317`, New agent): it's the instance default.
- **Roles and hiring** (`settings/company/MembersSection.tsx:161,255`, `GeneralSection.tsx:166,224`):
  what owners, admins and operators may do, and who approves hires, don't match
  `server/src/services/company-member-roles.ts`; the "default owner" is attribution only and never
  routes cards (`packages/shared/src/types/company.ts:29-36`).
- **Project storage** (`NewProjectDialog.tsx:510`): storage is locked both ways, Core can't move to
  a plugin later (`server/src/services/projects.ts:1000-1004`).
- **Ask mode** (`tasks/composer/Composer.tsx:409`): "Read-only, nothing runs" is wrong; the agent
  runs and may use tools to investigate.

### Shared-component changes

These land first (see [the split](#4-proposed-split-for-the-change-phase)), because several areas
use each.

| Component | Today | Change | Rows that need it |
| --- | --- | --- | --- |
| `ui/Field.tsx` `SettingsCard`, `SettingsRow`, `Field` | already take `info` | none: just move `description` / `help` text into `info` | about 230 |
| `ui/Dialog.tsx` | `description` shows under the title as `.dialog-desc` (also `aria-describedby`) | add `info`: an InfoTip beside the title in `.dialog-head`; `description` stays for state and consequences | about 30 |
| `ui/Switch.tsx` | `description` shows as `.switch-desc` | add `info`: an InfoTip beside the label, outside `KSwitch.Label` so a tap doesn't toggle | about 25 |
| `agents/shared.tsx` `SectionTitle` (also re-exported to company settings) | children render as a visible intro `<p>` | add `info` (InfoTip beside the title); children only for state | 21 (12 agent settings, 9 company settings) |
| `agents/shared.tsx` `SwitchRow` (also used by company settings) | `help` is required, renders `.fhelp` | add `info`; make `help` optional | 21 (10 agents, 11 company) |
| `settings/app/shared.tsx` `SectionTitle`, `SwitchRow` | same as above, app settings' own copies | add `info` | 7 |
| `settings/company/shared.tsx` `CardHead` | `note` renders a visible `<p>` | add `info` | 7 |
| `projects/settings/shared.tsx` `CardNote` (used by agent, company and project settings) | mixes help text and save status in a card `description` | keep it for save status only; callers move their text to `info` | about 10 |
| `apps/chat/parts.tsx` `Card` (wraps `SettingsCard`) | passes `description`, drops `info` | pass `info` through | 29 (24 chat endpoints, 5 apps) |
| `auth/Standalone.tsx` | `lede` only | add `info` beside the title | 2 |
| `recurring/RepeatMenu.tsx` `InfoTip` (used by recurring, the New task dialog and cases) | a second, hover-only InfoTip on Kobalte `Tooltip`; never opens on a tap (decision H) | make it a thin wrapper over `ui/InfoTip` (same props), or replace its 10 uses | 10 uses, no text change |
| `apps/shared.tsx` `ChoiceCard` | a radio card with `info`, used only in apps | move to `ui/` so chat, status cards and project settings can use it for option descriptions | about 12 |
| A heading with an "i" | each custom header (`<header class="chead">`, `ap-chead`, `pd-section-head`, `wl-head`, `org-card-row`…) would hand-roll `info-line` + InfoTip | add a small `InfoHeading` (title, `info`, level) to `ui/Field.tsx` and use it inside `SettingsCard` too | about 70 |
| `ui/Menu.tsx` `Menu.Item description` | a second line under the item | **no change**: menu descriptions stay visible (J1) | — |
| `ui/Segmented.tsx` | options have no description | **no change**: where options need explaining, one tip per control, on the control's label (J3) | — |
| `ui/PageHeader.tsx` | no description prop; `titleAside` can hold an InfoTip | **no change**: use `titleAside` for the 2 page-level tips | 2 |
| `documents/ConfirmDialog.tsx` | `body` is the consequence of a destructive action | **no change** | — |

**Should `description` and `help` be phased out?** No. They're the right place for state, and
Field.tsx's doc comment already says so. After the sweep, every remaining `description` / `help`
should be state, a reason a control is missing, an error or a must-see warning. Renaming them (for
example to `status`) would make that obvious, but touches about 400 call sites for no change on
screen; not worth it now.

**Should Segmented option descriptions become one tip per control?** Yes, where there are any:
one tip on the control's label that explains every option, one line each (EmailSetup:321,
SkillActions:575). A description of the currently selected option that states a consequence can
stay visible (J4).

### Rewrites at a glance

Every Rewrite row, with its proposal trimmed; the full text and the evidence are in the area tables.

| Where | Area | Current text | Proposed |
| --- | --- | --- | --- |
| `tasks/composer/Composer.tsx:409` | Tasks | "Ask {name} a question. Read-only, nothing runs" | Visible (placeholder): "Ask {name} a question. It answers without changing anything" |
| `projects/NewProjectDialog.tsx:448` | Projects | "Where agents check out the project's code" | Tip: "Where the project's code comes from: GitHub repositories, a folder on the server, or none." |
| `projects/NewProjectDialog.tsx:482` | Projects | "No code. Agents work in a folder Paperclip manages for the project, and you can add a…" | Tip: "Without a workspace, a run works in its agent's working folder if one is set, otherwise in a folder Paperclip makes for its task (or the…" |
| `projects/NewProjectDialog.tsx:510` | Projects | "A project on a storage plugin stays on it; a project on Core can move to a plugin later." | Tip on Workspace storage: "Storage is fixed when the project is created: a project can't move between Core and a plugin later." |
| `projects/ProjectDashboard.tsx:420` | Projects | "No repository. Agents work in a folder Paperclip manages for the project." | Visible: "No repository or folder." / Tip: same text as the New project tip above. |
| `projects/settings/EnvironmentSection.tsx:179` | Projects | "Runs wait until the person has set it" | Visible (menu description): "Runs fail until the person has set it" |
| `projects/settings/EnvironmentSection.tsx:207` | Projects | "Runs use the environment their agent is set to, or the instance's default. A project…" | Visible (why there's no control): "A project has no run environment of its own. Runs use their agent's environment, or the instance default." Drop… |
| `projects/settings/BudgetSection.tsx:174` | Projects | "New runs wait until the limit is raised" | Visible (menu description): "Stops running and queued work; runs wait until the limit is raised" |
| `projects/settings/CodeSection.tsx:631` | Projects | "Runs when the workspace is set up" | Tip: "Saved with the workspace, but Paperclip doesn't run it. A task worktree's setup command is under Task checkouts." Placeholder: "bash…" |
| `projects/settings/CodeSection.tsx:632` | Projects | "Runs before a task checkout is torn down" | Tip: "Runs when a workspace a task used from here is closed: the shared one or a task's own worktree." Placeholder: "bash ./scripts/cleanup.sh". |
| `projects/settings/CodeSection.tsx:641` | Projects | "The services and jobs agents can run here: Paperclip lists them under the workspace and…" | Tip: "The services and jobs agents can run in this workspace. Every task working from it can run them too, in the shared folder or in its own…" |
| `agents/settings/RuntimeSection.tsx:317` | Agents | "Uses the organization default unless you pick another." | Tip: "Where the agent's runs happen. Left on the default, it uses the instance's default environment, or the Paperclip server's own machine when none…" |
| `agents/settings/RuntimeSection.tsx:326` | Agents | "It is assigned a task, mentioned, or sent a message." | Tip: "Wakes for anything other than the heartbeat: a task assigned, a mention or message, a routine, or Run now. Off, all of these are skipped." |
| `agents/settings/RuntimeSection.tsx:327` | Agents | "Checks in on a schedule, even when nothing is new." | Tip: "Also wakes on a schedule. Agents made in this UI skip a check-in when they have no open task (todo or in progress) assigned; Paperclip Runner…" |
| `agents/settings/RuntimeSection.tsx:345` | Agents | "The shortest gap between two runs." | Tip: "Stored for older setups; the server doesn't use it now." (or drop the row) |
| `agents/settings/fields.tsx:172,178` | Agents | "Organization default{ · name}" | Visible (label): "Instance default{ · name}" |
| `agents/settings/fields.tsx:177` | Agents | "The instance's default environment" | Visible (menu option): "The instance's default environment, or the server's own machine when none is set" |
| `agents/settings/SecretsSection.tsx:74` | Agents | "Set for every run of this agent, on top of the project's. Secret values are never shown…" | Tip: "Set for every run of this agent. On a project's task, a project variable with the same name wins." / Visible: "Secret values are never shown…" |
| `agents/settings/SecretsSection.tsx:180` | Agents | "Runs wait until the person has set it" | Visible (menu option): "Its runs fail until the person has set it" |
| `agents/settings/BudgetSection.tsx:94` | Agents | "{name} is paused: it reached its budget. Raise the limit, then resume it." | Visible: "{name} is paused: it reached its budget. Raising the limit resumes it." |
| `agents/settings/BudgetSection.tsx:170` | Agents | "New runs wait until the limit is raised" | Visible (menu option): "Pauses it and stops its running work until the limit is raised" |
| `org/OrgAgents.tsx:600` | Agents | "What each of the {n} may spend per calendar month (UTC). At the limit Paperclip pauses…" | Tip (by "Monthly limit, in dollars"): "What each may spend per calendar month (UTC). At the limit Paperclip pauses the agent, unless its budget is…" |
| `chat/ChatActivity.tsx:179` | Chat | "Runs on new messages and assignments." | Tip (beside "Nothing running"): "It runs when you message it or assign it work, and on its heartbeat timer if it has one." |
| `apps/Connect.tsx:459` | Connections/apps | "The full MCP address the provider gave you. Paperclip keeps it as a secret." | Tip: "The full MCP address the provider gave you. If it carries a key, Paperclip stores the full address as a secret and keeps only the rest in the…" |
| `apps/TestCall.tsx:378` | Connections/apps | "In US dollars. Empty uses what's left of the Paperclip budget; agents may set less." | Tip (`info`): "In US dollars. Empty means no cap of its own: a run is still held to what's left of any Paperclip budget that applies, and is uncapped…" |
| `apps/advanced/ProfileDetail.tsx:213` | Connections/apps | "An agent with several profiles can use anything any of them allows." | Tip: "Profiles at the same level add up. A narrower assignment replaces broader ones: a recurring task's over the agent's, the agent's over a…" |
| `apps/advanced/ProfileWizard.tsx:669` | Connections/apps | "An agent with several profiles can use anything any of them allows." | Tip: same corrected text as ProfileDetail.tsx:213 |
| `apps/advanced/ProfileWizard.tsx:709` | Connections/apps | "Give a whole project or a recurring task this profile, instead of (or as well as) single…" | Tip: "Give a whole project or a recurring task this profile. In a recurring task's runs its profiles replace the agent's own; an agent's own profiles…" |
| `apps/gateways/Gateways.tsx:94` | Connections/apps | "One MCP endpoint that exposes only the apps you assign, for a client like Cursor or…" | Tip: "One MCP endpoint for a client like Cursor or Claude Desktop, exposing only the tools its access profile allows. Turn it off and every client…" |
| `apps/chat/TaskDefaults.tsx:378` | Connections/apps: chat endpoints | "Access to the project and workspace is checked for each task. A shared folder must also…" | Tip (Task defaults card `info`): "Paperclip checks access to the project and workspace each time it makes a task. A low-trust agent gets its own…" |
| `settings/company/GeneralSection.tsx:129` | Company settings | "Optional. Shown on the organization's profile." | Tip: "Shown on the organization's dashboard." |
| `settings/company/GeneralSection.tsx:166` | Company settings | "The person who gets tasks and requests that have no owner." | Tip: "The person the organization's runs act for when no one else is responsible for the work, such as a routine without its own owner. Their…" |
| `settings/company/GeneralSection.tsx:224` | Company settings | "When a person or an agent hires an agent, the new agent waits in the Inbox until an…" | Tip: "When a person or an agent hires an agent, the new agent waits in the Inbox until a member approves it. Viewers can't approve." |
| `settings/company/GeneralSection.tsx:366` | Company settings | "Stops every agent and hides the organization from its members. Its data is kept, and it…" | Visible: "Stops every agent and hides the organization from its members. Its data is kept, and an instance admin can bring it back from App settings…" |
| `settings/company/MembersSection.tsx:161` | Company settings | Owner "Everything, including billing and removing the organization"; Admin "Settings,…" | Keep in the menu: Owner "Everything, including members' roles"; Admin "Everything but members' roles"; Operator "Tasks, projects and agents, and…" |
| `settings/company/MembersSection.tsx:198` | Company settings | "They keep their role but can't sign in here" | Menu: "They keep their role but lose access to this organization until reactivated" |
| `settings/company/MembersSection.tsx:255` | Company settings | "Owners and admins manage settings and members. Operators work with tasks, projects and…" | Tip (on People): "Owners manage everything, including members' roles. Admins manage everything else and approve join requests. Operators work with…" |
| `settings/company/BudgetsSection.tsx:188` | Company settings | "New runs wait until the limit is raised" | Menu: "Pauses it and stops its running work until the limit is raised" |
| `settings/company/BudgetsSection.tsx:336` | Company settings | "A run stops when its agent or its project reaches its budget, whichever comes first.…" | Tip: "With Pause, an agent or project that reaches its budget is paused and its running work stops, whichever limit comes first. With Only warn, work…" |
| `settings/company/EnvVarsEditor.tsx:120` | Company settings | "Runs wait until the person has set it" | Menu: "Without it, runs fail at setup until the person sets it" |
| `settings/company/TransferSection.tsx:94` | Company settings | "Open and closed tasks with their descriptions." | Tip: "Open and closed tasks with their descriptions, and the organization's routines." |
| `settings/app/GeneralSection.tsx:121` | App/instance settings | "Ask each time" | Visible label: "Ask on the next vote" |
| `skills/SkillCatalog.tsx:134` | Skills | "Recommended skills cover common work; optional ones add a tool or a practice. Installed…" | Tip on the catalog: "Recommended skills cover common work; optional ones add a tool or a practice. When Paperclip ships a newer version of an…" |
| `skills/SkillLibrary.tsx:186` | Skills | "Bundled skills update with Paperclip and imported ones with their source. Turn a skill…" | Tip: "Paperclip's bundled skills update with Paperclip, and skills from a source follow it while its automatic updates are on. Other installed and…" |
| `skills/SkillStudio.tsx:56` | Skills | "Skills written here. Bundled and imported skills are read-only; their source keeps them…" | Tip: "Skills written here. Bundled and imported skills open read-only here; fork one for a copy you can edit." |
| `skills/SkillSources.tsx:56` | Skills | "Repositories the library imports skills from. Their skills stay in step with the branch…" | Tip: "Repositories the library imports skills from. With automatic updates on, their skills follow the branch you pick; otherwise use Sync now." |
| `activity/CostReports.tsx:128` | Activity/costs | "“No one” is work with no responsible person here, such as routines and agents' own…" | Tip (By person header): "“No one” is spend with no responsible person recorded in this organization." |
| `activity/CostReports.tsx:592` | Activity/costs | "Refunds and credit purchases" | Tip (Credits KPI label): "Entries marked as credits: refunds, offsets and credit returns." |
| `layout/TasksSheet.tsx:260` | Shell/nav | "Company, secrets, plugins, routines, activity" | Visible: "Members, models, secrets, budgets, environments" |
| `routes/NotFound.tsx:27` | Shell/nav | "This page is planned for a later milestone. The classic UI still has it." | Visible: "This page isn't in this app. The classic UI may still have it." |
| `recurring/RecurringDetails.tsx:1069` | Recurring (routines) | "Runs the server missed while it was down are dropped" / "Missed runs catch up, a few at…" | Visible (menu descriptions): "Missed runs are dropped" / "Missed runs are made up, up to 25" |
| `recurring/RecurringRuns.tsx:366` (text at `:42-43`) | Recurring (routines) | "The project's main checkout" / "A fresh branch just for this run" | Visible (menu descriptions): "The project's primary workspace, shared with other tasks" / "A fresh branch just for this run" |
| `status-cards/StatusPage.tsx:134` | Status cards | "Status cards are off on this instance. An instance admin turns them on with the…" | Visible: "Status cards are off on this instance. An instance admin can turn them on in the app settings' Features." |
| `lib/session.tsx:203` | Others | "The server isn't answering. Start it with corepack pnpm dev at the repo root; this page…" | Visible: "The server isn't answering. This page retries on its own." |

## 2. Areas

One table per area, rows grouped by file in file order. `Where` is relative to `ui-new/src/`. In Proposed, "Tip:" is the `info` text and "Visible:" is what stays in the body.

### Tasks

#### Task detail

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `tasks/ShareSheet.tsx:111` | Dialog description ("Who can see this task") | "Sharing gives access to this task and its subtasks: comments, documents and run history. Its parent and the tasks beside it need their own access." | Move | Tip: "Sharing gives access to this task and its subtasks, with their comments, documents and run history. Its parent and the tasks beside it need their own access." | Accurate: `server/src/services/authorization.ts:661` (grants flow to privacy descendants only). |
| `tasks/ShareSheet.tsx:219` | caution under a picked shared agent | "{name} works for others too. Its memory and workspace can carry what it sees here into later runs…" | Keep | — (security note that changes the decision) | |
| `tasks/ShareSheet.tsx:236` | remove-grant confirm body | "This removes the grant and the access it gives to the task's subtasks. Ownership, assignment…" | Keep | — (consequence before confirming) | |
| `tasks/TaskActions.tsx:224` | Menu.Item description, "Who can see it…" | "Share it, or take access back" | Remove | — (the label and the sheet it opens say the same) | |
| `tasks/TaskActions.tsx:332` | Make public dialog text | "Everyone in the company will be able to read this task… What others have seen can't be taken back." | Keep | — (destructive warning) | |
| `tasks/composer/Composer.tsx:550` | Menu.Item descriptions, work mode (WORK_MODES, `composer/composer-model.ts:178`) | "Make the change and report back" / "Reply with findings, change nothing" / "Propose a plan for you to approve" | Keep | — (option meaning at the point of choice; see Judgement calls) | |
| `tasks/composer/Composer.tsx:409` | textarea placeholder, Ask mode (`placeholderFor`, `composer/composer-model.ts:186`) | "Ask {name} a question. Read-only, nothing runs" | Rewrite | Visible (placeholder): "Ask {name} a question. It answers without changing anything" | The agent does run in Ask mode and may use tools to investigate: `server/src/services/heartbeat/task-markdown.ts:255-261` ("Use tools only for investigation or temporary scratch work"). |
| `tasks/composer/Composer.tsx:620` | Menu.Item description, Steer now | "Send it into the run that's going now" / "This agent's runner can't take messages mid-run" | Keep | — (option meaning; second half is a disabled reason) | |
| `tasks/composer/Composer.tsx:625` | Menu.Item description, Interrupt and send | "Stop the run and start a new one with this message" | Keep | — (consequence at the point of choice) | |
| `tasks/composer/Composer.tsx:628` | Menu.Item description, Queue for the next turn | "Wait for the agent's next turn" | Keep | — (option meaning) | |
| `tasks/composer/Composer.tsx:692` | assignee popover note | "Picking someone else reassigns the task when you send." | Keep | — (consequence before acting) | |
| `tasks/composer/Composer.tsx:758` | model/effort popover note | "Applies to this task's next runs." | Move | Tip: "Applies to this task's next runs." | |
| `tasks/composer/RunnerGoal.tsx:281` | Dialog description, edit/replace goal | "This clears the unfinished goal and starts a new one…" / "Change the objective. The goal keeps its progress." | Keep | Visible (replace): as is (destructive). Visible (edit): "The goal keeps its progress." ("Change the objective." repeats the title) | |
| `tasks/composer/RunnerGoal.tsx:302` | Field help, Objective | "What the agent keeps working toward, up to N characters." | Split | Tip: "What the agent keeps working toward." / Visible: "Up to N characters." | |
| `tasks/TaskEditors.tsx:189` | description editor hint | "Markdown. ⌘↵ saves, Esc cancels." | Keep | — (keyboard hint while typing; see Judgement calls) | |
| `tasks/TaskEditors.tsx:357` | assignee menu note while running | "{agent} is running. Changing the assignee stops this run." | Keep | — (consequence before acting) | |
| `tasks/TaskEditors.tsx:448` | Switch description, Browser access | "Claude can use Chrome on this task (--chrome)." | Move | Tip: "Claude can use Chrome on this task (--chrome)." | |
| `tasks/TaskEditors.tsx:454` | model/effort popover footer hint | "For this task only. The agent keeps its own settings." | Move | Tip: "For this task only. The agent keeps its own settings." | |
| `tasks/TaskEditors.tsx:553` | review popover note (per tab) | "When the task is done, one of these reviews it first." / "After any review, one of these approves it before it closes." | Move | Tip (Reviewers): "When the task is done, one of these reviews it first." Tip (Approvers): "After any review, one of these approves it before it closes." | |
| `tasks/TaskEditors.tsx:761` | billing code popover note | "Costs of this task's runs are reported under this code." | Move | Tip: "Costs of this task's runs are reported under this code." | |
| `tasks/TaskEditors.tsx:840` | Menu.Item description, Project default workspace | "Whatever the project sets" | Keep | — (option meaning) | |
| `tasks/TaskEditors.tsx:847` | Menu.Item description, New isolated workspace | "A fresh worktree for this task" | Keep | — (option meaning) | |
| `tasks/TaskExecution.tsx:129` | watchdog popover note | "An agent that watches this task and steps in to keep it moving." | Move | Tip: "An agent that watches this task and steps in to keep it moving." | |
| `tasks/TaskExecution.tsx:247` | monitor popover note | "Have the agent re-check this task at a set time, such as when an outside service should be done." | Move | Tip: "Has the agent re-check this task at a set time, such as when an outside service should be done." | |
| `tasks/TaskRuns.tsx:215` | runs empty state | "No runs yet. Assigning the task to an agent starts one." | Split | Tip: "Assigning the task to an agent starts a run." / Visible: "No runs yet." | |
| `tasks/TaskWorkspace.tsx:207` | workspace empty state | "This task hasn't run in a workspace yet. Its first run sets one up, following the project's workspace settings." | Split | Tip: "Its first run sets one up, following the project's workspace settings." / Visible: "This task hasn't run in a workspace yet." | Checked: a run records an execution workspace for any task, also with no project workspace (`server/src/services/heartbeat/workspace-preparation.ts:1267-1281`), so the claim holds. |
| `tasks/TaskContext.tsx:226` | Compact now note | available: "Summarizes the conversation so far so the agent has room to keep working." (pending/unavailable: state) | Split | Tip (beside Compact now): "Summarizes the conversation so far so the agent has room to keep working." / Visible: only the pending and unavailable notes | Text from `tasks/context-usage.ts:73-76`. |
| `tasks/TaskFiles.tsx:405` | Attachments empty state | "No attachments. Drop files here to add them." | Keep | — (empty state with its one action) | |
| `tasks/TaskFiles.tsx:421` | Outputs empty state | "Nothing produced yet: pull requests, branches and previews from runs show here." | Split | Tip (beside Outputs): "Pull requests, branches and previews from runs." / Visible: "Nothing produced yet." | |
| `tasks/TaskFiles.tsx:596` | Menu.Item description, Lock | "Nobody can change it until it's unlocked" | Keep | — (consequence at the point of choice) | |
| `tasks/TaskRecovery.tsx:168` | Menu.Item descriptions, next step (OUTCOMES, `tasks/recovery-actions.ts:105`) | "Close the recovery and put the task back in Todo." … "Dismiss the recovery and send the task for review." | Keep | — (consequence at the point of choice) | |
| `tasks/TaskRecovery.tsx:524` | containment form intro | "Stop both the controller and the provider on the original host before recording evidence… Recording containment doesn't retry the task." | Keep | — (must-see before acting) | |
| `tasks/TaskRecovery.tsx:567` | containment form note | "If any action's outcome is still unknown, keep this hold. After the evidence and cleanup settle, use the task's Retry separately." | Keep | — (must-see before acting) | |
| `tasks/TaskBranch.tsx:164` | Reconcile forward confirm text | "The live branch carries the recorded one forward, so Paperclip adopts it…" | Keep | — (consequence before confirming) | |
| `tasks/TaskBranch.tsx:168` | Repair confirm text | "Nothing is lost: the uncommitted changes are committed to a new rescue branch…" | Keep | — (consequence before confirming) | |
| `tasks/TaskBranch.tsx:186` | Override confirm text | "This skips Paperclip's safety check and points the task at the live branch…" | Keep | — (destructive warning) | |
| `tasks/FeedbackVotes.tsx:192` | Dialog description, share feedback | "Choose whether voted AI outputs can be shared with Paperclip Labs. Your answer becomes the default…" | Keep | — (consent decision; must be read before answering) | |
| `tasks/FeedbackVotes.tsx:207` | consent terms paragraphs | "This vote is always saved here." / "Always allow shares this vote…" / "You can change this later in App settings → General." | Keep | — (consent terms; sits with the terms link) | Accurate: `settings/app/GeneralSection.tsx:115` ("AI feedback sharing"). |
| `tasks/integrations/EmailThread.tsx:202` | "Say what happened" intro | "Check AgentMail first: if it went out, paste its message id. This records the outcome; it never resends." | Keep | — (must-see before acting) | |

#### Task list

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `tasks/SavedViews.tsx:102` | Dialog description, Save view | "Keeps this list's grouping, filters, sort and search under a name, in this browser." | Move | Tip: "Keeps this list's grouping, filters, sort and search under a name, in this browser only." | |
| `tasks/TaskList.tsx:737` | quick-add hint | "Enter to add · Esc to close" | Keep | — (keyboard hint while typing; see Judgement calls) | |
| `tasks/TasksView.tsx:798` | Menu.Item description, Sort by workflow | "Blockers before the tasks they hold up" | Keep | — (option meaning) | |
| `tasks/TasksView.tsx:889` | Menu.CheckboxItem description, Hide tasks agents created | "Made by an agent, a routine or a plan" | Keep | — (says what counts; routines and plans aren't obvious) | |
| `tasks/TasksView.tsx:897` | Menu.CheckboxItem description, Recurring task runs | "Started by a recurring task" | Remove | — (repeats the label) | |

#### New task dialog

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `tasks/NewTaskDialog.tsx:142` | work mode menu option descriptions (ChoicePill, rendered at 1407) | "Make the change and report back" / "Reply with findings, change nothing" / "Propose a plan for you to approve" | Keep | — (option meaning) | |
| `tasks/NewTaskDialog.tsx:148` | workspace menu option descriptions (WorkspacePill, rendered at 1339) | "The project's main checkout" / "A fresh branch just for this task" | Keep | — (option meaning; only shown when the project's workspace policy is on, `tasks/new-task.ts:152`) | |
| `tasks/NewTaskDialog.tsx:153` | review policy menu option descriptions (ChoicePill, rendered at 1407) | "Any reviewer can approve the result" / "Whoever made the task can't approve it" / "Agents can't approve the result" | Keep | — (option meaning) | |
| `tasks/NewTaskDialog.tsx:160` | More fields / Add a role menu descriptions (EXTRA_META, rendered at 842 and 1073) | "Nest it under another task" … "Only you and the assignee can see it" … "An agent that checks the work stays on track" | Keep | — (option meaning) | Private: also visible to those it's shared with later (`server/src/services/authorization.ts:663-675`); close enough for a menu line. |
| `tasks/NewTaskDialog.tsx:1153` | Menu.Item description, Save draft and close | "Kept until you create or cancel it" | Keep | — (consequence) | |
| `tasks/NewTaskDialog.tsx:1515` | run settings note when unavailable | "A recurring task goes to an agent, which runs each one on its own model and effort." / "People don't run on a model…" / "This agent's runner doesn't take a model or effort per task…" / "Pick an agent to choose…" | Keep | — (why the control is missing) | |

#### Bulk edit

No help text (`tasks/TasksView.tsx` SelectionBar, 1065-1140).

#### Cases

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `cases/NewTaskCase.tsx:77` | Switch description, Start a case (when on) | "The assignee sets up a case with this task as its main task." | Remove | — (repeats the InfoTip beside it, line 81) | |
| `cases/NewTaskCase.tsx:91` | Menu.Item description, No case | "Just a task" | Remove | — (repeats the label) | |
| `cases/NewTaskCase.tsx:157` | template preview, no diagram | "No phase diagram: the agents follow its text." | Keep | — (state of the picked template) | |
| `cases/StartWorkflow.tsx:73` | Dialog description, Start {case} | "Hands the case to an agent with a new main task, and wakes them to start its first phase." | Keep | — (consequence: it wakes an agent) | |
| `cases/StartWorkflow.tsx:98` | Field help, Workflow | "Markdown. A Mermaid stateDiagram-v2 whose states are the phase names draws the phase track." | Move | Tip (Field `info`): "Markdown. A Mermaid stateDiagram-v2 whose states are the phase names draws the phase track." | |
| `cases/CaseSection.tsx:338` | fields part header note | "Kept up to date by the agents" | Move | Tip (beside the fields heading): "Kept up to date by the agents." | |
| `cases/CaseSection.tsx:466` | child cases empty row | "No child cases. Agents add one when part of the work can be checked on its own." | Split | Tip: "Agents add a child case when part of the work can be checked on its own." / Visible: "No child cases." | |

#### Documents and files

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `documents/NewDocument.tsx:105` | key help line | "Agents find documents by key. Lowercase letters, numbers, - and _." (plan key: "The plan key makes this the task's plan."; errors) | Split | Tip (beside Key): "Agents find documents by key." / Visible: "Lowercase letters, numbers, - and _.", the plan-key line and errors | |
| `documents/NewDocument.tsx:130` | footer hint | "Ctrl+S creates it" | Keep | — (keyboard hint) | |
| `documents/DocumentView.tsx:492` | Menu.Item description, Lock | "Nobody can change it until it's unlocked" | Keep | — (consequence at the point of choice) | |
| `documents/DocumentView.tsx:747` | edit footer note | "Unsaved changes · Ctrl+S saves" / "No changes" | Keep | — (save status) | |
| `documents/Annotations.tsx:253` | comments panel prompt | "Select text in the document to comment on it." | Keep | — (the panel's only cue for how to start; see Judgement calls) | |
| `files/WorkspaceFiles.tsx:188` | Menu.Item description, This task's workspace | "Where this task's runs work" | Keep | — (option meaning) | |
| `files/WorkspaceFiles.tsx:340` | changed-files empty state | "No changed files. Browse all files instead." | Keep | — (empty state) | |

#### Search

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `search/SearchPage.tsx:607` | idle card "What's searched" list | "Task titles, descriptions, comments and documents; files; agents; projects." / "A task ID such as TES-12 and Enter opens that task." / "Filters can be typed: status:blocked…" / "Quotes match a phrase exactly." | Move | Tip (beside the search box, "About search"): the four lines as one short paragraph; idle card keeps Recent searches only | Accurate: `packages/shared/src/types/search.ts:4`. |
| `search/SearchPage.tsx:559` | no-results advice | "Try fewer words, or a single distinctive one." / "No {kind} match it. Other kinds may." | Keep | — (empty state) | |
| `search/SearchPage.tsx:445` | result cap note | "Showing the first N. Add words or filters to find the rest." | Keep | — (state) | |

#### Workload

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `workload/Workload.tsx:141` | section sub, Who's waiting on whom | "Follow a chain to find what's holding work up" | Move | Tip: "Follow a chain to find what's holding work up." | |
| `workload/Workload.tsx:150` | section sub, Open work | "Tasks assigned in this project" / "Tasks assigned, by project" | Move | Tip: "Open tasks assigned to each agent, by project." (project scope: "in this project") | |
| `workload/Workload.tsx:163` | lanes sub (rangeSub, 128-129) | "Runs, schedules and blocked time for agents on {project}" / "Every agent in the company, coloured by project" / "How busy each agent was, in 4-hour blocks from midnight" / "…day by day" | Move | Tip (beside the range title): the same text per range | |
| `workload/Workload.tsx:421` | suggestion card ask line | "· worked out from open tasks and recent runs" | Move | Tip (beside "Only a hint"): "Worked out from open tasks and recent runs." | |

### Inbox and requests

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `inbox/InboxItem.tsx:110` | Menu.Item description, Transfer to… | "Route it to someone else; it moves to their For you" | Keep | — (consequence at the point of choice) | |
| `inbox/InboxItem.tsx:128` | Menu.Item description, Archive | "Hidden for you until it changes; teammates still see it" | Keep | — (consequence at the point of choice) | |
| `inbox/InboxItem.tsx:134` | Menu.Item description, Withdraw for everyone… | "It's out of date: end it for everyone, without approving" | Keep | — (destructive consequence) | |
| `inbox/InboxPage.tsx:605` | Needs you bar note | "Most urgent first" | Keep | — (current order) | |
| `inbox/InboxPage.tsx:607` | KeyHints (also 706, 741, 775, 796) | "j k move · ← → close, open · ⇧ all · y archive…" | Keep | — (keyboard hints; see Judgement calls) | |
| `inbox/InboxPage.tsx:688` | Gone quiet fold note | "Gone quiet. Keep one to bring it back." | Move | Tip (beside the fold label): "Requests with no activity for a while. Keep one to bring it back." | |
| `inbox/InboxPage.tsx:704` | Alerts bar note | "Failed runs, budget alerts, agent errors and stuck blockers, most urgent first" | Split | Tip ("About Alerts"): "Failed runs, budget alerts, agent errors and stuck blockers." / Visible: "Most urgent first" (as on Needs you) | Accurate: `inbox/inbox-model.ts:68` (ALERT_SOURCES). |
| `inbox/InboxPage.tsx:754` | Updates empty state | "No tasks yet. Tasks you create, comment on or are assigned show up here." | Split | Tip ("About Updates"): "Tasks you create, comment on or are assigned show up here." / Visible: "No tasks yet." | |
| `requests/RequestCard.tsx:458` | Menu.Item description, Set aside | "Keep it in the history to answer later" | Keep | — (option meaning) | |
| `requests/RequestCard.tsx:463` | Menu.Item description, Skip | "End it without an answer" | Keep | — (consequence) | |
| `requests/RequestCard.tsx:469` | Menu.Item description, Withdraw the question | "You asked it; take it back without an answer" | Keep | — (consequence) | |
| `requests/RequestCard.tsx:474` | Menu.Item description, Withdraw… | "It's out of date: end it for everyone, without approving" | Keep | — (destructive consequence) | |
| `requests/ConnectionControls.tsx:212` | note under reusable connections | "Reusing one adds access for {agent}. A new connection is for all agents unless you pick fewer." | Keep | — (access scope that changes the choice) | |
| `requests/ConnectionControls.tsx:216` | note when adopting an AI connection | "This replaces {agent}'s own sign-in with your account. The model stays the same." | Keep | — (consequence before acting) | |
| `requests/ConnectionControls.tsx:220` | no-connection note | "{agent} needs a working AI connection. Set one up in Connections, then pick it here." / "You don't have a connection to reuse yet… New connections are for all agents unless you pick fewer." | Keep | — (empty state and next step) | |
| `requests/JoinControls.tsx:76` | join request credentials note | "It sent credentials for Paperclip to call it with. They're kept with the agent and not shown here." | Keep | — (security note) | |
| `approvals/ApprovalPage.tsx:194` | Changes were requested follow-up | "The agent resubmits once it has made them. If it already has, or you've sorted it out together, mark it resubmitted." | Move | Tip (beside "Changes were requested"): "The agent resubmits once it has made the changes. If it already has, or you've sorted it out together, mark it resubmitted." | |
| `approvals/ApprovalPage.tsx:225` | budget stop follow-up | "Raise the limit or keep the work paused from the budget controls; approving here doesn't lift it." | Keep | — (must-see; holds the Budget controls link beside it) | Accurate: the approve route has no budget handling (`server/src/routes/approvals.ts`); limits are resolved through budgets (`server/src/services/budgets.ts:1114`). |
| `approvals/ApprovalPage.tsx:278` | Linked tasks hint | "Linked tasks stay open until the requesting agent follows up and closes them." | Move | Tip (beside "Linked tasks"): "Linked tasks stay open until the requesting agent follows up and closes them." | Approving wakes the requester (`server/src/routes/approvals.ts:500`); it doesn't close linked issues. |
| `approvals/ApprovalHistory.tsx:61` | empty state | "No approvals yet. When an agent asks for one, it shows up in the Inbox." | Split | Tip (PageHeader, "About Approvals"): "When an agent asks for an approval, it shows up in the Inbox to answer." / Visible: "No approvals yet." | |

### Projects

#### New project dialog

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `projects/NewProjectDialog.tsx:302` | description placeholder | "What this project is for. Agents read it before every task." | Keep | — (placeholder; gone once typing starts) | |
| `projects/NewProjectDialog.tsx:367` | Visibility `Menu.Item description` | "Everyone in {company}" | Keep | — (menu option description: stays visible, see J1) | |
| `projects/NewProjectDialog.tsx:374` | Visibility `Menu.Item description` | "Only the members you add" | Keep | — (menu option description: stays visible, see J1) | |
| `projects/NewProjectDialog.tsx:448` | Code section subtitle (`cap` in `np-code-head`) | "Where agents check out the project's code" | Rewrite | Tip: "Where the project's code comes from: GitHub repositories, a folder on the server, or none." | A local folder is used in place, not checked out: a `local_path` workspace's `cwd` becomes the run's `cwd` (`server/src/services/heartbeat/workspaces.ts:3544-3640`, source `project_primary`); only a repository without a folder gets a managed checkout (`server/src/home-paths.ts:67-70`). |
| `projects/NewProjectDialog.tsx:482` | "None" code note | "No code. Agents work in a folder Paperclip manages for the project, and you can add a repository later in Settings." | Rewrite | Tip: "Without a workspace, a run works in its agent's working folder if one is set, otherwise in a folder Paperclip makes for its task (or the agent's home folder for a run with no task)." / Visible: "No code. You can add a repository later in Settings." | No per-project folder exists. With no project workspace the server reuses the task's previous session folder if it still exists (`server/src/services/heartbeat/workspaces.ts:3661-3683`), else the agent's `adapterConfig.cwd`, else a per-task folder (`materializeIsolatedTaskDirectory`, `<instance>/isolated-workspaces/<company>/<task>`, `server/src/services/isolated-task-directory.ts:26-50`), else the agent home `<instance>/workspaces/<agentId>` (`resolveDefaultAgentWorkspaceDir`, `server/src/home-paths.ts:50-56`); see `workspaces.ts:3685-3690`. |
| `projects/NewProjectDialog.tsx:501` | storage `Menu.Item description` | "The installed default" | Keep | — (state: which plugin is the default) | |
| `projects/NewProjectDialog.tsx:510` | storage note (`np-storage-note`) | "A project on a storage plugin stays on it; a project on Core can move to a plugin later." | Rewrite | Tip on Workspace storage: "Storage is fixed when the project is created: a project can't move between Core and a plugin later." | `PATCH` rejects any storage change with 409 `project_storage_locked` (`server/src/services/projects.ts:1000-1004`); `doc/project-environment-compatibility.md:78-81`: "in both directions: core to plugin and plugin to core". `projects/settings/CodeSection.tsx:791` already says "Storage doesn't change after creation". |
| `projects/NewProjectDialog.tsx:628` | GitHub not connected note | "No GitHub account is connected to this company yet. Connect one in Connections, then pick its repositories here, or choose Local folder." | Keep | — (why the repository picker is missing) | |

#### Project overview

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `projects/ProjectDashboard.tsx:267` | Stuck work subtitle (`cap` in `pd-section-head`) | "Not a request, but waiting on someone" | Move | Tip: "Open tasks that aren't a request but are waiting on someone." | |
| `projects/ProjectDashboard.tsx:271` | Stuck work empty state | "Nothing is stuck. Every open task is moving or waiting on a request." | Keep | — | |
| `projects/ProjectDashboard.tsx:302` | Brief empty state (`pd-note`) | "No description yet. Agents read it before every task; add one in Settings." | Split | Tip: "Agents read the project's description before every task. Edit it in Settings." / Visible: "No description yet." | |
| `projects/ProjectDashboard.tsx:372` | Budget hint (`pd-note`) | "Set a monthly budget in Settings to stop work before it overspends." | Move | Tip on Budget: "A budget set in Settings pauses this project's runs when it's reached." (the well already shows "No budget set") | Visible state comes from `projects/dashboard-model.ts:113`. A project budget can also be lifetime, so "monthly" is narrower than Settings. |
| `projects/ProjectDashboard.tsx:420` | Code well, no repository | "No repository. Agents work in a folder Paperclip manages for the project." | Rewrite | Visible: "No repository or folder." / Tip: same text as the New project tip above. | Same as `NewProjectDialog.tsx:482`. |

#### Docs, phone header, AI summary

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `projects/ProjectDocs.tsx:137` | "Project docs and files" subtitle (`cap` in `pdocs-head`) | "Shared across the whole project, not tied to one task" | Move | Tip: "Docs and files for the whole project, not tied to one task." | |
| `projects/ProjectDocs.tsx:140` | `pdocs-waiting` note | "Projects can't hold their own documents or files yet. Until they can, everything is listed under the task it came from, below." | Keep | — (state: why the section is empty) | |
| `projects/ProjectPhoneHeader.tsx:274` | Star `Menu.Item description` | "Keeps it in your nav's Starred group" | Keep | — (menu option description: stays visible, see J1) | |
| `projects/summary/AiSummary.tsx:34` (used at :152) | Summarizer setup note | "Summaries are written by Paperclip's built-in Summarizer agent. Set it up with a harness and model before asking for a summary. Built-in agents" | Keep | — (holds link; why Generate is missing) | |
| `projects/summary/AiSummary.tsx:123` | "AI" chip `title=` | "Written by the Summarizer agent" | Move | Tip: "Written by Paperclip's built-in Summarizer agent." (a `title` is hover-only, so phones never see it) | |

#### Settings → Details

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `projects/settings/DetailsSection.tsx:65` | card description (`CardNote`) | "Changes save as you make them." | Move | Tip: "Changes save as you make them." (description keeps only the save status) | |
| `projects/settings/DetailsSection.tsx:148` | Description `help=` | "Agents read this as context for every task in the project." | Move | Tip: same | |
| `projects/settings/DetailsSection.tsx:185` | Lead `help=` | "The agent who looks after the project." | Move | Tip: same | |
| `projects/settings/DetailsSection.tsx:254` | Goals `help=` | "Why this project exists." | Move | Tip: same | |

#### Settings → Goals

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `projects/settings/GoalsSection.tsx:126` | card description | "Why this project exists. A task in the project gets its first goal unless you pick another, and agents read the goal with the task." | Move | Tip: same | Consistent with `server/src/services/issue-goal-fallback.ts:3-11`. |
| `projects/settings/GoalsSection.tsx:185` | empty state | "No goals yet. Add one to say why the project exists, or link one the company already has." | Split | Visible: "No goals yet." / Tip: covered by the card's tip. | |
| `projects/settings/GoalsSection.tsx:255` | Archive goal `Menu.Item description` | "Cancels it; you can restore it" | Keep | — (what the action does) | |
| `projects/settings/GoalsSection.tsx:258` | Take off this project `Menu.Item description` | "It stays in the company" | Keep | — (consequence) | |
| `projects/settings/GoalsSection.tsx:374` | "No parent goal" `Menu.Item description` | "A top-level goal" | Remove | — (repeats the label) | |

#### Settings → Visibility and members

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `projects/settings/AccessSection.tsx:69` | card description (`CardNote`) | "Who can see this project and its tasks." | Move | Tip: same | |
| `projects/settings/AccessSection.tsx:81` | Open radio card help (`ps-choice-help`) | "Everyone in {company} can find it. Tasks made private keep their own access." | Move | Tip: same | |
| `projects/settings/AccessSection.tsx:90` | Private radio card help (`ps-choice-help`) | "Only its members can find it and read its tasks. A task can still be shared directly." | Move | Tip: same | |
| `projects/settings/AccessSection.tsx:95` | `fhelp` | "Only the project's owner and company admins can change who sees it." | Keep | — (disabled reason) | |
| `projects/settings/AccessSection.tsx:99` | Members `help=` | "People and agents who can see this private project." | Move | Tip: same | |
| `projects/settings/AccessSection.tsx:111` | confirm `Dialog description=` | "Everyone in the company will be able to find this project. Its private tasks stay private, but members who … lose access. Share those tasks directly first …" | Keep | — (consequence warning) | |
| `projects/settings/AccessSection.tsx:250` | `fhelp` beside Add a member | "An agent you add can remember what it reads here in later runs; removing it later can't erase that." | Keep | — (security note before acting) | |
| `projects/settings/AccessSection.tsx:292` | In your sidebar `help=` | "Joining is personal. It only decides whether the project shows in your sidebar." | Move | Tip: same | |
| `projects/settings/AccessSection.tsx:300` | Starred `help=` | "Starred projects are pinned for you." | Move | Tip: same | |

#### Settings → Environment

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `projects/settings/EnvironmentSection.tsx:80` | card description (`CardNote`) | "Set for every run in this project. Secret values are never shown here." | Move | Tip: same | |
| `projects/settings/EnvironmentSection.tsx:137` | value type `Menu.Item description` (3) | "Shown here and in run logs" / "One of the company's secrets" / "Each person sets their own value" | Keep | — (menu option descriptions, see J1; "Shown here and in run logs" is also a security note) | |
| `projects/settings/EnvironmentSection.tsx:179` | Required `Menu.CheckboxItem description` | "Runs wait until the person has set it" | Rewrite | Visible (menu description): "Runs fail until the person has set it" | A missing required personal secret throws `user_secret_missing` (`server/src/services/secrets.ts:4371-4375`), a failure only a person can resolve, with no automatic retry (`server/src/services/continuation-cause.ts:13-18`). Same text in `agents/settings/SecretsSection.tsx:180` and `settings/company/EnvVarsEditor.tsx:120`. |
| `projects/settings/EnvironmentSection.tsx:206` | Execution environment card description | "Where agents run this project's work." | Move | Tip: "Where this project's runs happen." | |
| `projects/settings/EnvironmentSection.tsx:207` | `ps-list-note` with link to Code and workspaces | "Runs use the environment their agent is set to, or the instance's default. A project picks one only for separate task checkouts, under Code and workspaces." | Rewrite | Visible (why there's no control): "A project has no run environment of its own. Runs use their agent's environment, or the instance default." Drop the link. | A project doesn't pick one for checkouts either: "A project does not change run placement. Older clients may still send `executionWorkspacePolicy.environmentId`; the service drops it." (`doc/project-environment-compatibility.md:90-93`); `withoutLegacyProjectEnvironment` strips it on update (`server/src/services/projects.ts:62-66`, `:999`). `projects/settings/CodeSection.tsx:61-62` says the same. |
| `projects/settings/EnvironmentSection.tsx:261` | New secret `fhelp` | "Stored encrypted on the server for the whole company. It isn't shown again." | Keep | — (security note before acting) | |

#### Settings → Budget

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `projects/settings/BudgetSection.tsx:72` | card description | "What agents may spend on this project. Company-wide budgets are set in Costs." | Move | Tip: same | |
| `projects/settings/BudgetSection.tsx:111` | Limit `help=` | "Leave it empty for no limit." | Move | Tip: same | |
| `projects/settings/BudgetSection.tsx:174` | hard stop `Menu.Item description` | "New runs wait until the limit is raised" | Rewrite | Visible (menu description): "Stops running and queued work; runs wait until the limit is raised" | Reaching a hard stop pauses the project (`server/src/services/budgets.ts:365-400`, `pauseReason: "budget"`) and cancels its existing work through `cancelWorkForScope` (`budgets.ts:1179-1197`, wired to `heartbeat.cancelBudgetScopeWork` in `server/src/app.ts:912`); cancelled work is resumed once allowed again (`budgets.ts:1087-1099`). |
| `projects/settings/BudgetSection.tsx:177` | warn only `Menu.Item description` | "Runs carry on past the limit" | Keep | — (menu option description: stays visible, see J1) | |

#### Settings → Code and workspaces (what's left in CodeSection.tsx)

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `projects/settings/CodeSection.tsx:150` | Repositories empty state | "No repositories. Agents work in the project workspaces below." / "No repositories." | Keep | — | |
| `projects/settings/CodeSection.tsx:187` | `ps-muted-line` on a repository row | "Edit it under Project workspaces" | Keep | — (why there's no edit control here) | |
| `projects/settings/CodeSection.tsx:215` | no GitHub account | "No GitHub account is connected to this company. Connect one in Connections to add repositories." | Keep | — (why Add is missing) | |
| `projects/settings/CodeSection.tsx:295` | Local folder `help=` (hosted, paths hidden) | "Agents check the code out in the platform's managed environment." | Move | Tip: append to the row's existing `info`. | |
| `projects/settings/CodeSection.tsx:445` | Project workspaces empty state | "No workspaces. Each task starts in an empty folder, or in its agent's own folder." | Keep | — | Accurate: `server/src/services/heartbeat/workspaces.ts:3685-3690`. |
| `projects/settings/CodeSection.tsx:454` | remove workspace `Dialog description=` | "Agents stop using it for new work. The folder and repository themselves aren't deleted." | Keep | — (consequence) | |
| `projects/settings/CodeSection.tsx:631` | Setup command placeholder used as help | "Runs when the workspace is set up" | Rewrite | Tip: "Saved with the workspace, but Paperclip doesn't run it. A task worktree's setup command is under Task checkouts." Placeholder: "bash ./scripts/setup.sh". (Or hide the field, see J9.) | Confirmed by the coordinator: `setupCommand` on a project workspace is only stored, returned and exported (`server/src/services/projects.ts:1204,1285`, `server/src/routes/issues.ts:8518`, `server/src/services/company-portability.ts:1550`); nothing in `server/src` or `packages` runs it. What runs at worktree creation is the policy's `provisionCommand` (`server/src/services/workspace-runtime.ts:3376-3382`), shown as "Setup command" in the Task checkouts card (`CodeSection.tsx:761`), so the page has two fields with the same label. |
| `projects/settings/CodeSection.tsx:632` | Cleanup command placeholder used as help | "Runs before a task checkout is torn down" | Rewrite | Tip: "Runs when a workspace a task used from here is closed: the shared one or a task's own worktree." Placeholder: "bash ./scripts/cleanup.sh". | Closing any execution workspace linked to this project workspace loads `projectWorkspaces.cleanupCommand` (`server/src/routes/execution-workspaces.ts:1300-1357`) and runs it with the teardown command (`server/src/services/workspace-runtime.ts:4450-4456`), whatever the mode. It's not limited to "task checkouts" (the per-task worktrees in this UI). |
| `projects/settings/CodeSection.tsx:641` | Workspace commands `fhelp` | "The services and jobs agents can run here: Paperclip lists them under the workspace and task checkouts inherit them. Use `commands` entries …; older `services` lists still work. Leave it empty for none." | Rewrite | Tip: "The services and jobs agents can run in this workspace. Every task working from it can run them too, in the shared folder or in its own worktree, unless that task's workspace has its own. Use `commands` entries with a `kind` of `service` or `job`; older `services` lists still work. Leave it empty for none." | Any execution workspace with this `projectWorkspaceId` falls back to the project workspace's commands: `effectiveRuntimeConfig = existing.config?.workspaceRuntime ?? projectWorkspaceRuntime` (`server/src/routes/execution-workspaces.ts:358-375`), and the same at startup (`server/src/services/workspace-runtime.ts:9151-9156`), with no mode check. Shared-mode tasks also share the project's running services (`workspace-runtime.ts:1318-1323`). "Task checkouts" in this UI means only the per-task worktrees (Checkouts card), so the old wording reads as "only worktrees inherit them". |
| `projects/settings/CodeSection.tsx:736` | Checkouts off note | "Tasks share the project workspace. To give each its own worktree, an instance admin turns on Isolated workspaces in App settings → General → Features." | Keep | — (holds link; why the controls are missing) | |
| `projects/settings/CodeSection.tsx:795` | Available in `help=` | "{storage} workspace storage was chosen when this project was created and doesn't change." / "The workspace storage plugin this project was created with isn't installed. Storage doesn't change after creation." | Split | Tip: the first (list) variant / Visible: the unavailable variant (state). | |

#### Settings → Background GitHub authorization

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `projects/settings/GitAuthorizationSection.tsx:61` | card description | "Lets this project's workspace provider use your GitHub Connector to set up and maintain its repositories, until you revoke it." | Move | Tip: same | |
| `projects/settings/GitAuthorizationSection.tsx:78` | Authorized as, none | "Not authorized. Private repositories wait for an authorization before their workspaces are set up; public ones don't need one." | Split | Visible: "Not authorized." / Tip: "Private repositories wait for an authorization before their workspaces are set up; public ones don't need one." | |
| `projects/settings/GitAuthorizationSection.tsx:95` | account `help=` | "Only your own accounts, connected through the Paperclip GitHub App and installed for this company." | Move | Tip: same | |
| `projects/settings/GitAuthorizationSection.tsx:100` | no eligible account | "A project can only be authorized with a GitHub account connected through the Paperclip GitHub App, in Connections; …" | Keep | — (holds link; why the picker is missing) | |
| `projects/settings/GitAuthorizationSection.tsx:129` | consent checkbox label | "I allow this project's workspace provider to use my GitHub Connector …" | Keep | — (consent text) | |

#### Settings → Archive

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `projects/settings/ArchiveSection.tsx:45` | archive row `ps-muted-line` | "It's hidden from the sidebar and project lists. …" / "Hides it from the sidebar and project lists. Its tasks keep the project and stay findable in filters. You can restore it later." | Keep | — (state, and what the danger action does) | |
| `projects/settings/ArchiveSection.tsx:66` | join/leave row `ps-muted-line` | "Puts it back in your sidebar." / "Removes it from your sidebar. Other members aren't affected." | Move | Tip: same | |
| `projects/settings/ArchiveSection.tsx:85` | confirm `Dialog description=` | "It disappears from the sidebar and the project lists. Its tasks keep the project, and you can restore it from here." | Keep | — (destructive confirm) | |

#### Workspaces

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `workspaces/WorkspacesPage.tsx:134` | toolbar note in Closed view | "A closed workspace reopens from its task: a new message or resuming the task reopens it." | Move | Tip beside the Show switch: same | |
| `workspaces/WorkspacesPage.tsx:156` | empty state | "No open workspaces. A task's first run sets one up, following its project's workspace settings." | Split | Visible: "No open workspaces." / Tip: "A task's first run sets one up, following its project's workspace settings." | |
| `workspaces/CloseWorkspaceDialog.tsx:66` | `Dialog description=` | "Close {name} and clean up what Paperclip made for it. The workspace record and its tasks' history stay; it leaves the open workspaces." | Keep | — (consequence of a destructive action) | |
| `workspaces/CloseWorkspaceDialog.tsx:187` | retry callout | "Cleanup failed on this workspace before. Retrying runs the cleanup again …" | Keep | — (state) | |

### Agents

Files: `ui-new/src/agents/**`, `runs/`, `org/` (.tsx, no tests). Server claims checked against `server/src` and `doc/`.

#### Agent page and header

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `agents/AgentHeader.tsx:188` | Menu.Item description (New task) | "Assigned to {name}" | Keep | — (option description in a menu) | |
| `agents/AgentHeader.tsx:194` | Menu.Item description (Run now) | "Starts a run now" | Remove | — (repeats the item's label) | |
| `agents/AgentHeader.tsx:220` | Menu.Item description (Make my primary agent) | "The default for your new tasks and chat" | Keep | — (option description in a menu) | |
| `agents/AgentHeader.tsx:236` | Menu.Item description (Reset all sessions) | "Fresh provider context on every task" | Keep | — (consequence, in a menu) | |
| `agents/AgentHeader.tsx:258` | Dialog description (Retire) | "It stops taking work and leaves the sidebar. Its tasks, runs and history are kept. This can't be undone from here." | Keep | — (destructive consequence) | |
| `agents/AgentHeader.tsx:297` | Menu.Item description (Retire draft…) | "Discards the unfinished agent" | Keep | — (destructive consequence, in a menu) | |
| `agents/AgentHeader.tsx:368` | status pill `title` (hover only) | "Runs start once its setup check passes." | Keep | — (state explanation; see Judgement calls: hover-only `title`) | |
| `agents/BuiltInSetup.tsx:144` | `fhelp` at top of Set up dialog | "It joins the roster marked Built-in. If your organization approves new agents, it waits in the Inbox first." | Move | Tip: same text | |
| `agents/BuiltInSetup.tsx:171` | SettingsRow help (Monthly budget) | "In dollars. Leave empty for no limit." | Move | Tip: same text | |

#### New agent

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `agents/new/NewAgentPage.tsx:570` | SettingsRow help (Harness) | "The program the agent works in." | Move | Tip: same text | |
| `agents/new/NewAgentPage.tsx:627` | SettingsRow help (Kimi key) | "The organization secret Kimi Code reads as {KIMI_KEY}." | Move | Tip: same text | |
| `agents/new/NewAgentPage.tsx:662` | SettingsRow help (Sign-in) | "How the harness reaches its model." | Move | Tip: same text | |
| `agents/new/NewAgentPage.tsx:676` | Menu.Item description (sign-in choices) | "{harness} uses whatever it's signed in with on the machine it runs on." / connection descriptions | Keep | — (option descriptions in a menu) | |
| `agents/new/NewAgentPage.tsx:699` | `fhelp` under Sign-in (selected choice's description) | "{harness} uses whatever it's signed in with on the machine it runs on." (or the connection's line) | Keep | — (describes the current pick) | |
| `agents/new/NewAgentPage.tsx:716` | `fhelp` (Antigravity model) | "Google Antigravity is in preview here: it runs only the model an operator authorized." | Keep | — (why the model can't be picked) | |
| `agents/new/NewAgentPage.tsx:753` | SettingsRow help (Thinking effort) | "More effort is slower and costs more." | Move | Tip: same text | |
| `agents/new/NewAgentPage.tsx:759` | SettingsRow help (Runner, `runnerHelp()`) | "Paperclip Runner supervises each run of {h}; the legacy runner runs the program directly. You can switch later in the agent's settings." / "Test checks whether Paperclip Runner qualifies on this sandbox…" / "Paperclip picks a runner once it knows…" / "The only runner that carries {h} here." | Split | Tip: the first text (with a choice) / Visible: the other three (what Test will do, or why there's no choice) | |
| `agents/new/NewAgentPage.tsx:773` | SettingsRow help (Test) | "Checks the harness is installed, signed in and can reach the model." | Move | Tip: same text | |
| `agents/new/NewAgentPage.tsx:832` | hover-only `Tooltip` behind an Info button (approval) | "This organization approves new agents first. The request goes to the Inbox, and the agent starts work once it's approved." | Remove | — (repeats the visible note at :855; or make it an InfoTip and drop :855) | |
| `agents/new/NewAgentPage.tsx:855` | `na-approval-note` | "The request goes to the Inbox; the agent starts work once it's approved." | Keep | — (state: this hire needs approval) | |
| `agents/new/NewAgentPage.tsx:868` | hover-only `Tooltip` on the "Draft, paused" pill | "Saved as a paused draft when you continued, so you can finish it later from here or the Agents page." | Move | Tip (InfoTip beside the pill): same text | Hover-only text that's shown nowhere else, against decision H. |
| `agents/new/NewAgentPage.tsx:924` | SettingsRow help (Avatar) | "One of the ClipLab palettes." | Move | Tip: same text | |
| `agents/new/NewAgentPage.tsx:947` | SettingsRow help (Reports to) | "Its manager in the org chart." | Move | Tip: same text | |
| `agents/new/NewAgentPage.tsx:950` | SettingsRow help (Title) | "Shown in place of the role." | Move | Tip: same text | |
| `agents/new/NewAgentPage.tsx:959` | SettingsRow help (What they do) | "Other agents read this when they decide what to hand over." | Move | Tip: same text | |
| `agents/new/OutsideAgentInvite.tsx:110` | Dialog description (preset picked) | "Send the prompt to the agent. It reads Paperclip's onboarding, asks to join {org}, and starts work once you approve it." | Keep | — (the next step in the flow) | |
| `agents/new/OutsideAgentInvite.tsx:111` | Dialog description (pick stage) | "Bring in an agent that runs on its own, on another machine or service. Paperclip wakes it by calling it; it reports back through the API." | Move | Tip: same text | |
| `agents/new/OutsideAgentInvite.tsx:160` | `oa-warn` (no CEO) | "{org} has no CEO agent. Paperclip files an outside agent under the CEO when you approve it, so approving would fail. Give one of your agents the CEO role (Profile → Role) first; …" | Keep | — (must-see warning) | |
| `agents/new/OutsideAgentInvite.tsx:175` | preset choice card description | "An existing Hermes agent, through its gateway" / "Any agent that can connect to Paperclip: OpenClaw, an HTTP service, a script" | Keep | — (choice-card option descriptions) | |
| `agents/new/OutsideAgentInvite.tsx:180` | `fhelp` (pick stage) | "Agents you run here, such as Claude Code or Codex, are better hired with New agent: Paperclip can then show their transcripts, count their spend and keep to a budget." | Move | Tip: same text | |
| `agents/new/OutsideAgentInvite.tsx:200` | `fhelp` (ready) | "Valid until {date}. Anyone with this prompt can ask to join as an agent; nothing joins until you approve it." | Keep | — (state + security note) | |
| `agents/new/OutsideAgentInvite.tsx:209` | `oa-wait` status | "Waiting for the agent's join request. It appears in the Inbox under Needs you, where you approve it." | Keep | — (state; holds link) | |

#### Agent settings: Profile

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `agents/settings/ProfileSection.tsx:57` | SectionTitle intro | "Who {name} is, where it sits in the organization, and its lifecycle." | Move | Tip: same text | |
| `agents/settings/ProfileSection.tsx:63` | Identity description (CardNote) | "Changes save as you make them." | Keep | — (save behaviour + save status) | |
| `agents/settings/ProfileSection.tsx:73` | SettingsRow help (Avatar) | "One of the ClipLab palettes." | Move | Tip: same text | |
| `agents/settings/ProfileSection.tsx:105` | SettingsRow help (Title) | "Shown in place of the role, such as “Quant Researcher”." | Move | Tip: same text | |
| `agents/settings/ProfileSection.tsx:116` | SettingsRow help (What they do) | "Other agents read this when they decide what to hand over." | Move | Tip: same text | |
| `agents/settings/ProfileSection.tsx:126` | SettingsRow help (Reports to) | "Its manager in the org chart. Its own reports aren't offered, since that would make a loop." | Move | Tip: same text | |
| `agents/settings/ProfileSection.tsx:146` | `fhelp ag-warn` | "{repairGuidance}" / "Its chain of command needs attention." | Keep | — (state) | |
| `agents/settings/ProfileSection.tsx:150` | SettingsRow help (Direct reports) | "Agents that report to it. Change one's manager from its own profile." | Move | Tip: same text | |
| `agents/settings/ProfileSection.tsx:204` | SettingsCard description (For you) | "Only you see these." | Move | Tip: same text | |
| `agents/settings/ProfileSection.tsx:205` | SettingsRow help (Primary agent) | "The default for your new tasks and chat." | Move | Tip: same text | |
| `agents/settings/ProfileSection.tsx:225` | SwitchRow help (Show in my sidebar) | "Turning it off only hides it from your sidebar; nobody else is affected." | Move | Tip: same text | |
| `agents/settings/ProfileSection.tsx:283` | SettingsCard description (Lifecycle) | "Pause or resume it, clear an error, or reset its sessions. Retire it from the header's menu." | Move | Tip: same text | |
| `agents/settings/ProfileSection.tsx:288` | `fhelp` | "Runs start once its setup check passes." | Keep | — (state) | |
| `agents/settings/BuiltInCard.tsx:139` | routine row `fhelp` | "{schedule or n triggers}. Turning the schedule off stops it starting work in the background." | Split | Tip: "Turning the schedule off stops it starting work in the background." / Visible: "{schedule or n triggers}." | |
| `agents/settings/BuiltInCard.tsx:176` | Dialog description (Reset to defaults) | "Its harness, model and budget go back to Paperclip's defaults, and so do its instructions, skill and recurring task. Edits to them are lost." | Keep | — (destructive consequence) | |

#### Agent settings: Model and runtime

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `agents/settings/RuntimeSection.tsx:178` | SectionTitle intro | "How {name} runs: its harness and model, where it runs, when it wakes, and its limits. Changes are saved together, as a new revision." | Move | Tip: "How {name} runs: harness and model, where it runs, when it wakes, its limits. Changes here are saved together as one new revision." | |
| `agents/settings/RuntimeSection.tsx:190` | Runner offer note (`ag-note`) | "Saving probes {env} first, and switches only if the Runner qualifies there. The model and instructions stay." | Keep | — (what Save will do) | |
| `agents/settings/RuntimeSection.tsx:191` | Runner offer note | "Switching keeps the model and instructions. It is saved with your other changes, as one revision." | Keep | — (consequence before acting; short) | |
| `agents/settings/RuntimeSection.tsx:220` | SettingsRow help (Harness) | "The program the agent runs in." | Move | Tip: "The program the agent runs in." | |
| `agents/settings/RuntimeSection.tsx:238` | SettingsRow help (Runner) | "What starts and supervises the harness for each run." | Move | Tip: "What starts and supervises the harness for each run. Paperclip Runner supervises it; the legacy runner runs the harness program directly." | |
| `agents/settings/RuntimeSection.tsx:239` | Runner fallback (`ag-static-text`) | "Not applicable: {harness} runs only on the legacy runner." | Keep | — (why the control is missing) | |
| `agents/settings/RuntimeSection.tsx:260` | Runner `fhelp` (current Runner) | runnerDetail(): "Paperclip's runner drives the Codex app server." (etc.) | Keep | — (describes the current setup) | |
| `agents/settings/RuntimeSection.tsx:265` | Runner `fhelp` (staged switch, qualify) | "Saving probes {env} first, and switches only if the Runner qualifies there. The model and instructions stay." | Keep | — (staged state) | |
| `agents/settings/RuntimeSection.tsx:266` | Runner `fhelp` (staged switch) | "Paperclip Runner starts and supervises the harness for each run. The model and instructions stay." | Split | Tip: (into Runner `info`, see :238) / Visible: "The model and instructions stay." | |
| `agents/settings/RuntimeSection.tsx:268` | Runner `fhelp` | "Paperclip Runner isn't available for this harness in this environment." | Keep | — (why the option is missing) | |
| `agents/settings/RuntimeSection.tsx:269` | Runner `fhelp` (legacy) | "Runs the {harness} program directly.{ The model and instructions stay.}" | Split | Tip: (into Runner `info`, see :238) / Visible: "The model and instructions stay." only when a switch is staged | |
| `agents/settings/RuntimeSection.tsx:277` | SettingsRow help (Usage limit) | "What {provider} last reported for this sign-in's limits. Queued work waits while it's used up." | Move | Tip: "What {provider} last reported for this sign-in's limits. Queued work waits while a limit is used up." | |
| `agents/settings/RuntimeSection.tsx:292` | SettingsRow help (Thinking effort) | "More effort is slower and costs more." | Move | Tip: "More effort is slower and costs more." | |
| `agents/settings/RuntimeSection.tsx:309` | SettingsCard description (Harness settings) | "Options of {harness} itself. Saved with your other changes." | Move | Tip: "Options of {harness} itself. Saved with your other changes." | |
| `agents/settings/RuntimeSection.tsx:317` | SettingsRow help (Environment) | "Uses the organization default unless you pick another." | Rewrite | Tip: "Where the agent's runs happen. Left on the default, it uses the instance's default environment, or the Paperclip server's own machine when none is set." | Empty `defaultEnvironmentId` falls back to the instance setting, then to `local`: `server/src/services/agent-runner-selection.ts:480,498`; decisions.md 30 ("`defaultEnvironmentId` is instance-level"). Not an organization (company) default. |
| `agents/settings/RuntimeSection.tsx:321` | SwitchRow help (Browser access) | "Lets the agent open and read web pages in a real browser (Chrome)." | Move | Tip: "Lets the agent open and read web pages in a real browser (Chrome)." | |
| `agents/settings/RuntimeSection.tsx:326` | SwitchRow help (When there is work) | "It is assigned a task, mentioned, or sent a message." | Rewrite | Tip: "Wakes for anything other than the heartbeat: a task assigned, a mention or message, a routine, or Run now. Off, all of these are skipped." | Every non-timer wake is skipped when `wakeOnDemand` is false, including manual and routine wakes: `server/src/services/heartbeat/queue.ts:3389`. |
| `agents/settings/RuntimeSection.tsx:327` | SwitchRow help (On a heartbeat) | "Checks in on a schedule, even when nothing is new." | Rewrite | Tip: "Also wakes on a schedule. Agents made in this UI skip a check-in when they have no open task (todo or in progress) assigned; Paperclip Runner agents get no scheduled check-ins without a task." | Timer wake is skipped with no assigned todo/in_progress issue when `skipTimerWhenNoActionableWork` (set by `newAgentRuntimeConfig`, `ui-new/src/agents/new/new-agent-model.ts:317`): `server/src/services/heartbeat/queue.ts:3394`, `timer-policy.ts:176`. Taskless timer wakes are dropped for `paperclip_runner`: `heartbeat-policy.ts:8`, `queue.ts:3214`. |
| `agents/settings/RuntimeSection.tsx:345` | NumberRow help (Cooldown) | "The shortest gap between two runs." | Rewrite | Tip: "Stored for older setups; the server doesn't use it now." (or drop the row) | `heartbeat.cooldownSec` is read nowhere in `server/src` or `packages` (only a default in `server/src/services/company-portability.ts:804`); `parseHeartbeatPolicy` has no cooldown (`server/src/services/heartbeat/timer-policy.ts:56`). |
| `agents/settings/RuntimeSection.tsx:346` | NumberRow help (Runs at once) | "How many runs may overlap." | Move | Tip: "How many of its runs may happen at the same time (1 to 50)." | Clamped 1–50, some Runner providers forced to 1: `server/src/services/heartbeat/timer-policy.ts:8-22,61`. |
| `agents/settings/RuntimeSection.tsx:351` | NumberRow help (Timeout) | "A run is stopped after this long. 0 means no limit." | Move | Tip: "A run is stopped after this long. 0 means no limit." | |
| `agents/settings/RuntimeSection.tsx:352` | NumberRow help (Grace period) | "Time a run gets to wrap up after it is stopped." | Move | Tip: "Time a run gets to wrap up after it is stopped, before it's force-killed." | |
| `agents/settings/RuntimeSection.tsx:355` | SwitchRow help (Continue after a turn limit) | "When the harness stops at its turn limit, start a follow-up run that picks up where it left off." | Move | Tip: same text | |
| `agents/settings/RuntimeSection.tsx:376` | SwitchRow help (Capture raw provider traces) | "Records the full model input and output of every run and keeps it for 24 hours. Only instance admins can read traces. Turn it on while you investigate a problem." | Move | Tip: same text (accurate) | 24 h retention `server/src/services/provider-trace-store.ts:20`; reads `assertInstanceAdmin` `server/src/routes/agents.ts:7642`. |
| `agents/settings/RuntimeSection.tsx:392` | `<details>` summary sub-line | "Command, arguments and prompt templates" | Keep | — (summary of what the fold holds; acts as its label) | |
| `agents/settings/RuntimeSection.tsx:396` | SettingsRow help (Command) | "Leave empty to use the harness default." | Move | Tip: "Leave empty to use the harness default." | |
| `agents/settings/RuntimeSection.tsx:399` | SettingsRow help (Arguments) | "Separated by commas." | Move | Tip: "Separated by commas." | |
| `agents/settings/RuntimeSection.tsx:404` | SettingsRow help (Prompt template) | "Sent at the start of every run." | Move | Tip: "Sent at the start of every run. Keep it small; long-lived guidance belongs in Instructions." | |
| `agents/settings/RuntimeSection.tsx:407` | SettingsRow help (Bootstrap prompt) | "Legacy. Move it into Instructions." | Keep | — (state: legacy, read-only) | |
| `agents/settings/RuntimeSection.tsx:494` | SettingsRow help (Sign-in) | "How the harness reaches the model." | Move | Tip: "How the harness reaches the model." | |
| `agents/settings/RuntimeSection.tsx:500` | Sign-in fallback (`ag-static-text`) | "No AI connection: the harness uses its own sign-in on the machine it runs on." | Keep | — (current state) | |
| `agents/settings/RuntimeSection.tsx:507` | Menu.Item description (Its own sign-in) | "The harness's own login on the machine it runs on" | Keep | — (option description inside a menu; no tip possible) | |
| `agents/settings/RuntimeSection.tsx:584` | ExtraFieldRow help (adapter field hints) | `{field.hint}` (from the harness's field list) | Move | Tip: `{field.hint}` (SwitchRow/SettingsRow `info`) | Content comes from the harness definition, but it's help in a help slot. |
| `agents/settings/RuntimeSection.tsx:683` | Test environment `ps-muted-line` (before a test) | "Checks the saved computer still qualifies for the Runner, then tests the saved settings." | Move | Tip (beside Test environment): same text | |
| `agents/settings/RuntimeSection.tsx:684` | Test environment `ps-muted-line` (before a test) | "Tests the saved settings: harness found, signed in, model available." | Move | Tip (beside Test environment): same text | |
| `agents/settings/HarnessChange.tsx:81` | Dialog description | "It runs in {harness} now. The change is saved at once, as a new revision you can roll back." | Keep | — (current state + consequence before acting) | |
| `agents/settings/HarnessChange.tsx:129` | change notes list (`ag-change-notes`) | "Instructions, variables, the prompt template and run limits carry over." | Keep | — (consequence before acting) | |
| `agents/settings/HarnessChange.tsx:130` | change notes list | "The model, thinking effort and {harness}'s own settings don't." | Keep | — (consequence before acting) | |
| `agents/settings/HarnessChange.tsx:132` | change notes list | "Its AI connection stays." / "Its AI connection is for another provider, so it's removed. Pick one under Sign-in afterwards." | Keep | — (consequence before acting) | |
| `agents/settings/HarnessChange.tsx:135` | change notes list | "Paperclip picks the runner it recommends for this harness." | Keep | — (consequence before acting) | |
| `agents/settings/RunnerStateCard.tsx:80` | SettingsCard description | "What {runtime} keeps between runs. Reset a session to give the next run fresh context." | Move | Tip: same text | |
| `agents/settings/RunnerStateCard.tsx:95` | SettingsRow help (Current session) | "The provider session the next run without a task resumes." | Move | Tip: same text | |
| `agents/settings/RunnerStateCard.tsx:117` | SettingsRow help (Totals) | "Across every run the runtime state has counted." | Move | Tip: same text | |
| `agents/settings/RunnerStateCard.tsx:141` | SettingsRow help (Task sessions) | "One provider session per task, and one for your chat with it. The newest first." | Move | Tip: "One provider session per task, and one for your chat with it. Newest first." | |
| `agents/settings/fields.tsx:130` | Menu.Item description (Harness default model) | "Whatever the harness picks" | Keep | — (option description in a menu) | |
| `agents/settings/fields.tsx:172,178` | EnvironmentMenu default label (also New agent → Where it runs) | "Organization default{ · name}" | Rewrite | Visible (label): "Instance default{ · name}" | The fallback is the instance setting, not the organization's: `server/src/services/agent-runner-selection.ts:480`; `doc/project-environment-compatibility.md:90` ("agent default, then the instance default, then local execution"). |
| `agents/settings/fields.tsx:177` | Menu.Item description (default environment) | "The instance's default environment" | Rewrite | Visible (menu option): "The instance's default environment, or the server's own machine when none is set" | `server/src/services/agent-runner-selection.ts:480,498` (driver falls back to `local`). |

#### Agent settings: Permissions and trust

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `agents/settings/PermissionsSection.tsx:81` | SectionTitle intro | "What {name} may do without asking, which projects it can reach, and how it deals with other agents." | Move | Tip: same text | |
| `agents/settings/PermissionsSection.tsx:87` | Trust card description (CardNote) | "Changes save at once." | Keep | — (save behaviour + save status line) | |
| `agents/settings/PermissionsSection.tsx:92` | SwitchRow help (Hire agents) | "Create or hire agents. This also lets it assign tasks." | Move | Tip: same text | Assign source `agent_creator` (`ui-new/src/agents/agent-model.ts:746`). |
| `agents/settings/PermissionsSection.tsx:93` | SwitchRow help (Create skills) | "Install, import, create and scan the company's skills." | Move | Tip: same text (see Judgement calls: suspect) | suspect: `permissions.canCreateSkills` isn't read by the skill routes, which use the company skill policy and `skills:create` grants (`server/src/routes/company-skills.ts:232-274`, `services/company-skill-policy.ts:143-149`); only stored/logged (`server/src/lib/agent-permissions.ts:122`, `routes/agents.ts:5142`). |
| `agents/settings/PermissionsSection.tsx:96` | SwitchRow help (Assign tasks) | `taskAssignHelp()`: "On for every CEO agent." / "On while it can hire agents." / "Granted to it directly." / "On for every agent, by the company's defaults." / "Give tasks to other agents and people." | Split | Tip: "Give tasks to other agents and people." / Visible: the source line (why it's on or locked) | |
| `agents/settings/PermissionsSection.tsx:151` | Project access description (low trust) | "Projects whose tasks and repositories {name} may reach." | Move | Tip: same text | |
| `agents/settings/PermissionsSection.tsx:151` | Project access description (standard trust) | "{name} has standard trust, so no project list limits it." | Keep | — (state) | |
| `agents/settings/PermissionsSection.tsx:187` | `ps-list-note` (standard trust) | "Project access lists only apply to agents with low trust, under Trust below." | Remove | — (repeats :151's standard-trust line, shown with it) | |
| `agents/settings/PermissionsSection.tsx:215` | `fhelp` (pending adds) | "{name} will reach work and repositories in {…}. Its other low-trust restrictions stay." | Keep | — (consequence before saving) | |
| `agents/settings/PermissionsSection.tsx:218` | `fhelp` (no manage access) | "Someone who can manage agents can add projects here." | Keep | — (why Add project is missing) | |
| `agents/settings/PermissionsSection.tsx:279` | SettingsRow help (Trust preset) | "How broadly it may read and act on the organization's work." | Move | Tip: same text | |
| `agents/settings/PermissionsSection.tsx:289` | Menu.Item description (trust presets) | "Works across the organization within its permissions…" / "Contained for untrusted input such as pull request review: …" | Keep | — (option descriptions in a menu) | |
| `agents/settings/PermissionsSection.tsx:300` | `fhelp` under Trust preset (current preset's description) | "Works across the organization within its permissions. The default for normal work." / "Contained for untrusted input…" | Split | Tip: both presets' descriptions (row `info`) / Visible: nothing for the preset; keep only " Choosing low trust also takes away hiring." (:301) | |
| `agents/settings/PermissionsSection.tsx:301` | `fhelp` (hiring warning) | "Choosing low trust also takes away hiring." | Keep | — (consequence before acting) | |
| `agents/settings/PermissionsSection.tsx:306` | SettingsRow help (Boundary) | "What it may read and change. Without one, every request is denied." | Move | Tip: same text (the "denied" state shows in the banner below, :316) | |
| `agents/settings/PermissionsSection.tsx:315` | Boundary state banner (Contained) | "It reads and changes only the work inside its boundary. Its raw output stays quarantined from agents with more trust until a trusted reviewer promotes it." | Split | Tip: "It reads and changes only the work inside its boundary. Its raw output stays quarantined from agents with more trust until a trusted reviewer promotes it." / Visible: "Contained" | |
| `agents/settings/PermissionsSection.tsx:316` | Boundary state banner (no boundary) | "Pick a project or a task below before it can run without being denied." | Keep | — (state, alert) | |
| `agents/settings/PermissionsSection.tsx:324` | `fhelp` (boundary not editable) | "This boundary has several targets, set through the API or the EE permissions extension, so it can't be edited here." | Keep | — (why the control is missing) | |
| `agents/settings/PermissionsSection.tsx:325` | `fhelp` (several projects) | "Its boundary is the projects under Project access, above." | Keep | — (why the control is missing) | |
| `agents/settings/PermissionsSection.tsx:337` | Menu.Item description (boundary types) | "Its tasks and repositories" / "Everything under one task" / "Only that task" | Keep | — (option descriptions in a menu) | |
| `agents/settings/InteractionsCard.tsx:45` | Interactions description (pending hire) | "These can be set once the hire is approved." | Keep | — (disabled reason) | |
| `agents/settings/InteractionsCard.tsx:47` | Interactions description | "{n} of 11 turned off. Changes save at once." | Keep | — (state) | |
| `agents/settings/InteractionsCard.tsx:48` | Interactions description | "Everything is allowed until you turn it off. Changes save at once." | Split | Tip: "What it may do to other agents and their work, and what they may do to it. Each is allowed until you turn it off." / Visible: "Nothing turned off. Changes save at once." | |
| `agents/settings/InteractionsCard.tsx:54` | footer `fhelp` | "Switches set for this agent override the default." | Move | Tip (beside Reset all): same text | |
| `agents/settings/InteractionsCard.tsx:82` | SwitchRow help ×11 (from `interactions-model.ts:22-37`) | "Assign or hand off work to another agent, including new subtasks." … "Other agents may change its instructions, settings, skills or tools." | Move | Tip: each row's text as is | |

#### Agent settings: Instructions

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `agents/settings/InstructionsSection.tsx:69` | SectionTitle intro | "The files that tell {name} how to work. It reads {entry} first, which can point to the others. Agents can suggest edits; you decide." | Move | Tip: same text | |
| `agents/settings/InstructionsSection.tsx:76` | `card planned` fallback | "{name}'s harness doesn't read instruction files. What it's told comes from its prompt template, under Model and runtime → Advanced." | Keep | — (why the editor is missing) | |
| `agents/settings/InstructionsSection.tsx:92` | `ps-banner` (external) | "These files live in a folder outside Paperclip ({path}). Edits here change that folder." | Keep | — (state + consequence) | |
| `agents/settings/InstructionsSection.tsx:198` | SettingsCard description (From connections) | "Its apps add these when the connection is available for the task. Access can also depend on the task's responsible person and on action permissions. Edit them on the app's page." | Move | Tip: same text | |
| `agents/settings/InstructionsSection.tsx:205` | `fhelp ag-warn` | "These instructions are turned off for this connection." | Keep | — (state) | |
| `agents/settings/InstructionsSection.tsx:209` | `fhelp ag-warn` | "Finish this connection's setup before agents get its instructions." | Keep | — (state) | |
| `agents/settings/InstructionsSection.tsx:388` | Dialog description (Delete file) | "{name} stops reading it from the next run." | Keep | — (destructive consequence) | |
| `agents/settings/InstructionsSection.tsx:517` | `fhelp` in Rename popover | "Your unsaved edit is saved under the new name." | Keep | — (consequence of the pending action) | |
| `agents/settings/InstructionsSection.tsx:576` | `fhelp` in New file popover | "A path inside the instructions folder, such as research/sources.md." | Move | Tip (beside the path input): same text | |
| `agents/settings/InstructionsSection.tsx:733` | SettingsRow help (Where the files live) | "Managed: Paperclip keeps them, with revisions. External: a folder on the server's disk that you manage." | Move | Tip: same text | |
| `agents/settings/InstructionsSection.tsx:744` | SettingsRow help (Folder) | external: "An absolute path on the machine Paperclip runs on. The folder and its entry file must already exist." / managed: "Paperclip's own folder for this agent." | Move | Tip: same texts | |
| `agents/settings/InstructionsSection.tsx:763` | SettingsRow help (Entry file) | external: "The file the agent reads first, inside the folder. Paperclip checks it's there before switching." / managed: "The file the agent reads first. Usually AGENTS.md; a new name starts from the current one." | Move | Tip: same texts | |
| `agents/settings/InstructionsSection.tsx:769` | SettingsRow help (Prompt template, legacy) | "An older setting that still sends its own text at the start of every run, next to these files." | Move | Tip: same text | |
| `agents/settings/InstructionsSection.tsx:772` | `fhelp ag-warn` (legacy) | "A legacy prompt template is still in use. Move what it says into {entry}, then turn it off." | Keep | — (state + action) | |

#### Agent settings: Skills

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `agents/settings/SkillsSection.tsx:112` | SectionTitle intro | "What {name} knows how to do, from the company's skill library." | Move | Tip: same text | |
| `agents/settings/SkillsSection.tsx:124` | `card planned` fallback | "{name}'s harness doesn't take skills." | Keep | — (why the list is missing) | |
| `agents/settings/SkillsSection.tsx:132` | SettingsCard description (CardNote) | "Given to each run as it starts." / "Installed in the harness." + " Changes save at once." | Keep | — (how skills reach this agent now; save behaviour) | |
| `agents/settings/SkillsSection.tsx:152` | `ps-list-meta` (built-in skill row) | "The Runner gives {name} Paperclip's tools and rules directly." / "Paperclip adds it to every run in this harness." | Keep | — (why the row has no switch) | |
| `agents/settings/SkillsSection.tsx:191` | `ps-list-meta` suffix | " · Recommended for agents that lead others" | Keep | — (short per-item hint in a list row; no room for a tip per row) | |

#### Agent settings: Tools and channels

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `agents/settings/ToolsSection.tsx:101` | SectionTitle intro | "The apps, tools and chat channels {name} can use." | Move | Tip: same text | |
| `agents/settings/ToolsSection.tsx:106` | SettingsCard description (What its runs get) | "{n} tools, from {n} access profiles. Its instructions can narrow this, never widen it." | Split | Tip: "Its instructions can narrow this, never widen it." / Visible: "{n} tools, from {n} access profiles." | |
| `agents/settings/ToolsSection.tsx:116` | empty state | "It can't use any app tools. Install an app below, or assign an access profile." | Keep | — (empty state + next step) | |
| `agents/settings/ToolsSection.tsx:167` | SettingsCard description (Apps it carries) | "An installed app's tools are loaded into every run. Installing one also lets the agent use it; an app it may use but doesn't carry adds nothing to its runs." | Move | Tip: same text | |
| `agents/settings/ToolsSection.tsx:220` | SettingsCard description (Access profiles) | "Profiles decide which tools a run gets. With several, it can use anything any of them allows." | Move | Tip: same text | |
| `agents/settings/ToolsSection.tsx:257` | empty state | "No access profile applies to it, so it has no app tools beyond what its installed apps allow." | Keep | — (empty state) | |
| `agents/settings/ToolsSection.tsx:302` | SettingsCard description (Policies) | "Rules the gateway checks on every call it makes, in order. Set Ask first on an action from its app's page." | Move | Tip: same text | |
| `agents/settings/ToolsSection.tsx:347` | custom `<header class="chead"><p>` (Recent tool calls) | "Calls it made in the last 7 days: allowed, asked about, or blocked." | Move | Tip: same text | |
| `agents/settings/ToolsSection.tsx:425` | GitHub identity note (no dedicated account) | "At the start of a run Paperclip uses the GitHub account of the person responsible for the task.{ Yours is connected as @x.}" | Keep | — (current state) | |
| `agents/settings/ToolsSection.tsx:420` | GitHub identity note (dedicated) | "@x, used only by {name}. It comes before the responsible person's GitHub." | Keep | — (current state) | |
| `agents/settings/ChannelsPanel.tsx:91` | SettingsCard description (Channels) | "Where people reach {name} outside Paperclip. Each conversation becomes a task." | Move | Tip: same text | |

#### Agent settings: Memory

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `agents/settings/MemorySection.tsx:72` | SectionTitle intro | "What {name} remembers between runs, and where. It depends on the harness: {harness}." | Move | Tip: same text | |
| `agents/settings/MemorySection.tsx:76` | SettingsRow help (Its own folder) | "Notes the agent keeps in its folder, which Paperclip saves after each run." | Move | Tip: "Notes the agent keeps in its own folder (AGENT_HOME). Paperclip restores it before a run and saves the changes." | Restored before execution, changes saved at turn boundaries: `server/src/services/agent-instruction-working-copies.ts:85`. |
| `agents/settings/MemorySection.tsx:84` | `fhelp` (agent files) | "The para-memory-files skill writes MEMORY.md, memory/ and life/ here. It's assigned to this agent." / "It isn't assigned to this agent, so nothing tells it to keep notes there." | Split | Tip: "The para-memory-files skill writes MEMORY.md, memory/ and life/ here." / Visible: "The para-memory-files skill is assigned." or "…isn't assigned, so nothing tells it to keep notes here." | |
| `agents/settings/MemorySection.tsx:94` | `fhelp` (no folder) | "{harness} has no agent folder, so each session starts with no memory unless it has a memory connector." | Keep | — (current state) | |
| `agents/settings/MemorySection.tsx:103` | SettingsRow help (Claude Code auto memory) | "Claude Code's built-in memory. Paperclip can't read it." | Move | Tip: same text | |
| `agents/settings/MemorySection.tsx:119` | `fhelp` (per-session) | "Through the Paperclip Runner, Claude gets a fresh config folder each session, so these notes don't carry over." | Keep | — (explains the current state; same span holds a link) | |
| `agents/settings/MemorySection.tsx:120` | `fhelp` (shared) | "Notes land in Claude's config folder by project, outside the API, and every agent in the same project shares them." | Keep | — (explains the current state; same span holds a link) | |
| `agents/settings/MemorySection.tsx:122` | `fhelp` with link | "To rely on the agent's folder alone, set CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 under Secrets and variables." | Keep | — (holds link) | |
| `agents/settings/MemorySection.tsx:132` | SettingsRow help (Memory connectors) | "Mem0, Zep, Supermemory, Cognee or Honcho, assigned like any tool connection." | Move | Tip: same text | |
| `agents/settings/MemorySection.tsx:137` | `ag-static-text` | "None assigned.{ Memory connectors are off on this instance.}" | Keep | — (state) | |
| `agents/settings/MemorySection.tsx:155` | SettingsCard description (Memory files) | "What the agent has written to MEMORY.md, memory/ and life/. Edit them under Instructions." | Move | Tip: same text | |
| `agents/settings/MemorySection.tsx:187-188` | `ag-note--quiet` | "One memory for every harness is still to come" / "These three don't know about each other yet, so a lesson saved in one isn't seen by the others." | Move | Tip (on "What applies to this agent"): "These three don't share notes yet: a lesson saved in one isn't seen by the others." | |

#### Agent settings: Secrets and variables

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `agents/settings/SecretsSection.tsx:69` | SectionTitle intro | "Values {name}'s runs receive as environment variables." | Move | Tip: same text | |
| `agents/settings/SecretsSection.tsx:74` | Variables description (CardNote) | "Set for every run of this agent, on top of the project's. Secret values are never shown here." | Rewrite | Tip: "Set for every run of this agent. On a project's task, a project variable with the same name wins." / Visible: "Secret values are never shown here." | The project's env is merged after the agent's, so the project's value wins on a shared name: `server/src/services/heartbeat/run-preparation.ts:556-560`. |
| `agents/settings/SecretsSection.tsx:131` | Menu.Item description (value types) | "Shown here and in run logs" / "One of the company's secrets" / "Each person sets their own value" | Keep | — (option descriptions in a menu; the first is a security note) | |
| `agents/settings/SecretsSection.tsx:180` | Menu.CheckboxItem description (Required) | "Runs wait until the person has set it" | Rewrite | Visible (menu option): "Its runs fail until the person has set it" | A missing required personal secret throws `user_secret_missing` (`server/src/services/secrets.ts:4371-4375`); it is a failure only a person can resolve, with no automatic retry (`server/src/services/continuation-cause.ts:13-18`). Confirmed by the coordinator. |

#### Agent settings: Budget

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `agents/settings/BudgetSection.tsx:71` | SectionTitle intro | "How much {name} may spend, and what it has used." | Move | Tip: same text | |
| `agents/settings/BudgetSection.tsx:74` | SettingsCard description (Monthly/Lifetime limit) | "What this agent may spend across every project. Company-wide budgets are set in company settings." | Move | Tip: same text | |
| `agents/settings/BudgetSection.tsx:94` | paused banner | "{name} is paused: it reached its budget. Raise the limit, then resume it." | Rewrite | Visible: "{name} is paused: it reached its budget. Raising the limit resumes it." | A budget raise (or a new UTC month) releases a budget-owned pause on the next evaluation: `server/src/services/budgets.ts:716-725` (`resumeScopeFromBudget`, :421-431); `upsertPolicy` queues that evaluation (:925). |
| `agents/settings/BudgetSection.tsx:113` | SettingsRow help (Limit) | "Leave it empty for no limit." | Move | Tip: same text | |
| `agents/settings/BudgetSection.tsx:170` | Menu.Item description (Pause {name}) | "New runs wait until the limit is raised" | Rewrite | Visible (menu option): "Pauses it and stops its running work until the limit is raised" | A hard stop pauses the scope and cancels its admitted work (`pauseAndCancelScopeForBudget`): `server/src/services/budgets.ts:407-418`, `:706-708`; cancelled task runs resume once via `budget-resume-continuation.ts`. |
| `agents/settings/BudgetSection.tsx:173` | Menu.Item description (Only warn me) | "Runs carry on past the limit" | Keep | — (option description in a menu) | |
| `agents/settings/BudgetSection.tsx:216` | SettingsCard description (Usage this month) | "From the cost ledger, since the first of the month (UTC)." | Move | Tip: same text | |
| `agents/settings/BudgetSection.tsx:241` | SettingsRow help (Tokens) | "Subscription tokens are included in the plan." | Move | Tip: same text | |
| `agents/settings/BudgetSection.tsx:275` | SettingsRow help (Recent runs) | "The last {n}: {tokens} tokens{, n failed}." | Keep | — (state summary) | |

#### Agent settings: API keys

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `agents/settings/KeysSection.tsx:62` | SectionTitle intro | "Keys that let outside tools act as {name}." | Move | Tip: same text | |
| `agents/settings/KeysSection.tsx:65` | SettingsCard description | "Anyone with a key can act as this agent. Revoke keys you no longer use." | Split | Tip: "Revoke keys you no longer use." / Visible: "Anyone with a key can act as this agent." (security note) | |
| `agents/settings/KeysSection.tsx:117` | Dialog description (Copy the key now) | "It isn't shown again. Store it where the tool that uses it can read it." | Keep | — (must-see warning) | |
| `agents/settings/KeysSection.tsx:146` | Dialog description (Revoke) | "Tools using it stop working at once." | Keep | — (destructive consequence) | |

#### Agent settings: History

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `agents/settings/HistorySection.tsx:63` | SectionTitle intro | "Every change to {name}'s configuration, and everything it did." | Move | Tip: same text | |
| `agents/settings/HistorySection.tsx:66` | SettingsCard description (Revisions) | "Each save of the agent's settings is a revision. Rolling back to one restores the settings it saved, as a new revision." | Move | Tip: same text | |
| `agents/settings/HistorySection.tsx:116` | Dialog description (Roll back) | "{name}'s settings go back to how revision {n} saved them. That's saved as a new revision, so this can be undone too." | Keep | — (consequence in a confirm dialog) | |
| `agents/settings/HistorySection.tsx:225` | SettingsCard description (Actions) | "What the agent did, from the audit log." | Move | Tip: same text | |

#### Agent settings: Advanced (YAML)

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `agents/settings/AdvancedSection.tsx:52` | SectionTitle intro | "{name}'s whole setup as one YAML document: profile, runtime, instructions, skills, tools, channels, permissions, secrets and keys. Anything you leave out stays as it is." | Move | Tip: same text | |
| `agents/settings/AdvancedSection.tsx:92` | `ps-list-note` (403) | "You can't read all of {name}'s configuration, so it can't be shown as one document." | Keep | — (why the editor is missing) | |
| `agents/settings/AdvancedSection.tsx:236` | SettingsCard description (Created in this save) | "Copy each key now. Its token isn't shown again once you leave this page." | Keep | — (must-see warning) | |
| `agents/settings/AdvancedSection.tsx:311` | interrupted-save alert | "Steps after it weren't tried. Reload the saved configuration, then make the rest of your changes again." | Keep | — (error state, what to do) | |
| `agents/settings/AdvancedSection.tsx:341` | SettingsCard description (n changes to save) | "A save runs these in this order, each through its own settings. If one fails, the ones before it stay saved." | Move | Tip: same text | |
| `agents/settings/AdvancedSection.tsx:442-477` | "What the document can hold" `<details>` reference (`dd` lines) | "The profile." … "Puts back an earlier configuration. Save it on its own." | Keep | — (reference already folded behind a disclosure; too long and structured for a tip) | |

#### Runs

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `runs/RunActivity.tsx:313` | `cap` under a proposed plan | "On a standard or planning task, the task's Plan document takes this plan, with a request to approve it." | Move | Tip (beside "Proposed a plan"): same text | |
| `runs/RunInput.tsx:38-45` | `rm-note` with Info glyph (Input tab intro) | "What Paperclip sent {harness} to start this run. Before it calls the model, {harness} adds its own system prompt, tool definitions and session history, so this isn't the model's full input. Only a provider trace records those exact requests, when it's turned on{, and only instance admins can see one}." | Split | Tip: "What Paperclip sent {harness} to start this run. Before calling the model, {harness} adds its own system prompt, tool definitions and session history, so this isn't the model's full input." / Visible: "Only a provider trace records the exact requests." (holds the trace link for admins) | |
| `runs/RunInput.tsx:57-59` | empty state | "Paperclip records what it sends once {harness} starts. This run hasn't started it yet." / "Paperclip didn't record what it sent for this run. Runs that ended before their harness started have nothing here." | Keep | — (empty state with reason) | |
| `runs/RunInput.tsx:135` | `<details>` summary caption (Wake context) | "JSON · what Paperclip knew about this wake" | Move | Tip: "What Paperclip knew about this wake, as JSON." | |
| `runs/RunTrace.tsx:113-117` | empty state (no trace) | "{It was deleted / removed after 24 hours.} A provider trace records every raw request and response between {harness} and the model provider, including the full system prompt, tool definitions and message history. Only instance admins can see traces, and each is deleted after 24 hours." | Split | Tip: "A provider trace records every raw request and response between {harness} and the model provider, including the full system prompt, tool definitions and message history. Only instance admins can see traces; each is deleted after 24 hours." / Visible: "It was deleted." / "It was removed after 24 hours." | 24 h: `server/src/services/provider-trace-store.ts:20`; admin-only reads `server/src/routes/agents.ts:7642`. |
| `runs/RunTrace.tsx:126-135` | `cap` under Rerun with trace | "{You can rerun with a trace once this run ends. / This harness can't record a provider trace.} To trace every run of {agent}, turn on "Capture raw provider traces" under Debugging in the agent's runtime settings." | Keep | — (disabled reason; holds link) | |
| `runs/RunTranscript.tsx:114` | `rm-note` (plain lines) | "ui-new can't read {harness}'s output as a structured transcript yet, so it shows as plain lines.{ This run used Paperclip's native runtime.}" | Keep | — (why the transcript looks this way) | |
| `runs/RunModal.tsx:610` | Menu.Item description (Resume) | "The process was lost. Pick up from where this run stopped." | Keep | — (option description in a menu) | |
| `runs/RunModal.tsx:615` | Menu.Item description (Retry) | "Send the same request again as a new run." | Keep | — (option description in a menu) | |
| `runs/RunModal.tsx:620` | Menu.Item description (Rerun with provider trace) | "Wake the agent on this task again, recording what the model receives." | Keep | — (option description in a menu) | |
| `runs/RunModal.tsx:754` | Workspace section caption (`cap`) | "· what Paperclip did before and after the run" | Move | Tip (beside "Workspace"): "What Paperclip did before and after the run." | |
| `runs/RunModal.tsx:762` | `rm-desk` (phone) | "Input, raw output and provider trace open on desktop" | Keep | — (why the tabs are missing) | |
| `runs/RunModal.tsx:818` | `rm-foot-hint` | "Messages go to {the chat / TES-12}" | Keep | — (state: where the composer sends) | |
| `runs/RunWatchdog.tsx:56` | `rw-body` | "No output for {age}. {The watchdog is looking into it in X.} Nothing is stopped or reassigned." | Keep | — (state; holds link) | |

#### Org

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `org/OrgAgents.tsx:351` | built-in group head `org-muted` | "Run Paperclip's routines for the whole organization.{ N more can be added.}" | Split | Tip (beside "Built-in agents"): "Run Paperclip's routines for the whole organization." / Visible: "{N} more can be added." | |
| `org/OrgAgents.tsx:363` | `org-foot` under the roster | "A hire waits here until someone approves it in the Inbox. The crown marks your primary agent, the default for new tasks and chat." | Move | Tip (by the roster header): same text | |
| `org/OrgAgents.tsx:436` | Menu.Item description (connection filter error) | "Choices show generic names until then." | Keep | — (error state in a menu) | |
| `org/OrgAgents.tsx:600` | Dialog description (Set monthly budget) | "What each of the {n} may spend per calendar month (UTC). At the limit Paperclip pauses the agent. Enter 0 to turn the limit off." | Rewrite | Tip (by "Monthly limit, in dollars"): "What each may spend per calendar month (UTC). At the limit Paperclip pauses the agent, unless its budget is set to only warn. Enter 0 to turn the limit off." | The bulk upsert (`ui-new/src/org/actions.ts:99-107`) sends no `hardStopEnabled`: a new policy defaults to hard stop, an existing one keeps its own setting (`server/src/services/budgets.ts:891,913`), so an "Only warn me" agent isn't paused. |
| `org/OrgChart.tsx:184` | legend hint (`org-push`) | "Select an agent to see what it's doing." | Move | Tip (on the chart header): same text | |
| `org/OrgChart.tsx:188` | built-in strip label | "Built-in, outside the reporting lines" | Keep | — (group label) | |
| `org/BulkEditDialog.tsx:202` | Dialog description (others selected) | "{n} also selected won't change: they run on another harness." | Keep | — (state) | |
| `org/BulkEditDialog.tsx:202` | Dialog description (default) | "Change their connection, default model, or both." | Remove | — (repeats the title and the two fields below) | |
| `org/BulkEditDialog.tsx:240` | failure alert `org-muted` | "Retry updates only these agents. Close and reopen to review their settings." | Keep | — (error state, what Retry does) | |
| `org/BulkEditDialog.tsx:272` | radio option description (connections) | "For you: {name}. Other people's tasks use their own connection." / "Company shared · API key · …" | Keep | — (option descriptions) | |
| `org/BulkEditDialog.tsx:324` | `org-muted` under Model | "Pick a suggested model or type one your harness supports." | Move | Tip (beside "Change default model"): same text | |
| `org/BulkEditDialog.tsx:325` | `org-muted` under Model | "Only models every agent's {new/current} connection offers." | Keep | — (why the list is limited) | |
| `org/BulkEditDialog.tsx:397` | `org-muted org-small` footer note | "Applies to future runs; running work keeps its settings, and task-specific model overrides stay. A model change may start a fresh session, and existing sessions may keep their connection until they're reset." | Move | Tip (beside "Changes to apply"): same text | |

### Chat

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `chat/ChatActivity.tsx:179` | `.ch-muted` (paused) | "Resume it under Manage agent to chat." | Keep | — (why it can't chat) | |
| `chat/ChatActivity.tsx:179` | `.ch-muted` (idle) | "Runs on new messages and assignments." | Rewrite | Tip (beside "Nothing running"): "It runs when you message it or assign it work, and on its heartbeat timer if it has one." | Timer heartbeats exist (`server/src/services/heartbeat-policy.ts:8`); waking on demand/assignment is a setting that can be off (`isHeartbeatWakeOnDemandEnabled`, same file :14). Suspect only for the exact wording |
| `chat/ChatComposer.tsx:38` | `Menu.Item description=` (mode Standard) | "Discusses, plans and hands off tasks" | Keep | — (menu option description) | |
| `chat/ChatComposer.tsx:39` | `Menu.Item description=` (mode Ask) | "Discusses without creating tasks or documents" | Keep | — (menu option description) | |
| `chat/ChatComposer.tsx:40` | `Menu.Item description=` (mode Plan) | "Researches and writes up a plan before any hand-off" | Keep | — (menu option description) | |
| `chat/ChatComposer.tsx:43` | command picker label | "/new: Start a fresh session. The history stays here." | Keep | — (picker entry) | |
| `chat/ChatComposer.tsx:282` | textarea placeholder | "Message {agent}, or type / for commands" | Keep | — (placeholder) | |
| `chat/ChatComposer.tsx:403` | `.ch-cmp-hint` | "Sends when this reply finishes · /new starts a fresh session" / "/new starts a fresh session" | Split | Tip: "Type /new to start a fresh session; the history stays here." / Visible (only while a reply runs): "Sends when this reply finishes" | "/new" is also in the placeholder ("type / for commands") and the Send options menu |
| `chat/ChatComposer.tsx:418` | `Menu.Item description=` | "Send it into the reply that's going now" | Keep | — (menu option description) | |
| `chat/ChatComposer.tsx:421` | `Menu.Item description=` | "Stop this reply and start over with your message" | Keep | — (menu option description) | |
| `chat/ChatComposer.tsx:424` | `Menu.Item description=` | "Wait for the agent's next turn" | Keep | — (menu option description) | |
| `chat/ChatComposer.tsx:430` | `Menu.Item description=` | "{agent} forgets what's above. The history stays here." | Keep | — (menu option description; consequence) | |
| `chat/ChatView.tsx:399` | empty-state `.ch-muted` | "Ask a question, think something through, or describe work. {agent} plans with you here and hands the work off as tasks, which show up as cards and report back when they're done." | Split | Tip (beside "Your conversation with {agent}"): "{agent} plans with you here and hands work off as tasks, which show up as cards and report back when they're done." / Visible: "Ask a question, think something through, or describe work." | |

### Connections/apps

Scope: every non-test `.tsx` under `ui-new/src/apps/` except `apps/chat/`, plus `connectors/ConnectionSetup.tsx`. Pure loading, error, save-status and permission-reason lines are skipped (about 120 of them). MachineSignIn.tsx, the Connect page's own-server sign-in options and the Tailscale pages already use InfoTip/`info=`.

#### Top level (apps/*.tsx)

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `apps/AiConnections.tsx:83` | card header intro (custom `chead`) | "The accounts agents run on. {n} connected, {m} need attention." | Split | Tip: "The accounts agents run on." / Visible: "{n} connected, {m} need attention." | |
| `apps/AiConnections.tsx:111` | empty state | "No AI connections yet. Connect a Claude account so agents can run." | Keep | — (empty state) | |
| `apps/AiConnections.tsx:324` | usage panel caption before a check (`.cap`) | "Usage limits as the provider reports them." | Move | Tip beside Check usage: "Usage limits as the provider reports them. Each check asks the provider." | |
| `apps/Browse.tsx:93` | "Your connections" header intro | "Apps, MCP servers and accounts your agents can use." | Move | Tip: same text | |
| `apps/Browse.tsx:119` | empty state | "Nothing connected yet. Pick an app below, or connect your own MCP server." | Keep | — (empty state) | |
| `apps/Browse.tsx:123` | group title note (`ConnectionGroup note=`) | "Managed in AI connections." | Move | Tip on the "AI accounts" group title: "Managed in AI connections." | |
| `apps/Browse.tsx:242` | "Connect an app" header intro | "Give agents tools from the apps you use. You choose which agents may use each one, and which actions ask you first." | Move | Tip: same text | |
| `apps/Review.tsx:31` | "Waiting for your OK" header intro | "Actions your agents want to run that ask you first. Allow once, always allow, or decline." | Move | Tip: "Actions your agents want to run that ask you first." (the second sentence repeats the buttons) | |
| `apps/Review.tsx:108` | request body fallback | "An agent wants to run this action. Its connection asks you first." | Keep | — (the card's body when there's no preview) | |
| `apps/Review.tsx:115` | note above the Always allow button (`ap-row-meta`) | "Always allow lets this agent use this action with other arguments on this connection, within the current project when there is one." | Move | Tip beside Always allow: same text | Accurate: `server/src/services/tool-gateway.ts:2956` (`rememberActionScope`) |
| `apps/shared.tsx:162` | `AgentAccessPicker` default Switch `description` | "Current and future agents can use it." | Move | Tip on "Every agent": same text | |
| `apps/Connect.tsx:183` | can't-connect page | "Its setup needs steps this board doesn't have yet. You can still connect it as your own MCP server if it has one. Back to Connections" | Keep | — (state, holds link) | |
| `apps/Connect.tsx:253` | Vercel Connect header intro | "Create and manage the provider connector in Vercel. Paperclip stores its reference and applies agent access, policy, approval and audit controls here." | Move | Tip: same text | |
| `apps/Connect.tsx:404` | "How to connect" radio option note (`cx-option-note`, `{candidate.whenToUse}` from the gallery method) | (per-method data text) | Move | Tip per option, via `ChoiceCard info=` | |
| `apps/Connect.tsx:418` | method guidance (`guidanceMd` Markdown) | (per-method data text) | Keep | — (data that can hold links) | |
| `apps/Connect.tsx:426` | Name `Field help=` | "How this connection shows in Paperclip." | Move | Field `info`: same text | |
| `apps/Connect.tsx:433` | Vercel note (`cx-note`) | "Paperclip doesn't copy Vercel's setup forms. Create or attach the connector in Vercel, then paste its UID here. Open Vercel Connect" | Split | Tip: "Paperclip doesn't copy Vercel's setup forms: create or attach the connector in Vercel, then paste its UID here." / Visible: "Open Vercel Connect" link (or drop it: the header has the same button) | |
| `apps/Connect.tsx:445` | Connector UID `Field help=` | "Paperclip checks the connector and keeps only its reference and redacted verification details." | Move | Field `info`: same text | |
| `apps/Connect.tsx:459` | Server address `Field help=` | "The full MCP address the provider gave you. Paperclip keeps it as a secret." | Rewrite | Tip: "The full MCP address the provider gave you. If it carries a key, Paperclip stores the full address as a secret and keeps only the rest in the connection." | Only credential-bearing addresses (user info or sensitive query values) go to the vault; a plain URL is stored in the connection's config: `server/src/services/remote-url-credentials.ts:14-40`, `server/src/services/tool-access.ts:2123-2136,2379-2382` |
| `apps/Connect.tsx:507` | own OAuth app instructions (`cx-note`) | "Register Paperclip as an OAuth app with {app} (open its console), with this callback address:" | Keep | — (holds link; introduces the callback value) | |
| `apps/Connect.tsx:553` | access picker `allDescription` (gallery form) | "Current and future agents can use it, and carry its tools on every run." / else companyInstallReason or "Only a connection manager can give every agent access." | Split | Tip: "Current and future agents can use it, and carry its tools on every run." / Visible: the disabled reason | |
| `apps/Connect.tsx:730` | access picker `allDescription` (own server) | "Current and future agents can use it, and carry its tools on every run." | Move | Tip: same text | |
| `apps/Connect.tsx:828` | Server address `Field help=` (with a draft) | "Its machine sign-in draft is tied to this address. Start over to change it." | Keep | — (disabled reason) | |
| `apps/AppDetail.tsx:209` | AI account flash | "An AI account. Its sign-in, default and usage are in AI connections." | Keep | — (holds link) | |
| `apps/AppDetail.tsx:232` | Review tab header intro | "Calls to {name} that ask you first." | Move | Tip: same text | |
| `apps/AppDetail.tsx:368` | "Which agents can use it" `SettingsCard description=` (4 variants) | "The agents that run on this account." / "Every agent carries its tools on every run, so every agent may use it." / "Agents marked Installed carry its tools on every run, so they stay allowed." / "Allowed agents can use its tools when they ask for them." | Split | Tip (`info`): "Allowed agents can use its tools when they ask for them. Agents marked Installed carry them on every run." (AI: "The agents that run on this account.") / Visible: the two Installed variants, which explain the locked ticks | |
| `apps/AppDetail.tsx:445` | Actions header intro | "What agents may do with it. Ask first sends each call to Review before it runs." | Move | Tip: same text | |
| `apps/AppDetail.tsx:463` | empty state | "No actions found yet. Check for new actions once the connection works." | Keep | — (empty state) | |
| `apps/AppDetail.tsx:563` | New actions header intro | "The app added these since it was set up. They stay off until you review them." | Move | Tip: same text (the banner above already says they're off) | |
| `apps/AppDetail.tsx:719` | reconnect card fallback | "Check its settings, then run a health check from Settings." | Keep | — (recovery step) | |
| `apps/AppDetail.tsx:785` | Name `SettingsRow help=` | "How it shows in Paperclip." | Move | `info`: same text | |
| `apps/AppDetail.tsx:796` | Paused `SettingsRow help=` | "A paused connection keeps its settings, but agents can't use it." | Move | `info`: same text | |
| `apps/AppDetail.tsx:850` | AI account remove note | "To remove an AI account, use AI connections." | Keep | — (holds link) | |
| `apps/AppDetail.tsx:860` | Disconnect danger card intro | "Removes the connection and revokes its credentials. Agents lose its tools at once." | Move | Tip: same text (the confirm dialog at :878 repeats the warning) | Accurate: `server/src/services/tool-access/connections/removal.ts:215,260-336` |
| `apps/TestCall.tsx:105` | test dialog `description=` | "Runs the real action, with the permissions and credentials the agent would use." | Keep | — (must-see: the test is real) | |
| `apps/TestCall.tsx:158` | ask-first note | "The call waits in Review until someone allows it, then runs." | Keep | — (what happens in the current state) | |
| `apps/TestCall.tsx:257` | Railway `SettingsCard description=` | `{railwayApiMessage}` or "Check for new actions after connecting to see service, log and deployment access." | Split | Visible: the server's `railwayApiMessage` / Tip (`info`): the fallback sentence | |
| `apps/TestCall.tsx:260` | Railway panel intro | "Optionally, give Paperclip direct SSH access to Railway containers with a key pair it makes. Railway SSH docs" | Split | Tip: "Optionally, give Paperclip direct SSH access to Railway containers with a key pair it makes." / Visible: "Railway SSH docs" link | |
| `apps/TestCall.tsx:288` | public key field hint (`.fhelp`) | "Add it to the Railway account this authorization uses. The private key stays in Paperclip's vault. Railway key setup" | Split | Visible: "Add it to the Railway account this authorization uses. Railway key setup" / Tip: "The private key stays in Paperclip's vault." | |
| `apps/TestCall.tsx:297` | host key field hint (`.fhelp`) | "Paste the ssh.railway.com line from a known_hosts entry you checked yourself. Paperclip refuses untrusted or changed host keys." | Move | Tip on the field label: same text | |
| `apps/TestCall.tsx:308` | container access state line | "{state}. Removing the key stops new connections; remove its public key from Railway too." | Keep | — (state and destructive follow-up) | |
| `apps/TestCall.tsx:325` | Browser settings `SettingsCard description=` | "Which saved Browser Use profiles agents may use, and the most one browser run may cost." | Move | `info`: same text | |
| `apps/TestCall.tsx:378` | cost cap `SettingsRow help=` | "In US dollars. Empty uses what's left of the Paperclip budget; agents may set less." | Rewrite | Tip (`info`): "In US dollars. Empty means no cap of its own: a run is still held to what's left of any Paperclip budget that applies, and is uncapped if none does. Agents may ask for less." | The cap is the lowest of this setting, the run's own `maxCostUsd` and each matching budget's remainder; with no setting and no budget policy the run has no cap: `server/src/services/browser-use.ts:519-537` |
| `apps/TestCall.tsx:384` | saved profiles intro (`cx-static`) | "Fresh browsers are the default. A saved profile lets agents use its website logins. Manage profiles in Browser Use Cloud." | Split | Tip: "Fresh browsers are the default. A saved profile lets agents use its website logins." / Visible: "Manage profiles in Browser Use Cloud." (holds link) | |

#### Connectors (connectors/ConnectionSetup.tsx)

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `connectors/ConnectionSetup.tsx:59` | dialog `description=` (reconnect) | "Sign in again to restore this connection. Its name and who can use it stay the same." | Move | Tip: same text | |
| `connectors/ConnectionSetup.tsx:61` | dialog `description=` (resume) | "Pick up the Claude sign-in that was started for you." | Keep | — (state: a sign-in was started for you) | |
| `connectors/ConnectionSetup.tsx:62` | dialog `description=` (new) | "Add a Claude account so agents can run on it." | Remove | — (repeats the "Connect Claude" title) | |
| `connectors/ConnectionSetup.tsx:169` | How to connect `Field help=` (per option, next to `Segmented`) | "Use your Claude Pro or Max plan. Recommended." / "Pay per use with a key from the Anthropic Console." | Move | Field `info`: "Claude subscription uses your Claude Pro or Max plan (recommended). API key pays per use with a key from the Anthropic Console." | |
| `connectors/ConnectionSetup.tsx:204` | Who can use it `Field help=` (per option, next to `Segmented`) | "Everyone in the company can run agents on it." / "Only runs you're responsible for use it. It becomes your personal Claude default if you don't have one." / "Only a connection manager can share a connection with everyone." | Split | Tip (`info`): "Everyone in the company: anyone can run agents on it. Just me: only runs you're responsible for use it, and it becomes your personal Claude default if you don't have one." / Visible: the manager-only reason | Accurate: `server/src/services/ai-connections.ts:925-935` |
| `connectors/ConnectionSetup.tsx:234` | Every agent Switch `description=` | "Current and future agents can use it." / "Only a connection manager can give every agent access." | Split | Tip: "Current and future agents can use it." / Visible: the manager-only reason | |
| `connectors/ConnectionSetup.tsx:266` | hint under the agent list (`.fhelp`) | "Leave every agent unticked to keep it as your personal default only." | Move | Tip on the Agents label: same text | |
| `connectors/ConnectionSetup.tsx:278` | API key `Field help=` | "Paperclip checks the key with Anthropic before saving it." | Move | Field `info`: same text | |
| `connectors/ConnectionSetup.tsx:348` | sign-in steps | "Open the sign-in page and approve access with your Claude account." / "Claude then shows an authorization code. Paste it here." | Keep | — (steps at the point of action) | |
| `connectors/ConnectionSetup.tsx:424` | sign-in expiry (`.fhelp`) | "This sign-in stays open until {time}. You can close this dialog and come back to it." | Split | Visible: "This sign-in stays open until {time}." / Tip: "You can close this dialog and come back to it." | |

#### Advanced (apps/advanced)

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `apps/advanced/PasteConfig.tsx:108` | Paste a config header intro | "For tools that aren't in the gallery: paste the MCP config snippet from the tool's README and Paperclip shows what it found before anything is saved. Just an address? Connect your own server instead." | Split | Tip: "For tools that aren't in the gallery: paste the MCP config snippet from the tool's README. Paperclip shows what it found before anything is saved." / Visible: "Just an address? Connect your own server instead." (holds link) | |
| `apps/advanced/PasteConfig.tsx:119` | MCP config `Field help=` | "The JSON with "mcpServers" in it." | Move | Field `info`: same text | |
| `apps/advanced/PasteConfig.tsx:157` | found-nothing header line | "Check you pasted the whole snippet." | Keep | — (empty state) | |
| `apps/advanced/PasteConfig.tsx:159` | found-apps header line | "Checking a server makes a draft connection, keeps any keys as Paperclip secrets, and lists its actions before you turn it on." | Move | Tip: same text | |
| `apps/advanced/PasteConfig.tsx:160` | found-local-commands header line | "These run in a workspace, so they stay drafts until an admin maps them to an approved template." | Keep | — (why they can't go further) | Accurate: `server/src/services/tool-access.ts:698,4867` |
| `apps/advanced/PasteConfig.tsx:318` | review header intro | "It answered and listed its actions. Pick the ones agents may use; you can narrow who uses it on its page afterwards." | Split | Visible: "It answered and listed its actions." / Tip: "Pick the ones agents may use. You can narrow who uses it on its page afterwards." | |
| `apps/advanced/Profiles.tsx:120` | Access profiles header intro | "Which tools your agents can use. Build a profile once, then assign it to the agents, projects or recurring tasks that need it." | Move | Tip: same text | |
| `apps/advanced/Profiles.tsx:151` | empty state | "No access profiles yet. Pick a starting point; you choose the exact tools next." | Keep | — (empty state that leads into the choices) | |
| `apps/advanced/Profiles.tsx:158` | template tile descriptions (`TEMPLATES`, `advanced/profile-model.ts:280-284`) | "See and fetch, but never change anything." … | Keep | — (the tile's own content; a tip can't sit inside the link) | |
| `apps/advanced/Profiles.tsx:175` | group title note | "Change these from the app's page" | Move | Tip on "Made by an app's setup": same text (each row has "Open the app") | |
| `apps/advanced/Profiles.tsx:281` | Check access dialog `description=` | "What one agent can use right now, and which profiles allow it." | Move | Tip: same text | |
| `apps/advanced/ProfileDetail.tsx:136` | app-made profile flash | "An app's setup made this profile. Change its actions and who uses it from the app's page." | Keep | — (holds link) | |
| `apps/advanced/ProfileDetail.tsx:178` | empty list | "It allows no tools: agents with only this profile can't use any app tools." | Keep | — (empty state and its effect) | |
| `apps/advanced/ProfileDetail.tsx:213` | "Who has it" header intro | "An agent with several profiles can use anything any of them allows." | Rewrite | Tip: "Profiles at the same level add up. A narrower assignment replaces broader ones: a recurring task's over the agent's, the agent's over a project's, any of them over the organization default. Profiles an app's setup made always add." | Only the narrowest matching scope counts (gateway, issue, routine, agent, project, company); app-setup profiles are added on top: `server/src/services/tool-profile-binding-precedence.ts:15-45,83-110`, used at `server/src/services/tool-access-policy.ts:1279-1306` |
| `apps/advanced/ProfileDetail.tsx:297` | "Tools an app adds later" header intro | "When a connected app gains a tool, whether this profile allows it." | Move | Tip: same text | |
| `apps/advanced/ProfileDetail.tsx:308` | `NewToolsChoice` radio bodies (also ProfileWizard:484) | "New tools aren't usable until you review them." / "New tools become usable right away." | Remove | — (repeat the option titles) | |
| `apps/advanced/ProfileDetail.tsx:374` | Review new tools dialog `description=` | "Allow the ones this profile should use; the rest stay blocked." | Move | Tip: same text | |
| `apps/advanced/ProfileDetail.tsx:489` | Identifier `Field help=` | "Used in exports and the API." | Move | Field `info`: same text | |
| `apps/advanced/ProfileWizard.tsx:205` | `PageHeader numbers` muted note | "Choose which tools it allows, then who gets it." | Remove | — (the step list below shows Name, Choose tools, Assign) | |
| `apps/advanced/ProfileWizard.tsx:226` | Start from header intro | "A starting point for its tools. You choose the exact tools next." | Move | Tip: same text | |
| `apps/advanced/ProfileWizard.tsx:235` | template choice descriptions (`TEMPLATES`) | "See and fetch, but never change anything." … | Keep | — (the choice button's own content) | |
| `apps/advanced/ProfileWizard.tsx:264` | Identifier `Field help=` | "Used in exports and the API. Filled in from the name." | Move | Field `info`: same text | |
| `apps/advanced/ProfileWizard.tsx:416` | Choose tools header intro | "Tick an app for all its tools, including ones it adds later; open it to leave some out, or to pick a few." | Move | Tip: same text | |
| `apps/advanced/ProfileWizard.tsx:569` | Rules header intro | "Match tools by a name pattern (with * wildcards), a risk level, or a tool's ID. They apply on top of the choices above." | Move | Tip: same text | |
| `apps/advanced/ProfileWizard.tsx:669` | Assign header intro | "An agent with several profiles can use anything any of them allows." | Rewrite | Tip: same corrected text as ProfileDetail.tsx:213 | as ProfileDetail.tsx:213 |
| `apps/advanced/ProfileWizard.tsx:676` | organization default checkbox body | "Every agent without a profile of its own uses it. Replaces "{name}"." | Split | Tip: "Agents use it when nothing narrower applies: no profile of their own, their project's or their recurring task's." / Visible: "Replaces "{name}"." | Project and routine bindings also override the company one: `server/src/services/tool-profile-binding-precedence.ts:15-24` |
| `apps/advanced/ProfileWizard.tsx:709` | Projects and recurring tasks note (`cx-note`) | "Give a whole project or a recurring task this profile, instead of (or as well as) single agents." | Rewrite | Tip: "Give a whole project or a recurring task this profile. In a recurring task's runs its profiles replace the agent's own; an agent's own profiles replace a project's." | "As well as" suggests they add up; they don't across scopes: `server/src/services/tool-profile-binding-precedence.ts:15-45` |

#### Assistants (apps/assistant)

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `apps/assistant/AssistantConnection.tsx:78` | Connect an assistant header intro | "Use {company} from Codex, Claude Code, OpenCode or another assistant: review work, create tasks and follow up, with your account's access to this organization." | Move | Tip: same text | |
| `apps/assistant/AssistantConnection.tsx:106` | turned-off note | "Assistant connections are turned off. An instance admin can turn on … enablePublicMcp, in app settings. …" | Keep | — (why it's unavailable; button link follows) | |
| `apps/assistant/AssistantConnection.tsx:117` | invitation note (`cx-note`) | "Paste this invitation into your assistant. It sets up the connection and asks you to approve its access in Paperclip." | Split | Visible: "Paste this invitation into your assistant." / Tip: "It sets up the connection and asks you to approve its access in Paperclip." | |
| `apps/assistant/AssistantConnection.tsx:142` | manual setup note (`AUTHORIZATION_HANDOFF`, `assistant/assistant-model.ts:30`) | "Authorization commands wait for human approval. When using an assistant shell tool, keep the command running …" | Move | Tip beside "Set it up by hand": same text, tightened | |
| `apps/assistant/AssistantConnection.tsx:145` | manual setup final step | "When Paperclip asks, choose {company}, review the access, then click Connect organization. Creating tasks and adding comments may start agent work on the organization's budget." | Keep | — (step and budget warning) | |
| `apps/assistant/AssistantConnection.tsx:168` | Your connected assistants header intro | "Assistants connected as you to {company}. Revoking one stops its future calls; work it already handed off carries on." | Move | Tip: same text | |

#### Gateways (apps/gateways)

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `apps/gateways/Gateways.tsx:94` | Gateways header intro | "One MCP endpoint that exposes only the apps you assign, for a client like Cursor or Claude Desktop. Revoke its token and the whole gateway goes quiet." | Rewrite | Tip: "One MCP endpoint for a client like Cursor or Claude Desktop, exposing only the tools its access profile allows. Turn it off and every client using it goes quiet." | A gateway holds many tokens; revoking one only stops clients using that token (`apps/gateways/GatewayDetail.tsx:457,527`); the switch or archive stops all (`Gateways.tsx:43`, `GatewayDetail.tsx:711`); tools come from the profile (`Gateways.tsx:232`) |
| `apps/gateways/Gateways.tsx:105` | empty state | "No gateways yet. Group connected apps into one endpoint you can hand to a client, then revoke it in one move." | Split | Visible: "No gateways yet." / Tip: covered by the header tip above | |
| `apps/gateways/Gateways.tsx:198` | edit dialog `description=` | "Change its name, or the access profile that decides which tools it exposes." | Remove | — (repeats the fields) | |
| `apps/gateways/Gateways.tsx:199` | new dialog `description=` | "One MCP endpoint that exposes only the tools in its access profile. Hand it to a client like Cursor or Claude Desktop." | Move | Tip: same text | |
| `apps/gateways/Gateways.tsx:232` | Access profile `Field help=` | "No access profiles yet. Create one first." / "Decides which tools this gateway allows. You can change it later." | Split | Visible: the empty state with its link / Tip (`info`): "Decides which tools this gateway allows. You can change it later." | |
| `apps/gateways/Gateways.tsx:254` | new gateway note | "Need a profile with different tools? Access profiles are under Advanced." | Keep | — (holds link) | |
| `apps/gateways/GatewayDetail.tsx:160` | Calls header intro | "The last 30 days. Open a call to see its tool, decision, and redacted arguments and result." | Split | Visible: "The last 30 days." / Tip: "Open a call to see its tool, decision, and redacted arguments and result." | |
| `apps/gateways/GatewayDetail.tsx:217` | Who can use it `SettingsCard description=` | "Anyone holding an active token, limited to the tools its access profile allows." | Move | `info`: same text | |
| `apps/gateways/GatewayDetail.tsx:227` | How clients connect `SettingsCard description=` | "Add this to a client's MCP settings, with a token from the Tokens tab, or use Client snippets." | Move | `info`: same text | |
| `apps/gateways/GatewayDetail.tsx:248` | Apps in this gateway header intro | "The access profile {name} decides which tools go through: {all tools}." | Split | Tip: "The access profile decides which tools go through." / Visible: "{profile}: {all tools}" | |
| `apps/gateways/GatewayDetail.tsx:361` | Tokens header intro | "A reusable token for an outside client; its name is also the client's label. Agent runs get their own one-hour token, revoked when the run ends, so revoked rows from runs are history, not tokens you made." | Move | Tip: same text | |
| `apps/gateways/GatewayDetail.tsx:379` | Token name `Field help=` | "Also used as the client label." | Move | Field `info`: same text | |
| `apps/gateways/GatewayDetail.tsx:401` | pending tokens note | "Waiting for you to reveal. An agent created this token for you. Its value is made when you reveal it, and shown only once; until then it can't connect." | Keep | — (state and must-see) | |
| `apps/gateways/GatewayDetail.tsx:587` | Client snippets dialog `description=` | "Pick a client and copy a complete configuration. It reaches only the tools this gateway exposes, not the rest of Paperclip." | Move | Tip: same text | |
| `apps/gateways/GatewayDetail.tsx:619` | no-token note | "A snippet needs the full token, and a token's secret can't be read back later, so issue one here to fill them in." | Keep | — (why the snippets are incomplete) | |
| `apps/gateways/GatewayDetail.tsx:711` | Archive danger card intro | "Takes it offline for every client; its tokens stop working. Type the gateway's name to confirm." | Keep | — (destructive warning and instruction) | |

#### Identities (apps/identities)

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `apps/identities/Identities.tsx:96` | "Whose account it is" `Card description=` | "{type label}. {connectionTypeText}" e.g. "… Each person connects their own account. Agents act as the person whose work it is." | Split | Visible: the type label (state) / Tip: `connectionTypeText` (`identities/identity-model.ts:17-27`) | |
| `apps/identities/Identities.tsx:130` | your-account row meta | "Agents can't use this app for your work until you connect." / "Work for you uses the organization's account until you connect your own." | Keep | — (state) | |
| `apps/identities/Identities.tsx:146` | your-account row detail | "Just me: agents act as you when they use it for your work." | Keep | — (says how this account is used) | |
| `apps/identities/Identities.tsx:268` | delegation note (`cx-note`) | "Beyond your own tasks: these agents may use your account for any work they do." | Keep | — (security note that matters before adding one) | |
| `apps/identities/Identities.tsx:363` | audience note (`cx-note`) | "This is about whose work may use it; which agents have the connection is set below." | Move | Tip on "Whose work can use the organization's account": same text | |

#### Pools (apps/pools)

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `apps/pools/Pools.tsx:103` | Connection pools header intro | "Hand each new task to the next of several AI connections, so one account's limits don't stop the work." | Move | Tip: same text | |
| `apps/pools/Pools.tsx:223` | new pool note | "Created paused. Turn it on from its page when you're ready." | Keep | — (what happens on create) | |
| `apps/pools/Pools.tsx:388` | Connections `SettingsCard description=` | "New tasks go to the next connection in this order. Changes apply to new tasks." | Move | `info`: same text | |
| `apps/pools/Pools.tsx:396` | Pool on Switch `description=` | "Agents set to this pool run on its connections." | Move | Tip: same text | |
| `apps/pools/Pools.tsx:440` | Advanced `SettingsCard description=` | "Skip connections near their usage limit, and pick each connection's model." | Remove | — (repeats the toggle label and the model pickers) | |
| `apps/pools/Pools.tsx:447` | skip-near-limit Switch `description=` | "Uses each provider's reported usage, where it reports one." | Move | Tip: same text | |
| `apps/pools/Pools.tsx:450` | Skip at `SettingsRow help=` | "Percent of a usage limit." | Move | `info`: same text | |
| `apps/pools/Pools.tsx:495` | Used by header intro | "Agents whose AI connection is this pool." | Move | Tip: same text | |
| `apps/pools/Pools.tsx:499` | empty state | "No agents yet. Choose the pool in an agent's Model and runtime settings." | Keep | — (empty state) | |
| `apps/pools/Pools.tsx:522` | Remove danger card intro | "The connections in it are kept. Agents using it need another AI connection." | Keep | — (destructive consequence) | |

#### Setups (apps/setups)

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `apps/setups/SetupExtras.tsx:112` | Whose account `Field help=` | "This decides who the connection acts as. It can't be changed later; connect another account instead." | Split | Tip (`info`): "This decides who the connection acts as." / Visible: "It can't be changed later; connect another account instead." | |
| `apps/setups/SetupExtras.tsx:127` | identity radio option notes (`IDENTITY_LABELS`, `setups/setups-model.ts:27-30`) | "One shared credential. You choose which people and agents may use it." … | Move | Tip per option, via `ChoiceCard info=` | |
| `apps/setups/SetupExtras.tsx:156` | Google services `Field help=` | "Agents get only these. Google's consent screen asks for exactly this access." | Move | Field `info`: same text | |
| `apps/setups/SetupExtras.tsx:167` | Drive Switch `description=` (`setups-model.ts:62`) | "Docs, Sheets and Slides" | Keep | — (part of the service's name) | |
| `apps/setups/AggregatorConnect.tsx:98` | MCP address `Field help=` (`urlHelp`, `setups-model.ts:95,105`) | "Keep Composio Connect's address, or paste the MCP address from a Composio session you set up yourself." / Arcade variant | Move | Field `info`: same text | |
| `apps/setups/AggregatorConnect.tsx:125` | header intro | "{app description} Paperclip decides which of its tools agents get; app sign-in happens in {name}." | Split | Visible: the app's description / Tip: "Paperclip decides which of its tools agents get; app sign-in happens in {name}." | |
| `apps/setups/AggregatorConnect.tsx:134` | how-to steps (`setups-model.ts:90,99`) | "Connect to Composio and sign in with your account." … | Keep | — (steps at the point of action) | |
| `apps/setups/AggregatorConnect.tsx:148` | Sign-in `Field help=` (`authHelp`, `setups-model.ts:96,106`) | "Session addresses and headers come from your own Composio setup." / Arcade variant | Move | Field `info`: same text | |
| `apps/setups/AggregatorConnect.tsx:152` | Token `Field help=` | "Just the token, without the word Bearer." | Move | Field `info`: same text | |
| `apps/setups/AggregatorConnect.tsx:196` | access picker `allDescription` | "Current and future agents can use it, and carry its tools on every run." | Move | Tip: same text | |
| `apps/setups/AggregatorAccounts.tsx:52` | Apps through {name} `Card description=` | "What {name} has connected for this account. Which of its tools agents may use is set below." | Move | Tip: same text | |
| `apps/setups/AggregatorAccounts.tsx:150` | Sync Arcade accounts note (`cx-note`) | "The gateway works without this. A project key and user id let Paperclip list the accounts behind it; the key is stored and used only for that." | Move | Tip on the "Sync Arcade accounts" summary: same text | |
| `apps/setups/AggregatorAccounts.tsx:151` | Project API key `Field help=` | "From Arcade, for the same project as this gateway." | Move | Field `info`: same text | |
| `apps/setups/AggregatorAccounts.tsx:154` | Arcade user id `Field help=` | "The end-user id this gateway signs in as. It may not be your email." | Move | Field `info`: same text | |
| `apps/setups/AggregatorAccounts.tsx:199` | App `Field help=` | "Composio's name for it, such as gmail, notion or googlesheets." | Move | Field `info`: same text | |
| `apps/setups/AppExtras.tsx:62` | instructions Switch `description=` | "Added to the prompt of every agent that can use this connection." | Move | Tip: same text | |
| `apps/setups/AppExtras.tsx:138` | Agent instructions `Card description=` | "What agents that can use {name} are told about it." | Move | Tip: same text | |
| `apps/setups/AppExtras.tsx:191` | Honcho workspace `Card description=` | "The workspace agents remember into and recall from." | Move | Tip: same text | |
| `apps/setups/AppExtras.tsx:236` | Sheets share step (`cx-note`) | "In Google Sheets, choose Share and add this email as an Editor. Then paste the sheets' links below." | Keep | — (step at the point of action) | |
| `apps/setups/AppExtras.tsx:243` | sheet links `Field help=` | "{n} sheets ready to connect." / "One link per line. Both …/edit and …/edit#gid=… links work." | Split | Visible: the count / Tip (`info`): "One link per line. Both …/edit and …/edit#gid=… links work." | |
| `apps/setups/AppExtras.tsx:281` | Sheets agents can open `Card description=` | "Agents can open only the sheets listed here, and only once each is shared with the robot account." | Move | Tip: same text | |
| `apps/setups/CatalogRows.tsx:94` | catalog group title note | "{n} apps through a gateway you connect. Sign-in to each app happens in the provider." | Split | Visible: "{n} apps" / Tip: "Each goes through a gateway you connect. Sign-in to each app happens in the provider." | |
| `apps/setups/CatalogRows.tsx:166` | provider choice note | "Which service should handle the connection? It signs in to {app} and makes the calls." | Split | Visible: "Which service should handle the connection?" / Tip: "It signs in to {app} and makes the calls." | |
| `apps/setups/CatalogRows.tsx:298` | Arcade continue note | "Your Arcade gateway is saved. {app}'s sign-in is managed inside Arcade; an agent may also be asked to authorize it the first time it uses a tool." | Split | Visible: "Your Arcade gateway is saved." / Tip: the rest | |
| `apps/setups/CatalogRows.tsx:349` | Manage dialog `description=` | "Accounts and sign-in are managed in the provider. Which of its tools agents may use is set on the gateway's page." | Move | Tip: same text | |
| `apps/setups/CatalogRows.tsx:390` | gateway line in Manage dialog | "Through {gateway}. Its permissions apply to every app on this gateway. Open in {provider}" | Keep | — (holds links; must-see scope) | |

#### Tailscale (apps/tailscale)

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `apps/tailscale/TailscalePage.tsx:238` | empty state | "No tailnet connected yet. Connect one to pick its machines for SSH environments." | Keep | — (empty state; the purpose is already in the InfoTip) | |

### Connections/apps: chat endpoints

#### Setup (ChatRoutes, ChatConnect, GitHubSetup, SlackSetup setup flows, PhotonConnect, EmailSetup)

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `apps/chat/ChatRoutes.tsx:184` | "turned off" card body | "This Paperclip doesn't have {GitHub review bots \| chat connectors} turned on. An instance admin can turn it on in the app settings' features. Back to Connections" | Keep | — (disabled reason, holds link) | Features toggle exists: `settings/app/FeaturesCard.tsx` |
| `apps/chat/ChatConnect.tsx:87` | purpose header sub (`.ap-connect-title p`) | "What should this {name} connection do?" | Keep | — (the question the two choices answer) | |
| `apps/chat/ChatConnect.tsx:96` | choice card desc (`.ch-choice`) | "People in {name} can start and continue Paperclip tasks with one agent." | Move | Tip on "Chat with an agent": "People in {name} start and continue Paperclip tasks with one agent." | |
| `apps/chat/ChatConnect.tsx:105` | choice card desc (`.ch-choice`) | "Agents use {name} actions and data while they work." | Move | Tip on "Use it as an agent tool": "Agents use {name} actions and data while they work." | |
| `apps/chat/ChatConnect.tsx:156` | setup header sub (fallback, no endpoint yet) | "Pick the agent people will talk to, then connect it." | Remove | — (repeats the step list and the field label "Which agent do people talk to?") | |
| `apps/chat/ChatConnect.tsx:321` | `Field help=` | "It stays the same for this connection. Connect another one for a different agent." | Move | Tip (Field `info`): "The agent can't be changed later. Connect another one for a different agent." | |
| `apps/chat/ChatConnect.tsx:359` | radio option desc (`.cx-row-meta`) | "Paperclip's Slack app creates and installs it in a workspace you authorize." | Move | Tip on "For me": same text | |
| `apps/chat/ChatConnect.tsx:368` | radio option desc (`.cx-row-meta`) | "Paste a Slack App configuration access token; Paperclip creates the app." | Move | Tip on "With a configuration token": same text | |
| `apps/chat/ChatConnect.tsx:376` | radio option desc (`.cx-row-meta`) | "Paste the app manifest in Slack and copy its credentials back." | Move | Tip on "Myself": same text | |
| `apps/chat/ChatConnect.tsx:468` | `.cx-note` (reconnect mode) | "Leave the fields empty to check the saved credentials again, or paste new ones from {name}." | Keep | — (how the form behaves in this mode; must see before acting) | |
| `apps/chat/ChatConnect.tsx:475` | Slack how-to steps (`.ch-howto`) | "In Slack, create a new app from a manifest … Install the app … copy its Bot User OAuth Token and its Signing Secret here." | Keep | — (setup steps to act on now) | |
| `apps/chat/ChatConnect.tsx:487` | GitHub how-to steps (`.ch-howto`, 487–489) | "Create a GitHub App under the user or organization … install it on the repositories." | Keep | — (setup steps to act on now) | |
| `apps/chat/ChatConnect.tsx:497` | webhook secret `.cx-note` | "Make one, then paste it into the App's webhook settings. It's shown once." | Keep | — (instruction + "shown once" warning) | |
| `apps/chat/ChatConnect.tsx:498` | webhook secret `.cx-note` | "A secret is saved. Make a new one only if you lost it." | Keep | — (state + caution) | |
| `apps/chat/ChatConnect.tsx:607` | Verify step `.cx-note` | "Paperclip is waiting for {name} to call its address. Save the address in {name}'s settings (and, for Slack, save the manifest), then check again. This page checks every few seconds." | Split | Tip: "This page checks again every few seconds." / Visible: "Waiting for {name} to call Paperclip's address. Save it in {name}'s settings (for Slack, save the manifest), then Verify." | |
| `apps/chat/ChatConnect.tsx:657` | Try step instructions (`how()`, 657–665) | "Send {bot} a direct message in Slack, or use {command}." etc. | Keep | — (the action to take now) | |
| `apps/chat/GitHubSetup.tsx:129` | enrollment `.cx-note` | "This Paperclip receives GitHub's events through Paperclip Cloud, which needs this instance enrolled first. Enrollment isn't part of this board: …" | Keep | — (why setup can't continue here) | |
| `apps/chat/GitHubSetup.tsx:230` | create step intro `<p>` | "Paperclip creates a GitHub App for {agent} from a manifest. You confirm it on GitHub, then install it on the repositories it should review." | Move | Tip (beside the setup title or the GitHub account field): same text | |
| `apps/chat/GitHubSetup.tsx:256` | `Field help=` | "Up to 34 characters. It becomes the bot's @mention." | Move | Tip (Field `info`): "It becomes the bot's @mention. Up to 34 characters." | `maxLength={34}` enforces the limit |
| `apps/chat/GitHubSetup.tsx:345` | identity step `<p>` | "Link your GitHub account, so your mentions of the bot use your Paperclip permissions." | Split | Tip: "Your mentions of the bot then use your Paperclip permissions." / Visible: "Link your GitHub account." | |
| `apps/chat/SlackSetup.tsx:107` | managed setup `<p>` (no workspaces) | "Authorize Paperclip's Slack app in your workspace first. Slack brings you back here." | Keep | — (next step) | |
| `apps/chat/SlackSetup.tsx:229` | config token how-to (`.ch-howto`, 229–233) | "In Slack's app settings, find Your App Configuration Tokens … Paperclip uses it once to create the app." | Keep | — (setup steps; "uses it once" is a security note) | |
| `apps/chat/SlackSetup.tsx:259` | app created `<p>` | "{app} is created. Install it with your Slack account; Paperclip links that account to you and sends you a welcome message." | Split | Tip: "Paperclip links that Slack account to you and sends you a welcome message." / Visible: "{app} is created. Install it with your Slack account." | |
| `apps/chat/PhotonConnect.tsx:50` | intro `<p>` | "Connect {agent} to Photon Cloud. Photon Pro offers direct messages through a shared line; a dedicated number also takes group chats, each turned on separately." | Split | Tip: "Photon Pro offers direct messages through a shared line; a dedicated number also takes group chats, each turned on separately." / Visible: "Connect {agent} to Photon Cloud." | |
| `apps/chat/PhotonConnect.tsx:63` | reconnect `.cx-note` | "Reconnecting keeps this project and {line}. Leave the secret empty to reuse the saved one." | Keep | — (mode state + how the form behaves) | |
| `apps/chat/PhotonConnect.tsx:119` | shared-line `.cx-static` | "Direct messages only. Enroll each sender on your Photon project's Users page, then use the number Photon gives that sender. People still link their Paperclip accounts; group chats can't be turned on." | Split | Tip: "Enroll each sender on your Photon project's Users page, then use the number Photon gives that sender. People still link their Paperclip accounts." / Visible: "Direct messages only; group chats can't be turned on." | |
| `apps/chat/EmailSetup.tsx:168` | header sub (`.ap-connect-title p`) | "Email to the address becomes a task for the agent. Replies stay in the same task." | Move | Tip beside "Give an agent an email address": same text | |
| `apps/chat/EmailSetup.tsx:182` | `Field help=` (resume) | "This inbox's setup already names its agent." | Keep | — (disabled reason) | |
| `apps/chat/EmailSetup.tsx:219` | `Field help=` | "Get a key" (link) | Keep | — (holds link) | |
| `apps/chat/EmailSetup.tsx:321` | `Field help=` per Segmented option | "AgentMail calls this Paperclip's public address." / "Paperclip keeps a live connection open; no public address needed." | Move | Tip (Field `info`): "Live connection: Paperclip keeps a connection to AgentMail open, so no public address is needed. Webhook: AgentMail calls this Paperclip's public address." | |

#### Endpoint page (ChatEndpointPage, TaskDefaults, GitHubBot, SlackSetup on the page)

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `apps/chat/ChatEndpointPage.tsx:208` | Card description ("Check it works") | "{agent} sends you a direct message in Slack." | Move | Tip: "{agent} sends you a direct message in Slack." | |
| `apps/chat/ChatEndpointPage.tsx:229` | Card description ("Task defaults") | "The project and workspace new conversations' tasks get. Existing tasks keep theirs." | Move | Tip: same text | |
| `apps/chat/ChatEndpointPage.tsx:272` | Card description ("Call my phone") | "Your own number {agent} may call about your tasks." | Move | Tip: same text | |
| `apps/chat/ChatEndpointPage.tsx:346` | Card description (Photon shared line) | "A shared Photon line takes direct messages only; enroll senders in Photon and link them in Access." | Keep | — (why the channel toggles are disabled) | toggles `disabled` when `photonAllocation === "shared"` (:374) |
| `apps/chat/ChatEndpointPage.tsx:348` | Card description (Slack "Channels") | "Invite {agent} to a channel in Slack to add it here." | Move | Tip: same text (or append to the "No channels yet." empty state) | |
| `apps/chat/ChatEndpointPage.tsx:349` | Card description (other providers) | "Turn each channel or group on or off." | Remove | — (says what the toggles already show) | |
| `apps/chat/ChatEndpointPage.tsx:429` | Toggle `description=` (Discord DMs) | "People must also allow direct messages in the server's privacy settings." | Move | Tip: same text | |
| `apps/chat/ChatEndpointPage.tsx:437` | Toggle `description=` (Slack at-mention) | "A channel message needs an @mention of this bot to start a conversation. Replies in existing threads and direct messages don't." | Move | Tip: same text | |
| `apps/chat/ChatEndpointPage.tsx:446` | Toggle `description=` (Teams group chats) | "The bot may take part in group chats it's installed in." | Move | Tip: "Only group chats the bot is installed in." | |
| `apps/chat/ChatEndpointPage.tsx:453` | `.cx-note` (Telegram group command) | "Telegram doesn't pass ordinary mentions to bots in groups: use this command, or reply to the bot." | Move | Tip beside "Group command": same text | |
| `apps/chat/ChatEndpointPage.tsx:495` | Card description ("Inbox") | "Email to this address becomes tasks for {agent}; replies stay in the same task." | Move | Tip: same text | |
| `apps/chat/ChatEndpointPage.tsx:502` | fact value | "Live connection (no public address needed)" | Keep | — (value label; parenthetical is short) | |
| `apps/chat/ChatEndpointPage.tsx:519` | `.cx-note` | "The AgentMail account and which agents may use it are on its connection page." | Keep | — (holds link) | |
| `apps/chat/ChatEndpointPage.tsx:546` | Card description ("Phone line") | "A Speko phone number people can call to reach the agent." | Move | Tip: same text | |
| `apps/chat/ChatEndpointPage.tsx:588` | Toggle `description=` (guest intake) | "Under a task-scoped low-trust policy. Private calls still need their code approved here." | Move | Tip: "New tasks run under a task-scoped low-trust policy. Private calls still need their code approved here." | `doc/plans/2026-09-11-speko-voice-e2e-runbook.md:422` |
| `apps/chat/ChatEndpointPage.tsx:617` | Card description ("Calls waiting for you") | "A private incoming call goes ahead once you enter the code the caller hears." | Move | Tip: same text | |
| `apps/chat/ChatEndpointPage.tsx:689` | `.cx-note`, sole body of "Private voice access" card | "Browser calls use the signed-in person's access, bound to the chosen agent and task. A private incoming call needs its spoken code approved in Settings; unknown callers …" | Move | Tip on the card title: same text (see judgement calls: card is then empty) | |
| `apps/chat/ChatEndpointPage.tsx:698` | `.cx-note` (GitHub Access) | "Who can ask the bot for reviews follows the repositories the GitHub App is installed on. Open the connection" | Split | Tip: "Who can ask the bot for reviews follows the repositories the GitHub App is installed on." / Visible: the "Open the connection" link | |
| `apps/chat/ChatEndpointPage.tsx:699` | `.cx-note` (AgentMail Access) | "Anyone who emails the address starts or continues a task. Which agents may use the AgentMail account is on its connection page. Open the connection" | Split | Tip: "Anyone who emails the address starts or continues a task." / Visible: "Which agents may use the AgentMail account: Open the connection" | |
| `apps/chat/ChatEndpointPage.tsx:716` | Card description ("People") | "People with linked accounts work with their own Paperclip permissions. Members" (link) | Split | Tip: "People with linked accounts work with their own Paperclip permissions." / Visible: the "Members" link | |
| `apps/chat/ChatEndpointPage.tsx:724` | `.cx-note` inside "Invite people" | "They send the command in Slack, open the bot's private link, and sign in to confirm their Slack account. The link expires after 15 minutes." | Move | Tip on "Invite people": same text | 15 min: `server/src/services/chat-channels/slack/commands.ts:162` |
| `apps/chat/ChatEndpointPage.tsx:734` | `.cx-note` under confirmation link | "Share it only with this person: they sign in and confirm their own account." | Keep | — (security note before sharing) | |
| `apps/chat/ChatEndpointPage.tsx:802` | Toggle `description=` (Guests) | "Their tasks run isolated; they can't approve actions, spend or manage access. Requests are refused when isolation isn't available." | Keep | — (security consequence of turning it on) | same wording as old UI `ui/src/pages/apps/chat/ChatEndpointDetail.tsx:860` |
| `apps/chat/ChatEndpointPage.tsx:822` | Card description ("Pull request reviews") | "Reviews the bot made, newest first. Each has a task with its run." | Move | Tip: same text | |
| `apps/chat/ChatEndpointPage.tsx:833` | empty state | "No reviews yet. Mention the bot on a pull request to ask for one." | Keep | — (empty state with next step) | |
| `apps/chat/ChatEndpointPage.tsx:891` | Card description ("Conversations") | "Each conversation is a task the agent works in." | Move | Tip: same text | |
| `apps/chat/ChatEndpointPage.tsx:1098` | `.cx-note` under Connection actions (`LIFECYCLE_GUIDANCE[p].reconnect`, `apps/chat/chat-model.ts:176–205`) | e.g. "Verifies or replaces credentials for this same Slack app. It doesn't reinstall the app or change channels." | Move | Tip beside Reconnect: the provider's `reconnect` text | |
| `apps/chat/ChatEndpointPage.tsx:1182` | `.cx-note` (AgentMail unconfirmed) | "Settle unconfirmed email deliveries on the conversation's task." | Keep | — (shown only when such deliveries exist; why Resolve is missing) | |
| `apps/chat/ChatEndpointPage.tsx:1190` | `Dialog description=` (`resolutionText`, `chat-model.ts:347`) | "Paperclip lost track after sending. Check the conversation first: retrying can send it twice." etc. | Keep | — (must-see warning before acting) | |
| `apps/chat/ChatEndpointPage.tsx:1215` | ConfirmDialog body (+ `LIFECYCLE_GUIDANCE[p].remove`) | "{agent} stops receiving new work from {provider}. Existing tasks stay. …" | Keep | — (destructive warning) | |
| `apps/chat/TaskDefaults.tsx:378` | `.cx-static` under the selects | "Access to the project and workspace is checked for each task. A shared folder must also be allowed by the agent's settings." | Rewrite | Tip (Task defaults card `info`): "Paperclip checks access to the project and workspace each time it makes a task. A low-trust agent gets its own isolated checkout even when a shared folder is picked." | Checked per task: `server/src/services/chat-channels.ts:2187` → `chat-execution-defaults.ts:35`. A shared pick isn't refused for a low-trust agent, it's switched to isolated: `server/src/services/execution-workspaces.ts:1633` (`low_trust_review` → `isolated_workspace`); only a `denied` trust preset refuses (:1631) |
| `apps/chat/GitHubBot.tsx:229` | Card description ("The GitHub App") | "People mention the bot by the App's name. Rename it or change its logo on GitHub, then reconnect so Paperclip picks up the new name." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:277` | Card description ("Repositories") | "Where the bot takes messages and uses its tools. Changes save at once." | Split | Tip: "Where the bot takes messages and uses its tools." / Visible: "Changes save at once." | |
| `apps/chat/GitHubBot.tsx:297` | `.cx-static` count line | "{n} of {m} repositories on. Turning all on or off applies to every repository, not only those shown." | Split | Tip (beside Turn all on/off): "Applies to every repository, not only those shown." / Visible: "{n} of {m} repositories on." | |
| `apps/chat/GitHubBot.tsx:316` | empty state | "No repositories yet. Give the App access to some on GitHub, then refresh." | Keep | — (empty state with next step) | |
| `apps/chat/GitHubBot.tsx:328` | Toggle `description=` (`repositoryNote`, `github-model.ts:206`) | "Unavailable on GitHub. Update the App's installation access, then refresh." | Keep | — (disabled reason) | |
| `apps/chat/GitHubBot.tsx:394` | Card description ("Instructions") | "Included in every GitHub task." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:416` | `.cx-static` in "Instructions for one event" | "Added to the main instructions for this event." | Move | Tip on the disclosure summary: same text | |
| `apps/chat/GitHubBot.tsx:423` | `.cx-static` ("When it runs") | "People allowed in Access can always @mention the bot." | Keep | — (holds link) | |
| `apps/chat/GitHubBot.tsx:429` | Toggle `description=` ("Run automatically") | "Start work without a mention when an allowed person opens an issue or updates a pull request." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:454` | Toggle `description=` ("Include bot authors") | "The bot account also needs a sponsor and automatic runs for outside contributors in Access." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:457` | `ListField help=` ("Included authors") | "Empty means every allowed author. One username or glob per line." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:458` | `ListField help=` ("Excluded authors") | "One username or glob per line." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:459` | `ListField help=` ("Target branches") | "Empty means every branch. Supports * and **." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:460` | `ListField help=` ("Excluded branches") | "Supports * and **." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:461` | `ListField help=` ("Required labels") | "Every listed label must be there." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:462` | `ListField help=` ("Excluded labels") | "Any listed label stops an automatic review." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:464` | `.cx-static` in "Automatic review filters" | "Reviews asked for by @mention skip these filters. Repository access and ignored files still apply." | Move | Tip on the disclosure summary: same text | |
| `apps/chat/GitHubBot.tsx:474` | `Field help=` ("Passing score") | "A review scoring below this fails its check (1 to 5)." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:494` | `ListField help=` ("Ignored file patterns") | "Left out of every review, @mentions included. One pattern per line; supports * and **." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:496` | `Field help=` ("Finding categories") | "Separated by commas." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:511` | `Field help=` ("Lowest severity posted inline") | "Hidden findings still count in the assessment." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:523` | Toggle `description=` ("Allow approvals") | "The agent may submit an Approve review after a complete assessment. A 5/5 score alone doesn't approve." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:529` | Toggle `description=` ("Allow change requests") | "The agent may submit a Request changes review, which can block merging under your repository rules." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:613` | Card description ("Company members") | "Who may mention the bot, and whose activity starts work automatically." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:618` | Toggle `description=` (state-dependent) | "Includes members who link their GitHub account later." / "Only the members turned on below." | Move | Tip (static): "On: every linked member, including members who link later. Off: only the members turned on below." | |
| `apps/chat/GitHubBot.tsx:630` | `.cx-static` beside "Link a member" | "Automatic runs follow the events and filters in Settings." / "Automatic runs are off in Settings; mentions still work." | Keep | — (current state) | |
| `apps/chat/GitHubBot.tsx:635` | Card description ("Outside contributors") | "Specific GitHub users a member sponsors. They get restricted access, without company membership or the sponsor's credentials." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:647` | Toggle `description=` (state-dependent) | "They can start the events and filters set in Settings." / "Turn on automatic runs in Settings first." | Split | Tip: "They can start the events and filters set in Settings." / Visible (only when off): "Turn on automatic runs in Settings first." | |
| `apps/chat/GitHubBot.tsx:657` | Card description ("Responsible member") | "Accountable for tasks the bot creates automatically. GitHub authors are recorded separately; this gives no access to the member's credentials." | Move | Tip: same text | |
| `apps/chat/GitHubBot.tsx:669` | `.cx-static` | "Only company owners and admins can choose someone other than themselves." | Keep | — (why the picker only offers you) | |
| `apps/chat/GitHubBot.tsx:674` | Card description ("GitHub tools are off") | "This saved bot can't start work or answer until its GitHub tools are on." | Keep | — (current state) | |
| `apps/chat/GitHubBot.tsx:714` | dialog body `<p>` ("Link a company member") | "Each member confirms their own GitHub account. Share this link with a member, or open it to link yours." | Keep | — (the dialog's instruction; nothing else in it) | |
| `apps/chat/GitHubBot.tsx:762` | `Dialog description=` ("Add an outside contributor") | "Let a GitHub user mention the bot. A company member sponsors their restricted access." | Move | Tip (beside the title, or on the Sponsor field): same text | |
| `apps/chat/GitHubBot.tsx:803` | `Field help=` ("Sponsor") | "You sponsor them. Only company owners and admins can choose someone else." | Keep | — (disabled reason) | |
| `apps/chat/SlackSetup.tsx:403` | `Dialog description=` ("Connect your Slack account") | "Choose your account. Messages to this agent will use your Paperclip permissions." | Split | Tip: "Messages to this agent will use your Paperclip permissions." / Visible: "Choose your account." | |
| `apps/chat/SlackSetup.tsx:482` | Card description ("Slack tools") | "Read, search and act in Slack. Some actions ask first." | Move | Tip: same text | |
| `apps/chat/SlackSetup.tsx:510` | `.cx-static` under `h4.ch-subhead` "Your Slack search access" | "Optional. Your own authorization lets agents search private conversations you can see, on runtimes that support it. It can't read channels the bot hasn't joined or write as you." | Move | Tip beside the subhead: same text | |
| `apps/chat/SlackSetup.tsx:545` | `.cx-static` | "A connection manager needs to add the Slack app's OAuth client first." | Keep | — (why Connect is disabled) | |
| `apps/chat/SlackSetup.tsx:558` | OAuth client instructions `<p>` | "In Slack app settings, add this redirect address under OAuth & Permissions, and the user scopes …" | Keep | — (setup steps to act on now) | |

### Company settings

Files: settings/company/*.tsx, settings/OwnerMenu.tsx, settings/SettingsBody.tsx. Secrets files: only what is left after the earlier conversion.

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `settings/company/CompanySettingsPage.tsx:72` | SectionTitle intro (instance address) | "This address belongs to app settings, which apply to every organization on this Paperclip instance." | Split | Tip: "App settings apply to every organization on this Paperclip instance." / Visible: "This address belongs to app settings." | |
| `settings/company/GeneralSection.tsx:54` | SectionTitle intro | "Who the organization is, and its rules for hiring and for answering agents. Changes save as you make them." | Move | Tip: same text | |
| `settings/company/GeneralSection.tsx:62` | Feedback SwitchRow help | "When someone rates an agent's output, send that output and the rating to Paperclip to improve it. Off by default." | Move | Tip: same text | default false: packages/db/src/schema/companies.ts:36-38 |
| `settings/company/GeneralSection.tsx:113` | Name row help | "Shown in the sidebar, on invites and in agents' instructions." | Move | Tip: "Shown in the sidebar and on invites." (see judgement calls) | suspect: found no server code that writes the company name into run instructions (grep in server/src/services/heartbeat, default-agent-instructions.ts) |
| `settings/company/GeneralSection.tsx:129` | Description row help | "Optional. Shown on the organization's profile." | Rewrite | Tip: "Shown on the organization's dashboard." | There is no organization profile page; ui-new/src/org/OrgDashboard.tsx:153 shows it as `org-about` |
| `settings/company/GeneralSection.tsx:139` | Logo row help | "Square, at least 128 px. PNG, JPEG, WEBP, GIF or SVG." | Move | Tip: same text | |
| `settings/company/GeneralSection.tsx:166` | Default owner row help | "The person who gets tasks and requests that have no owner." | Rewrite | Tip: "The person the organization's runs act for when no one else is responsible for the work, such as a routine without its own owner. Their personal secrets are used. With nobody, an owner is used. Requests with no owner go to the decision owner below." | packages/shared/src/types/company.ts:29-36 (`defaultResponsibleUserId` "is attribution and is never used to route cards"); server/src/services/heartbeat/run-preparation.ts:3120-3135 and services/routines.ts:120-128 (responsible-user fallback, then an owner) |
| `settings/company/GeneralSection.tsx:224` | Hiring SwitchRow help | "When a person or an agent hires an agent, the new agent waits in the Inbox until an owner or admin approves it." | Rewrite | Tip: "When a person or an agent hires an agent, the new agent waits in the Inbox until a member approves it. Viewers can't approve." | server/src/routes/approvals.ts:461-467 (approve checks only for a board actor with company access); routes/authz.ts:245-253 (any active non-viewer member may write). Suspect: no extra role check found in the approve path |
| `settings/company/GeneralSection.tsx:251` | Agent requests CardHead note | "Agents ask for answers, confirmations and reviews. Choose who may respond to each kind. A task can tighten this, but not loosen it." | Move | Tip: same text, plus the footer line below | |
| `settings/company/GeneralSection.tsx:286` | Menu.Item description (who can answer: AUDIENCES, general-model.ts:45-47) | "People or any agent, including the one that asked." … | Keep | — (menu option, shown only while choosing) | |
| `settings/company/GeneralSection.tsx:315` | Agent requests card footer | "Tool approvals always wait for a person." | Move | Tip: add to the Agent requests tip | |
| `settings/company/GeneralSection.tsx:345` | Danger zone: pause row text | "No new runs start anywhere in the organization. Runs in progress are stopped." | Keep | — (destructive warning) | server/src/services/companies.ts:402-404 stops active runs on pause |
| `settings/company/GeneralSection.tsx:366` | Danger zone: archive row text | "Stops every agent and hides the organization from its members. Its data is kept, and it can be restored from the organization list." | Rewrite | Visible: "Stops every agent and hides the organization from its members. Its data is kept, and an instance admin can bring it back from App settings → Organizations." | Restoring is "Bring back" in settings/app/OrganizationsSection.tsx:150, an instance-admin page; the organization switcher doesn't offer it |
| `settings/company/MembersSection.tsx:93` | SectionTitle intro (holds link) | "The people in {company}, their roles, and how new people get in. Agents are members too; manage them in Agents." | Split | Tip: "The people in {company}, their roles, and how new people get in." / Visible: "Agents are managed in Agents." (holds link) | |
| `settings/company/MembersSection.tsx:161` | Role Menu.Item descriptions (ROLE_OPTIONS, members-model.ts:9-12; also :329 in the invite menu) | Owner "Everything, including billing and removing the organization"; Admin "Settings, members and every agent"; Operator "Tasks, projects and agents" | Rewrite | Keep in the menu: Owner "Everything, including members' roles"; Admin "Everything but members' roles"; Operator "Tasks, projects and agents, and inviting people"; Viewer unchanged | server/src/services/company-member-roles.ts:27-80 (only owner gets `users:manage_permissions`; admin gets `joins:approve`; operator gets `users:invite` but not `joins:approve`); routes/access.ts:1200-1205 (canManageMembers = `users:manage_permissions`); there is no billing permission (PERMISSION_KEYS, packages/shared/src/constants.ts:1034); old UI agrees (ui/src/components/access/InvitesSection.tsx:18-38). Coordinator check: operators also get `agents:create` and `agents:configure`, and some tool and audit grants admins don't list (same file); admin may get more through role checks elsewhere, so confirm before writing finer detail. |
| `settings/company/MembersSection.tsx:198` | Suspend Menu.Item description | "They keep their role but can't sign in here" | Rewrite | Menu: "They keep their role but lose access to this organization until reactivated" | A suspended membership isn't active, so this organization's access checks fail (server/src/services/authorization.ts:1062, routes/authz.ts:247-250). They can still sign in to Paperclip and other organizations. Suspect: read paths not traced one by one |
| `settings/company/MembersSection.tsx:255` | People card footer | "Owners and admins manage settings and members. Operators work with tasks, projects and agents. Viewers can look but not change anything." | Rewrite | Tip (on People): "Owners manage everything, including members' roles. Admins manage everything else and approve join requests. Operators work with tasks, projects and agents, and can invite people. Viewers can look but not change anything." | Same as the role row: company-member-roles.ts:27-80 |
| `settings/company/MembersSection.tsx:319` | Invites CardHead note | "Anyone with the link can join with the role you choose." | Keep | — (security note: a person with the link joins without approval) | server/src/routes/access.ts:4071 auto-approves human invite joins |
| `settings/company/MembersSection.tsx:348` | New invite hint | "Copy it now: the link isn't shown again once you leave this page." | Keep | — (must-see warning) | |
| `settings/company/MembersSection.tsx:413` | Join requests CardHead note | "People who asked to join. Requests also arrive in your Inbox." | Move | Tip: same text | |
| `settings/company/MembersSection.tsx:507` | Remove dialog body | "They lose access to {company}. Their open tasks go to:" | Keep | — (destructive) | |
| `settings/company/ConnectionsSection.tsx:47` | SectionTitle intro | "The models Paperclip itself uses on top of your agents, and where run telemetry goes. Calls are charged to the connection you pick." | Move | Tip: same text | |
| `settings/company/ConnectionsSection.tsx:53` | After-cards line (holds link) | "Agents' own model connections live in Connections." | Keep | — (holds link) | |
| `settings/company/ConnectionsSection.tsx:142` | Decision model CardHead note | "The shared connection Paperclip uses for its optional decision features." | Move | Tip: same text | |
| `settings/company/ConnectionsSection.tsx:161` | Connection row hint, no choices | "Add a shared OpenAI or OpenRouter API connection to get started." | Keep | — (empty state) | |
| `settings/company/ConnectionsSection.tsx:165` | Use decisions SwitchRow help | "Paperclip's optional decision features run on this connection." | Move | Tip: same text | |
| `settings/company/ConnectionsSection.tsx:168` | Allow background decisions SwitchRow help | "Background features can charge this connection without a responsible person. They show as Paperclip services in Costs." | Move | Tip: same text | |
| `settings/company/ConnectionsSection.tsx:271` | Fast responses, instance off | "Fast responses are turned off for this instance. An instance admin can turn them on in app settings." | Keep | — (why the control is missing) | |
| `settings/company/ConnectionsSection.tsx:292` | Acknowledge SwitchRow help | "When someone messages an agent, a small model replies at once, marked as automatic. The agent's full reply follows." | Move | Tip: same text | |
| `settings/company/ConnectionsSection.tsx:307` | Answer people without an account SwitchRow help | "Covers accepted outside messages from people with no linked Paperclip account, charged to the organization." | Move | Tip: same text | |
| `settings/company/ConnectionsSection.tsx:418` | Prompt injection SwitchRow help | "Looks for instructions planted in web pages, files and app responses, and holds suspicious results back. The provider receives tool content." | Split | Tip: "Looks for instructions planted in web pages, files and app responses, and holds suspicious results back." / Visible: "The provider receives tool content." (privacy note) | |
| `settings/company/ConnectionsSection.tsx:422` | Connection row help | "A shared OpenRouter connection." | Move | Tip: same text | |
| `settings/company/ConnectionsSection.tsx:438` | "If the model is down" row hint | "Built-in pattern matching always runs when the model check can't." | Move | Tip on the row (`info`) | |
| `settings/company/ConnectionPicker.tsx:147` | Add connection Dialog description | "An API key the whole organization can use {purpose}. Calls are charged to it." | Move | Tip on the API key Field (`info`): same text | |
| `settings/company/ConnectionPicker.tsx:174` | Name Field help | "Optional." | Keep | — (marks an optional field; too short for a tip) | |
| `settings/company/TelemetryCard.tsx:124` | Run telemetry CardHead note | "Send OpenTelemetry logs and traces from managed Claude Code and Codex runs to your own collector." | Move | Tip: same text | |
| `settings/company/TelemetryCard.tsx:171` | Project ID row help | "The Braintrust project's UUID." | Move | Tip: same text | |
| `settings/company/TelemetryCard.tsx:174` | API key row help | "Use a key limited to telemetry ingestion: the agent's harness receives it." | Keep | — (security note that changes which key to use) | |
| `settings/company/TelemetryCard.tsx:192` | Endpoint row help | "OTLP over HTTP. The base URL, without /v1/logs or /v1/traces; every environment agents run in must reach it." | Move | Tip: same text | |
| `settings/company/TelemetryCard.tsx:202` | Headers row help | "For your collector's authentication. Values are never shown again; the agent's harness receives them." | Split | Tip: "For your collector's authentication." / Visible: "Values aren't shown again, and the agent's harness receives them." | |
| `settings/company/TelemetryCard.tsx:243` | Send telemetry SwitchRow help | "Applies to runs that start after you save." | Move | Tip: same text | |
| `settings/company/TelemetryCard.tsx:244` | What to include row help | "Exported records can contain task content." | Keep | — (privacy warning) | |
| `settings/company/TailscaleMachine.tsx:195` | Pairing command note | "Run this on {machine} as the user agents will run as." | Keep | — (instruction for the command shown) | |
| `settings/company/BudgetsSection.tsx:63` | SectionTitle intro (holds link) | "Monthly limits for the organization, its agents and its projects, all in one place. Spending charts stay in Activity → Costs." | Split | Tip: "Monthly limits for the organization, its agents and its projects." / Visible: "Spending charts are in Activity → Costs." (holds link) | |
| `settings/company/BudgetsSection.tsx:125` | Monthly budget row help | "Leave it empty for no limit." | Move | Tip: same text | |
| `settings/company/BudgetsSection.tsx:188` | LimitMenu item description (Pause) | "New runs wait until the limit is raised" | Rewrite | Menu: "Pauses it and stops its running work until the limit is raised" | server/src/services/budgets.ts:407-418 (`pauseAndCancelScopeForBudget` pauses the scope and requests cancellation of running work), :708 |
| `settings/company/BudgetsSection.tsx:191` | LimitMenu item description (Only warn) | "Runs carry on past the limit" | Keep | — (menu option) | |
| `settings/company/BudgetsSection.tsx:336` | Agents and projects CardHead note | "A run stops when its agent or its project reaches its budget, whichever comes first. Clear an amount to remove that budget." | Rewrite | Tip: "With Pause, an agent or project that reaches its budget is paused and its running work stops, whichever limit comes first. With Only warn, work carries on. Clear an amount to remove that budget." | budgets.ts:255-262 (only policies with `hardStopEnabled` stop work) |
| `settings/company/EnvironmentsSection.tsx:116` | SectionTitle intro | "Where this organization's agents run." | Move | Tip: same text | |
| `settings/company/EnvironmentsSection.tsx:128` | CardNoteLine under the card head | "The default is instance-wide: agents in every organization on this instance that haven't picked an environment run there." | Move | Tip on the Environments card | |
| `settings/company/EnvironmentsSection.tsx:187` | Edit Menu.Item description | "Its variables" / "Settings and variables" | Keep | — (state: what can be edited) | |
| `settings/company/EnvironmentsSection.tsx:192` | Make the default Menu.Item description | "For every organization on this instance" | Keep | — (must-see scope before acting) | |
| `settings/company/EnvironmentsSection.tsx:203` | Archive Menu.Item description | "Agents can't pick it until it's restored" | Keep | — (menu consequence) | |
| `settings/company/EnvironmentDialog.tsx:206` | Dialog description | "A machine agents run on. Saved changes apply to later runs." | Move | Tip (Dialog needs `info`, or on the Name field) | |
| `settings/company/EnvironmentDialog.tsx:208` | Dialog description, managed environment | "Managed by Paperclip: its name and settings are kept for you; you can add variables." / "Its settings belong to its plugin; you can add variables." | Keep | — (why the fields are missing) | |
| `settings/company/EnvironmentDialog.tsx:245` | Description Field help | "Optional: what this machine is for." | Move | Tip: "What this machine is for." | |
| `settings/company/EnvironmentDialog.tsx:253` | Runs on hint | "Sandboxes need a sandbox provider plugin that can run agents." | Keep | — (why an option is missing) | |
| `settings/company/EnvironmentDialog.tsx:299` | Host Field help | "Set by the machine you pick." / "DNS name or IP address." | Split | Tip: "DNS name or IP address." / Visible (on Tailscale): "Set by the machine you pick." (read-only reason) | |
| `settings/company/EnvironmentDialog.tsx:313` | Port Field help | "Usually 22." | Move | Tip: same text | |
| `settings/company/EnvironmentDialog.tsx:322` | Remote workspace path Field help | "An absolute path on the host; Test checks it." | Move | Tip: same text | |
| `settings/company/EnvironmentDialog.tsx:344` | Private key Menu.Item description | "Paste a key below, or use the server's SSH agent" | Keep | — (menu option) | |
| `settings/company/EnvironmentDialog.tsx:372` | Private key hint (raw `fhelp`) | "Optional. A pasted key is stored as a secret when you save. Without one, the server's SSH agent or default keys are used." | Move | Tip on the "Private key" label | accurate: packages/adapter-utils/src/ssh.ts:424-427 adds `-i` only when a key is set |
| `settings/company/EnvironmentDialog.tsx:374` | Known hosts Field help | "Optional known_hosts lines, used with strict host key checking." | Move | Tip: same text | |
| `settings/company/EnvironmentDialog.tsx:379` | Strict host key checking Switch description | "Keep this on unless you mean to accept the host's key without checking it." | Move | Tip: same text (Switch has no `info`) | |
| `settings/company/EnvironmentDialog.tsx:393` | Remote authentication Switch description | "Runs use the remote user's own provider sign-in." / "Agents here run on the AI account picked for each agent." | Keep | — (describes the current setting; the InfoTip beside it explains) | |
| `settings/company/EnvironmentDialog.tsx:436` | Stream run logs Switch description | "Show the agent's output live while a run works (recommended). Off: the output arrives when the run finishes." | Move | Tip: same text | |
| `settings/company/EnvironmentDialog.tsx:445` | Environment variables hint (raw `fhelp`) | "Given to every run in this environment. Secret values are never shown here." | Move | Tip on the "Environment variables" label | |
| `settings/company/EnvVarsEditor.tsx:67` | Value type Menu.Item descriptions | "Shown here and in run logs" / "One of the company's secrets" / "Each person sets their own value" | Keep | — (menu options) | |
| `settings/company/EnvVarsEditor.tsx:120` | Required Menu.CheckboxItem description | "Runs wait until the person has set it" | Rewrite | Menu: "Without it, runs fail at setup until the person sets it" | A missing required personal secret throws `user_secret_missing` (`server/src/services/secrets.ts:4371-4375`); it is a failure only a person can resolve, with no automatic retry (`server/src/services/continuation-cause.ts:13-18`). Confirmed by the coordinator. |
| `settings/company/TransferSection.tsx:36` | SectionTitle intro | "Move an organization between Paperclip instances as a company package." | Move | Tip: same text | |
| `settings/company/TransferSection.tsx:93` | Export CardHead note | "Agents, projects, their instructions and settings, as markdown and YAML files in a zip. Secret values are never included." | Move | Tip: same text | |
| `settings/company/TransferSection.tsx:94` | Include tasks SwitchRow help | "Open and closed tasks with their descriptions." | Rewrite | Tip: "Open and closed tasks with their descriptions, and the organization's routines." | server/src/services/company-portability.ts:3991 (routines are listed only when `include.issues`) |
| `settings/company/TransferSection.tsx:95` | Include skills SwitchRow help | "The organization's skill library." | Move | Tip: same text | |
| `settings/company/TransferSection.tsx:115` | Not included row help | "A package never carries these." | Move | Tip: same text | |
| `settings/company/ImportCard.tsx:298` | Import CardHead note | "Bring in a company package as a new organization or into this one. Preview it first: nothing changes until you import." | Move | Tip: same text | |
| `settings/company/ImportCard.tsx:302` | Running import row help | "Started before this page was reloaded. It runs on the server; this page follows it." | Split | Tip: "It runs on the server; this page follows it." / Visible: "Started before this page was reloaded." | |
| `settings/company/ImportCard.tsx:328` | Package row help | "A .zip exported from Paperclip, or any agentcompanies/v1 package. Large ones upload in resumable parts." | Move | Tip: same text | |
| `settings/company/ImportCard.tsx:353` | GitHub address row help | "A repository, a folder in it (…/tree/main/company) or its COMPANY.md (…/blob/main/COMPANY.md). Private repositories need a GitHub connection in Connections." | Move | Tip: same text | |
| `settings/company/ImportCard.tsx:391` | New organization's name row help | "Optional. The package's own name is used otherwise." | Move | Tip: same text | |
| `settings/company/ImportCard.tsx:404` | Same names row help (selected option, transfer-model.ts:69-71) | "Imported ones get a new name." / "Keep what's here; leave the package's out." / "Overwrite what's here with the package's." | Keep | — (describes the current choice; Replace is destructive) | |
| `settings/company/ImportCard.tsx:431` | Update details SwitchRow help | "Take the package's name, description and settings for this organization. Off: only its agents, projects, tasks and skills come in." | Move | Tip: same text | |
| `settings/company/ImportCard.tsx:526` | Files row help | "Leave out files you don't want: an agent, a project, a skill or tasks." | Move | Tip: same text | |
| `settings/company/ImportCard.tsx:610` | Harnesses row help | "What each agent runs in. Moving one keeps its instructions, variables and timeouts; its harness settings start fresh." | Move | Tip: same text | |
| `settings/company/ImportCard.tsx:677` | Values it needs row help | "Secret values are stored as new secrets in {org}; plain ones are written into the agent or project. Optional ones can be filled in later." | Move | Tip: same text | |
| `settings/company/PluginSection.tsx:22` | Plugin page SectionTitle intro | "A settings page the {plugin} plugin adds ({version})." | Move | Tip: same text | |
| `settings/company/PluginSection.tsx:37` | From plugins SectionTitle intro | "Settings pages that installed plugins add to the organization. Each one gets an entry in this list." | Move | Tip: "Settings pages that installed plugins add to the organization." | |
| `settings/company/PluginSection.tsx:39` | Plugin settings pages CardHead note | "Each plugin draws its own page." | Remove | — (says nothing the reader can act on) | |
| `settings/company/PluginSection.tsx:57` | Card footer (holds link) | "Plugins are installed and configured in app settings, under Plugins." | Keep | — (holds link) | |
| `settings/company/SecretsSection.tsx:447` | Empty state | "No secrets yet. Add an API key or token once, then choose which agents can use it." | Split | Visible: "No secrets yet." / Tip: already in "How secrets work", so drop the rest | |
| `settings/company/SecretVaults.tsx:244` | Import Menu.Item description | "Bring in its existing secrets as references" | Keep | — (menu option) | |
| `settings/company/SecretVaults.tsx:250` | Make default Menu.Item description | "New secrets are stored here" | Keep | — (menu option) | |
| `settings/company/SecretVaults.tsx:261` | Turn off Menu.Item description | "Secrets stored there stop resolving" | Keep | — (menu consequence) | |
| `settings/company/SecretVaults.tsx:469` | Use by default Switch description | "Existing secrets stay where they are." | Move | Tip: same text (Switch has no `info`) | |
| `settings/company/SecretVaults.tsx:478` | Backup acknowledgement Switch description | "Restoring these secrets needs both the database and Paperclip's encryption key file." | Keep | — (the fact being acknowledged) | |
| `settings/company/SecretVaults.tsx:643` | Import secrets Dialog description | "Existing secrets come in as references: Paperclip reads their values from the provider when a run needs them." | Move | Tip (Dialog needs `info`) | |
| `settings/company/SecretDetails.tsx:206` | Reference row sub-line (`sec-sub`) | "A new value is written to the vault." / "Change the value in the vault; Paperclip reads it at run time." | Move | Tip on the Reference row | |
| `settings/company/SecretDetails.tsx:582` | Replace value Dialog description (`describe()`) | "Agents get the new value from their next run. The old one is kept as an earlier version." / "Written to {ref} in {provider}. Everything that reads that secret gets it, inside and outside Paperclip." / "Points Paperclip at a different secret in your vault. Nothing is written to the vault." | Split | Tip: the first and third (Paperclip-stored value, reference) / Visible: "Written to {ref} in {provider}. Everything that reads that secret gets it, inside and outside Paperclip." (must-see before writing to an outside vault) | |
| `settings/company/SecretParts.tsx:51` | Turn off Menu.Item description | "Agents don't get it until it's on again" | Keep | — (menu consequence) | |
| `settings/company/SecretParts.tsx:57` | Archive Menu.Item description | "Hidden from the list until you ask for archived secrets" | Keep | — (menu consequence) | |
| `settings/company/SecretParts.tsx:88` | Rename Menu.Item description | "A slash in the name files it in a folder" | Keep | — (menu option) | |

### App/instance settings

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `settings/app/AppSettingsPage.tsx:61` | PageHeader `numbers` intro | "Your account and this Paperclip instance. Organization settings live under each organization." | Move | Tip by the title: same text | |
| `settings/app/AppSettingsPage.tsx:78` | Empty state | "There are no settings here for you. An instance admin manages this instance." | Keep | — (empty state) | |
| `settings/app/AccountSection.tsx:74` | SectionTitle intro | "You, on this Paperclip instance." | Move | Tip: same text | |
| `settings/app/AccountSection.tsx:76` | Profile card description | "How you appear in the sidebar, in comments and to agents." (+ save status) | Split | Tip: same text / Visible: save status only | |
| `settings/app/AccountSection.tsx:77` | Photo row help | "Stored in {company}'s file storage." | Move | Tip: same text | |
| `settings/app/AccountSection.tsx:105` | Display name row help | "Changes save when you leave the field." | Move | Tip: same text | |
| `settings/app/AccountSection.tsx:133` | Email row help | "Set by how you sign in." | Keep | — (why it can't be edited) | |
| `settings/app/AccountSection.tsx:140` | Your organizations card description | "The organizations you belong to." | Remove | — (repeats the title) | |
| `settings/app/AccountSection.tsx:178` | Sign-in, local trusted | "This instance runs in local trusted mode: the browser acts as the local board, with no sign-in." | Keep | — (state; why sign-out is missing) | |
| `settings/app/AccountSection.tsx:182` | Sign out row help | "Ends this browser's session. You'll go to the sign-in page." | Move | Tip: same text | |
| `settings/app/AccountSection.tsx:189` | LaterNote | "Not here yet: Changing your password, seeing your active sessions, and leaving an organization." | Keep | — (why controls are missing; see judgement calls) | |
| `settings/app/InboxTidyCard.tsx:72` | Card description | "In {company}: whether agents you manage may archive tasks out of your inbox. You can undo any archive, and the task says which agent did it." | Split | Tip: "Whether agents you manage may archive tasks out of your inbox. You can undo any archive, and the task says which agent did it." / Visible: "For {company} only." + save status | |
| `settings/app/InboxTidyCard.tsx:89` | Who may archive row help (selected option, app-settings-model.ts:452-454) | "Any agent you manage may archive tasks out of your inbox." / "Only the agents you pick below may." / "Agents never archive tasks from your inbox." | Remove | — (each one repeats the selected label) | |
| `settings/app/GeneralSection.tsx:57` | SectionTitle intro | "How this instance is deployed, its privacy defaults, its backups and its features. They apply to every organization on this server." | Move | Tip: same text | |
| `settings/app/GeneralSection.tsx:60` | Deployment and sign-in card description | "Set in the server's configuration when it starts. Shown here so you can check it." | Keep | Visible: "Set in the server's configuration." (why it's read-only; shorter) | |
| `settings/app/GeneralSection.tsx:103` | Privacy card description | "Changes save as you make them." (+ save status) | Move | Tip: same text / save status stays visible | |
| `settings/app/GeneralSection.tsx:107` | Hide usernames SwitchRow help | "Replaces your computer's username in home-folder paths in run logs and transcripts. Other mentions of it aren't hidden yet." | Move | Tip: same text | |
| `settings/app/GeneralSection.tsx:116` | AI feedback sharing row help | "Whether a thumbs up or down on an agent's output also sends that output to Paperclip Labs. Votes are always kept here." | Move | Tip: same text | |
| `settings/app/GeneralSection.tsx:121` | Segmented option label (FEEDBACK_OPTIONS, app-settings-model.ts:394) | "Ask each time" | Rewrite | Visible label: "Ask on the next vote" | The hint at :130 and the old UI (ui/src/pages/InstanceGeneralSettings.tsx:304-307: "No default is saved yet. The next thumbs up or thumbs down choice will ask once and then save the answer here.") show it asks once, not each time |
| `settings/app/GeneralSection.tsx:130` | Hint under feedback options | "The next vote asks once, then saves the answer here." | Keep | — (current state: no default saved yet) | |
| `settings/app/GeneralSection.tsx:143` | Backups card description | "How long Paperclip keeps its automatic database backups." (+ backup status) | Split | Tip: same text / Visible: the backup status and save status | |
| `settings/app/GeneralSection.tsx:150` | Retention row helps (RETENTION, app-settings-model.ts:371-373) | "Every backup in this window is kept." / "Then one a week." / "Then one a month." | Move | Tip on each row | |
| `settings/app/FeaturesCard.tsx:64` | Features card description | "Features the server turns on or off for every organization. They're still experimental and may change. Only instance admins can change them." | Split | Tip: "Features the server turns on or off for every organization. They're still experimental and may change." / Visible (non-admins): "Only instance admins can change them." + save status | |
| `settings/app/FeaturesCard.tsx:104` | Each feature row's help (`flag.help`, features-model.ts:46-192, about 30 flags) | "Durable work products that tasks create and iterate on…" etc. | Move | Tip per feature row; the Needs line and disabled notes (:105-121) stay visible | |
| `settings/app/AdminsSection.tsx:62` | SectionTitle intro | "Who can change this instance's settings, and which organizations each person belongs to." | Move | Tip: same text | |
| `settings/app/AdminsSection.tsx:65` | People card description | "Instance admins can change these settings and open every organization's settings." | Move | Tip: same text | |
| `settings/app/AdminsSection.tsx:183` | Organizations Dialog description | "Turn on the organizations this person belongs to. Roles are changed in each organization's Members settings." | Move | Tip (Dialog needs `info`) | |
| `settings/app/OrganizationsSection.tsx:112` | SectionTitle intro | "Every organization on this instance. Each one's own settings are under that organization." | Move | Tip: same text | |
| `settings/app/OrganizationsSection.tsx:178` | New organization Dialog description | "It starts empty: hire its first agent from its Agents page." | Move | Tip on the Name field (`info`) | |
| `settings/app/OrganizationsSection.tsx:180` | Delete Dialog description | "This deletes its agents, tasks, projects and history for good. It can't be undone." | Keep | — (destructive) | |
| `settings/app/HarnessesSection.tsx:125` | SectionTitle intro | "The programs agents run in, such as Claude Code and Codex. Turning one off hides it when hiring; agents already using it are not changed." | Move | Tip: same text | |
| `settings/app/HarnessesSection.tsx:147` | Other built-in harnesses card description | "Not used by any agent yet. Only those turned on appear when hiring." | Move | Tip: same text | |
| `settings/app/HarnessesSection.tsx:166` | Installed from npm card description | "Harness packages added to this instance, from npm or a folder on the server." | Move | Tip: same text (the title says npm only; see judgement calls) | |
| `settings/app/HarnessesSection.tsx:197` | Empty state with how-to | "No harness packages installed. Add one by its npm name, like @acme/paperclip-adapter@1.2.0." | Keep | — (empty state) | |
| `settings/app/HarnessesSection.tsx:209` | Remove Dialog description | "{n} agents use it, and can't run until you move them to another harness." / "Agents can't be hired with it anymore. You can install it again later." | Keep | — (destructive) | |
| `settings/app/HarnessesSection.tsx:236` | Update Dialog description | "Paperclip pulls the latest version from npm and swaps it in. Agents use it from their next run." | Keep | — (what confirming does) | |
| `settings/app/HarnessesSection.tsx:292` | Reload Menu.Item description | "Load the package again from disk" | Keep | — (menu option) | |
| `settings/app/PluginsSection.tsx:103` | SectionTitle intro | "Extensions that add pages, settings, tools and environments to this instance." | Move | Tip: same text | |
| `settings/app/PluginsSection.tsx:107` | Installed card description | "Turning a plugin off stops it and hides what it adds; its settings are kept." | Move | Tip: same text | |
| `settings/app/PluginsSection.tsx:205` | Update Menu.Item description | "Install the latest version from npm" | Keep | — (menu option) | |
| `settings/app/PluginsSection.tsx:228` | Bundled card description | "Plugins that ship with this checkout. They install from their folder on the server." | Move | Tip: same text | |
| `settings/app/PluginsSection.tsx:269` | Remove Dialog description | "It stops, and the pages, tools and environments it adds go away. Its stored data is kept, so installing it again brings it back." | Keep | — (destructive) | accurate: no `purge` sent (ui-new/src/api/plugins.ts:131; server/src/routes/plugins.ts:2059) |

### Skills

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `skills/SkillCatalog.tsx:134` | page footer (`org-foot`) | "Recommended skills cover common work; optional ones add a tool or a practice. Installed skills update with Paperclip." | Rewrite | Tip on the catalog: "Recommended skills cover common work; optional ones add a tool or a practice. When Paperclip ships a newer version of an installed skill, its library page offers the update." | Suspect, checked: a catalog install (`sourceType: "catalog"`) only reports `hasUpdate` (`server/src/services/company-skills.ts:4388-4421`) and changes through `installUpdate` (`:4991`), which only `POST …/install-update` calls (`server/src/routes/company-skills.ts:1837`). Only Paperclip's bundled skills are reconciled automatically (`ensureBundledSkills`, `company-skills.ts:3304`). |
| `skills/SkillCatalog.tsx:371` | install `Dialog description=` | "It's already in the library. Installing again brings it back to the catalog's version." / "Copies it into the library." | Split | Visible: the installed variant (consequence) / Remove: "Copies it into the library." (the title says Install) | |
| `skills/SkillCatalog.tsx:384` | Name in the library `help=` | "Leave empty to use {slug}." | Move | Tip: same (the placeholder already shows the slug) | |
| `skills/SkillCatalog.tsx:397` | replace option text | "“{name}” already uses that name. Replacing overwrites its files." / "Overwrites any changes made to it here." | Keep | — (destructive) | |
| `skills/SkillLibrary.tsx:141` | Add skills `Menu.Item description` | "Paperclip's recommended and optional skills" | Keep | — (menu option description: stays visible, see J1) | |
| `skills/SkillLibrary.tsx:144` | Add skills `Menu.Item description` | "A folder, a GitHub address or a skills.sh link" | Keep | — (menu option description: stays visible, see J1) | |
| `skills/SkillLibrary.tsx:147` | Add skills `Menu.Item description` | "Skill folders in a project's workspaces" | Keep | — (menu option description: stays visible, see J1) | |
| `skills/SkillLibrary.tsx:150` | Add skills `Menu.Item description` | "A repository whose skills stay up to date" | Keep | — (menu option description: stays visible, see J1) | |
| `skills/SkillLibrary.tsx:154` | Add skills `Menu.Item description` | "Write one in the Studio" | Keep | — (menu option description: stays visible, see J1) | |
| `skills/SkillLibrary.tsx:186` | page footer (`org-foot`) | "Bundled skills update with Paperclip and imported ones with their source. Turn a skill on for an agent in the agent's Skills settings." | Rewrite | Tip: "Paperclip's bundled skills update with Paperclip, and skills from a source follow it while its automatic updates are on. Other installed and imported skills show an update to install. Turn a skill on for an agent in the agent's Skills settings." | Suspect: same as `SkillCatalog.tsx:134`; a source with automatic updates off is `paused` (`server/src/services/skill-sources.ts:84`). |
| `skills/SkillLibrary.tsx:288` | core skill note (`sk-note`) | "Recommended for lead agents. It's one of Paperclip's core skills: how a lead agent works with tasks, the board, plans and hiring. Paperclip Runner agents don't need it: the Runner provides it." | Split | Visible: "Recommended for lead agents." and the "Lead agents without it" list / Tip: "One of Paperclip's core skills: how a lead agent works with tasks, the board, plans and hiring. Paperclip Runner agents don't need it: the Runner provides it." | |
| `skills/SkillActions.tsx:258` | Fork `Dialog description=` | "An editable copy, authored here. The original keeps updating from its source; the copy doesn't." | Move | Tip: same | |
| `skills/SkillActions.tsx:287` | fork agents list label | "Move these agents onto the copy (they stop using the original):" | Keep | — (label and consequence) | |
| `skills/SkillActions.tsx:512` | settings `Dialog description=` | "How the library shows it, and who sees it." | Remove | — (repeats the title and the fields) | |
| `skills/SkillActions.tsx:536` | Name `help=` | "Saved as {slug}. Agents using it move to the new name." / "Only skills written here can be renamed. Fork it for a copy you can name." | Keep | — (state; disabled reason) | |
| `skills/SkillActions.tsx:543` | Description `help=` | "What it's for. Agents read this to decide when to use it." | Move | Tip: same | |
| `skills/SkillActions.tsx:546` | Tagline `help=` | "A short line for the library. {n}/120" | Split | Tip: "A short line for the library." / Visible: "{n}/120" | |
| `skills/SkillActions.tsx:549` | Categories `help=` | "Separated by commas, such as engineering, review." | Move | Tip: same | |
| `skills/SkillActions.tsx:559` | Icon `help=` | "An image address." | Remove | — (the label and `https://` placeholder say it) | |
| `skills/SkillActions.tsx:562` | Colour `help=` | "Any CSS colour, such as #6f5cf6." | Move | Tip: same | |
| `skills/SkillActions.tsx:571` | Who sees it, project skill | "It came with a project's repository, so only that project's agents see it." | Keep | — (why the control is missing) | |
| `skills/SkillActions.tsx:575` (text in `skills/skill-settings-model.ts:31-32`) | Who sees it `Segmented` option help (`fhelp`) | "Everyone in the organization sees it and can give it to agents." / "Only you see it in the library." | Move | Tip on Who sees it: "Organization: everyone sees it and can give it to agents. Only me: only you see it in the library." | |
| `skills/SkillActions.tsx:625` | Safety check, not checked | "Not checked yet. The check scans its files for scripts, executables and links outside the skill." | Split | Visible: "Not checked yet." / Tip on Safety check: "The check scans the skill's files for scripts, executables and links outside the skill." | |
| `skills/SkillActions.tsx:700` | Reset `Dialog description=` | "It goes back to the files the catalog installed." | Keep | — (what the destructive action does) | |
| `skills/SkillActions.tsx:715` | Reset body | "It was edited here since it was installed; those edits are lost. …" / "Nothing here changed since it was installed, so nothing is lost." | Keep | — (destructive consequence; state) | |
| `skills/SkillStudio.tsx:56` | Studio toolbar (`org-muted`) | "Skills written here. Bundled and imported skills are read-only; their source keeps them up to date." | Rewrite | Tip: "Skills written here. Bundled and imported skills open read-only here; fork one for a copy you can edit." | Suspect: "their source keeps them up to date" is only true of bundled skills and of sources with automatic updates on; a catalog install or one-off import needs an installed update (see `SkillCatalog.tsx:134`). |
| `skills/SkillStudio.tsx:70` | empty state | "No skills written here yet. Start one with New skill." | Keep | — | |
| `skills/SkillStudio.tsx:130` | New skill intro (`<header class="chead"><p>`) | "A skill is a folder of instructions (SKILL.md) and any files they refer to. Once it exists, turn it on for agents in their Skills settings." | Move | Tip on "New skill": same | |
| `skills/SkillStudio.tsx:142` | Slug `help=` | "The skill's folder name, which agents see." | Move | Tip: same | |
| `skills/SkillStudio.tsx:154` | Description `help=` | "When agents should use it. Agents read this to decide." | Move | Tip: same | |
| `skills/SkillStudio.tsx:157` | Categories `help=` | "Optional, separated by commas." | Move | Tip: same | |
| `skills/SkillStudio.tsx:198` | read-only notice | "{name} is bundled with Paperclip / imported, so it's read-only here. {editableReason}" | Keep | — (state) | |
| `skills/SkillStudio.tsx:578` | New file `Dialog description=` | "It's saved with the skill when you first save it." | Move | Tip: same | |
| `skills/SkillStudio.tsx:590` | Path `help=` | "Relative to the skill's folder, like references/style.md." | Move | Tip: same | |
| `skills/SkillStudio.tsx:624` | Save version `Dialog description=` | "Names the skill's files as they are now, so agents can be pinned to it and you can come back to it." | Move | Tip: same | |
| `skills/SkillStudio.tsx:637` | unsaved warning | "The open file has unsaved changes; they aren't part of the version until you save the file." | Keep | — (warning) | |
| `skills/SkillStudio.tsx:639` | Label `help=` | "Optional, like “Adds the style guide”." | Move | Tip: same | |
| `skills/SkillSources.tsx:56` | Sources toolbar (`org-muted`) | "Repositories the library imports skills from. Their skills stay in step with the branch you pick." | Rewrite | Tip: "Repositories the library imports skills from. With automatic updates on, their skills follow the branch you pick; otherwise use Sync now." | A source with `automaticUpdates` off is `paused` (`server/src/services/skill-sources.ts:84`); the row already says "Automatic updates are off" (`SkillSources.tsx:153`). |
| `skills/SkillSources.tsx:73` | empty state | "No sources yet. Add a GitHub repository to import the skills in it." | Keep | — | |
| `skills/SkillSources.tsx:308` | Add source `Dialog description=` | "A GitHub repository with skills in it (folders with a SKILL.md). Paperclip reads it, then imports the skills you pick." | Move | Tip: same | |
| `skills/SkillSources.tsx:334` | Repository `help=` | "github.com/owner/repo, or just owner/repo." | Move | Tip: same | |
| `skills/SkillSources.tsx:344` | Branch `help=` | "Leave empty for the repository's default branch." | Move | Tip: same | |
| `skills/SkillSources.tsx:441` | Remove source `Dialog description=` | "Paperclip stops following this repository." | Keep | — (destructive) | |
| `skills/SkillSources.tsx:458` | keep/delete option text | "Agents keep using them; they no longer update from the repository." / "Agents using them lose them." (:462) | Keep | — (destructive choice) | |
| `skills/SourceExtras.tsx:240` | Update automatically `Switch description=` | "Install new commits on the branch as they land. Off, use Sync now." | Move | Tip: same | |
| `skills/SourceExtras.tsx:241` | Import new skills `Switch description=` | "Skills added to the repository later are imported too, not just offered." | Move | Tip: same | |
| `skills/SourceExtras.tsx:242` | no connection | "No GitHub connection can read it. Connect GitHub in Connections; public repositories work without one." | Keep | — (why the field is missing) | |
| `skills/SourceExtras.tsx:248` | connection `help=` after a failed sync | "Its last sync failed reading the repository. Pick a connection that can read it." | Keep | — (error state) | |
| `skills/SourceExtras.tsx:251` | Branch `help=` | "Default: {branch}. Pinned agent versions stay as they are." / "HEAD follows the repository's default branch." | Split | Visible: "Default: {branch}." / Tip: "Pinned agent versions stay as they are. HEAD follows the repository's default branch." | |
| `skills/SourceExtras.tsx:349` | Choose skills `Dialog description=` | "Picked skills are imported; unpicking one removes it from the library." | Keep | — (destructive consequence) | |
| `skills/SourceExtras.tsx:420` | From your projects header note | "Skills stay limited to the project" | Move | Tip: "Skills imported from a project's repository are seen only by that project's agents." | |
| `skills/SourceExtras.tsx:589` | ConnectionField default `help=` | "Whose access reads the repository. Manage them in Connections." | Move | Tip: same | |
| `skills/SkillFolders.tsx:180` | Folders `Dialog description=` | "Your folders. Bundled skills sit in Paperclip's own folders, which can't be changed." | Move | Tip: "Bundled skills sit in Paperclip's own folders, which can't be changed." | |
| `skills/SkillFolders.tsx:216` | remove folder confirm `body=` | "Its skills stay in the library, outside this folder. Agents keep using them." | Keep | — (consequence) | |
| `skills/SkillImport.tsx:73` | Import `Dialog description=` | "A folder with a SKILL.md, or a repository with several. Paperclip copies the skills in; to keep a repository's skills up to date, add it under Sources." | Move | Tip: same | |
| `skills/SkillImport.tsx:90` | path or URL `help=` | "Examples: /home/me/skills/review, github.com/owner/repo/tree/main/skills/review, owner/repo, https://skills.sh/…" | Move | Tip: same | |
| `skills/SkillImport.tsx:252` | Scan `Dialog description=` | "Skill folders (with a SKILL.md) in a project's workspaces. Imported skills keep reading the workspace's files." | Move | Tip: same | |
| `skills/SkillImport.tsx:263` | no project to scan | "No project has a workspace to scan yet. Give a project a code folder or repository first." | Keep | — (empty state, why) | |
| `skills/ConnectedAppSkills.tsx:115` | name collision note | "Another skill uses this name. Agents get this one under {app}'s name, so neither replaces the other." | Keep | — (state) | |

### Plugins

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `plugins/PluginLocalFolders.tsx:28` | Folders card description | "Folders on the server this plugin works in, for this organization." | Move | Tip: same text | |
| `plugins/PluginSettingsView.tsx:100` | Environment runtimes note (holds link) | "{name} adds environment runtimes. Set them up in Company settings → Environments." | Keep | — (holds link) | |
| `plugins/PluginStatus.tsx:45` | Health card description | "The plugin's own checks, every 30 seconds." / "Health checks run once the plugin is on and ready." | Split | Tip: "The plugin's own checks, every 30 seconds." / Visible (when not ready): "Health checks run once the plugin is on and ready." | |
| `plugins/PluginStatus.tsx:89` | Runtime card description | "Its worker process, scheduled jobs and webhook deliveries." | Move | Tip: same text | |
| `plugins/PluginStatus.tsx:98` | Recent logs card description | "The last {n} lines it wrote." | Keep | — (state: a count) | |
| `plugins/PluginStatus.tsx:115` | Permissions card description | "What it asked to be allowed to do." | Move | Tip: same text | |
| `plugins/SchemaForm.tsx:138` | Secret field fallback description (`Labelled`) | "Pick one of the organization's secrets, or paste a value (Paperclip stores it as a secret when you save)." | Move | Tip on the field label | |

### Onboarding

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `onboarding/OnboardingPage.tsx:125` | Step blurb (`ob-lede`) | "An organization holds your agents, projects and tasks. You set up its first agent next." | Move | Tip on the name Field (`info`) | |
| `onboarding/AgentOnboarding.tsx:567` | Name row help | "Your first agent runs the organization with you. Its instructions are written for that." | Move | Tip: same text | |
| `onboarding/AgentOnboarding.tsx:579` | Avatar row help | "One of the ClipLab palettes." | Remove | — (names an internal palette set; the picker shows the choice) | |
| `onboarding/AgentOnboarding.tsx:590` | Harness row help | "The program the agent works in. Other harnesses are in New agent once you're set up." | Move | Tip: same text | |
| `onboarding/AgentOnboarding.tsx:648` | Sign-in row help | "How the harness reaches its model: your subscription or an API key." | Move | Tip: same text | |
| `onboarding/AgentOnboarding.tsx:662` | Sign-in Menu.Item description | `choice.description` (e.g. "{harness} uses whatever it's signed in with on the machine it runs on.") | Keep | — (menu option) | |
| `onboarding/AgentOnboarding.tsx:683` | Selected sign-in description (raw `fhelp`) | `selectedSignIn(...).description` | Keep | — (describes the current choice) | |
| `onboarding/AgentOnboarding.tsx:696` | Model row help (gateway) | "The models your gateway lists." | Move | Tip: same text | |
| `onboarding/AgentOnboarding.tsx:723` | Thinking effort row help | "More effort is slower and costs more." | Move | Tip: same text | |
| `onboarding/AgentOnboarding.tsx:729` | Runner row help (`runnerHelp`, agents/new/new-agent-model.ts:216-225) | "Paperclip Runner supervises each run of {harness}; the legacy runner runs the program directly. You can switch later in the agent's settings." / "Test checks whether Paperclip Runner qualifies…" / "Paperclip picks a runner once it knows…" / "The only runner that carries {harness} here." | Split | Tip: the first (choice) text / Visible: the other three, which describe the current state | |
| `onboarding/AgentOnboarding.tsx:743` | Test row help | "Checks the harness is installed, signed in and can reach the model." | Move | Tip: same text | |
| `onboarding/AgentOnboarding.tsx:784` | Task row help | "Paperclip writes the brief. It's where you and your agent plan what comes next." | Move | Tip: same text | |
| `onboarding/GatewaySetup.tsx:38` | Dialog description | "Send {harness} through your own endpoint. Save it, then choose a model and test it." | Move | Tip (Dialog needs `info`, or on the Gateway address field) | |
| `onboarding/GatewaySetup.tsx:85` | Gateway address Field help | "Speaks {protocol}, as {harness} needs. HTTPS, or HTTP on localhost." | Move | Tip: same text | |
| `onboarding/GatewaySetup.tsx:99` | Sign-in Field help | "How Paperclip authenticates with the gateway." | Move | Tip: same text | |
| `onboarding/GatewaySetup.tsx:104` | Key Field help | "Stored encrypted. It isn't shown again." | Move | Tip: same text | |
| `onboarding/GatewaySetup.tsx:115` | Model ids Field help | "Comma separated: the provider's ids or your gateway's aliases. Leave empty to type one on the agent." | Move | Tip: same text | |
| `onboarding/GatewaySetup.tsx:143` | Who can use it Field help | "Everyone in the organization can run agents on it." / "Only runs you're responsible for use it." / "Only a connection manager can share a connection with everyone." | Keep | — (describes the current choice; the last is why it's fixed) | |
| `onboarding/GatewaySetup.tsx:169` | Every agent Toggle description | "Current and future agents can use it." / "Only this agent, for now. You can add others in Connections." | Keep | — (describes the current choice) | |

### Activity/costs

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `activity/ActivityLog.tsx:227` | denied empty state (`.org-empty`) | "Narrowing the log to one agent, person or run needs the audit permission (audit:view_agent_actions)." | Keep | — (why the filtered view is missing; permission name is right) | `packages/shared/src/constants.ts:1045` |
| `activity/ActivityLog.tsx:270` | `.org-foot` under the log | "Recorded by Paperclip; entries can't be edited, and secret values are never stored." | Move | Tip (beside the Log toolbar or subnav): "Recorded by Paperclip. Entries can't be edited, and secret values are never stored." | redaction on write: `server/src/services/activity-log.ts:81,168`; upstream wording `ui/src/pages/audit/AuditFeed.tsx:807` |
| `activity/RunsList.tsx:88` | `.org-muted` in toolbar | "The latest {RUN_LIMIT} runs." | Keep | — (state: the list's limit, 200) | |
| `activity/Commentary.tsx:111` | empty state | "No commentary yet. Suggestions and complaints show up here when agents send them." | Split | Tip: "Suggestions and complaints agents send in while they work." / Visible: "No commentary yet." | |
| `activity/Costs.tsx:295` | Budgets card empty state | "No budgets set. Set one for the organization, an agent or a project." | Keep | — (holds link "Set one") | scopes right: `packages/shared/src/constants.ts:902` |
| `activity/CostExtras.tsx:106` | `title=` on "Check plans again" button | "Paperclip couldn't ask the connected accounts which plan they're on." | Keep | Visible: "Couldn't check the plans · Check again" (an error shown only on hover; decision H) | |
| `activity/CostExtras.tsx:126` | Subscriptions `Dialog description=` | "Monthly fees of the accounts you can see. Token counts cover this organization's work in the range." | Move | Tip: "Monthly fees of the AI subscription accounts you can see. Token counts cover this organization's work in the range." | needs Dialog `info` |
| `activity/CostExtras.tsx:134` | dialog empty state | "No subscriptions you can see yet. Connect an AI account in Connections, or run an agent on a connected subscription." | Split | Visible: "No subscriptions you can see yet." / Tip: "Connect an AI account in Connections, or run an agent on a connected subscription." | |
| `activity/CostExtras.tsx:159` | per-account `.org-muted` line | "Paperclip can't confirm which account this is. If two connections are the same subscription, link them." | Split | Visible: "Paperclip can't confirm which account this is." / Tip: "If two connections are the same subscription, link them under Edit price." | |
| `activity/CostExtras.tsx:163` | per-account line | "The provider doesn't say which plan this is; enter the price yourself." | Keep | — (state plus next step, short) | |
| `activity/CostExtras.tsx:186` | dialog `.org-foot` | "A fee covers the whole account, including use outside Paperclip. Fees aren't charges and don't count against budgets. Currencies are added up separately." | Move | Tip: same text | "Monthly estimates never change recorded charges or agent budgets": `server/src/routes/openapi.ts` (PATCH …/subscriptions/{id}); per-currency totals `server/src/services/subscription-report.ts:90-93` |
| `activity/CostExtras.tsx:280` | price editor `.org-muted` note | "The full price of one account or seat. A yearly price is divided by 12. Changes count from now; ending it here doesn't cancel anything with the provider." | Split | Tip: "The full price of one account or seat. A yearly price is divided by 12. Changes count from now." / Visible (when Counting = ended): "Ending it here doesn't cancel the subscription with the provider." | /12: `packages/shared/src/subscriptions.ts:51-53`; "Appends price history from now… Ending tracking does not cancel provider billing": `server/src/routes/openapi.ts` (PATCH …/subscriptions/{id}) |
| `activity/CostExtras.tsx:291` | `Field help=` (link accounts) | "Linking counts them once, puts their usage together and keeps the chosen account's price. Only link the same subscription or seat." | Split | Tip (Field `info`): "Linking counts them once, puts their usage together and keeps the chosen account's price." / Visible (`help`): "Only link the same subscription or seat: linking can't be undone." | target price kept: `server/src/services/subscriptions.ts:75-95` (source gets `mergedIntoId`); no unlink route in `server/src/routes/costs.ts:136` |
| `activity/CostExtras.tsx:408` | per-run reason line (`QUALITY_REASONS[…].description`, text in `usage-model.ts:383-407`) | "The run didn't say whether it was billed per request…" (6 reasons) | Move | Tip beside each reason pill: the same reason text | matches upstream `ui/src/components/CostDataQualityNotice.tsx:13-38`; reasons `server/src/services/cost-data-quality.ts:24-44` |
| `activity/CostExtras.tsx:417` | `.org-foot` | "The 25 latest of each kind. Pick a shorter range to see more." | Keep | — (truncation state) | |
| `activity/CostReports.tsx:69` | `title=` on Estimated badge | "Worked out from token counts and published rates; the provider's bill may differ." | Move | Tip, once per view or card header: "Estimated: worked out from token counts and published rates; the provider's bill may differ." | hover-only explanation (decision H) |
| `activity/CostReports.tsx:128` | By person `.org-foot` | "“No one” is work with no responsible person here, such as routines and agents' own tasks." | Rewrite | Tip (By person header): "“No one” is spend with no responsible person recorded in this organization." | by-user joins the run's `responsibleUserId` (or the call's own for decision/fast-response), drops the local board: `server/src/services/costs.ts:385-392`. Routines carry a responsible person (`server/src/services/routines.ts:583`, old UI picker `ui/src/pages/Routines.tsx:972`), so "routines" is wrong as an example. Upstream: "Unattributed costs have no recorded user in this organization." (`ui/src/components/CostByUserTable.tsx:50`) |
| `activity/CostReports.tsx:181` | Providers `.org-foot` | "Subscription quota comes from each provider and is checked every few minutes. Budgets cap spend; quota is the provider's own limit." | Move | Tip (Providers view): same text | UI refetches quota every 5 min (`CostReports.tsx:158`) |
| `activity/CostReports.tsx:360` | Billers `.org-foot` | "The biller is who sends the bill. It differs from the provider when a router such as OpenRouter resells a model." | Move | Tip (Billers view): same text | |
| `activity/CostReports.tsx:531` | Recent entries card header subtitle (`.org-muted org-push`) | "Charges, fees and credits, apart from run estimates" | Move | Tip (card title): "Charges, fees and credits reported by providers, apart from run estimates." | |
| `activity/CostReports.tsx:535` | Recent entries empty state | "Nothing recorded in this range. Entries arrive through the API, the CLI or a provider integration." | Split | Visible: "Nothing recorded in this range." / Tip: "Entries arrive through the API, the CLI or a provider integration." | `POST /companies/:id/finance-events` `server/src/routes/costs.ts:210`; CLI `finance event:create` `cli/src/commands/client/cost.ts:58`; imports `server/src/services/provider-billing-import.ts` |
| `activity/CostReports.tsx:592` | Credits KPI note | "Refunds and credit purchases" | Rewrite | Tip (Credits KPI label): "Entries marked as credits: refunds, offsets and credit returns." | credits = `direction = 'credit'` (`server/src/services/finance.ts:81`), set by the reporter, default debit (`packages/shared/src/validators/finance.ts:16`); buying credits is money paid, not a credit. Upstream: "Refunds, offsets, and credit returns" (`ui/src/pages/Costs.tsx:153`) |
| `activity/CostReports.tsx:627` | call history empty state | "No decision-model calls in this range. Set up a decision model in company settings → Paperclip Models, and run its test." | Keep | — (holds link) | |
| `activity/CostReports.tsx:632` | `.act-calls-note` | "The latest calls. Their inputs aren't kept." | Split | Visible: "The latest calls." / Tip: "Paperclip keeps each call's details and cost, not its inputs." | history is "decision metadata and charges" (`server/src/routes/openapi.ts:12159-12161`); upstream `ui/src/components/decision-models/DecisionHistory.tsx:11` |

### Shell/nav

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `layout/Nav.tsx:190` | `Menu.Item description=` (All companies) | "Change their order there" | Remove | — (the Companies page shows its reorder arrows; the rail's company card has no such line) | `routes/Companies.tsx:118-139` |
| `layout/Nav.tsx:432` | `.navi-note` beside All tasks | "company" | Keep | — (scope tag, sets All tasks apart from project rows) | |
| `layout/Nav.tsx:522` | `Menu.Item description=` (Leave project) | "Takes it out of your nav" | Keep | — (consequence before acting) | sets membership `left` and unstars: `layout/nav-prefs.tsx:95-101`, `server/src/services/resource-memberships.ts:278-281` |
| `layout/Nav.tsx:574` | `Menu.Item description=` (Run now) | "Starts a heartbeat now" | Remove | — (the label says it; "heartbeat" is jargon, and it queues a wakeup) | `org/actions.ts:94-95` → `POST /agents/:id/heartbeat/invoke`, `server/src/routes/agents.ts:6502-6560` (`heartbeat.wakeup`) |
| `layout/SettingsNav.tsx:127` | App settings title note | "This Paperclip instance" | Keep | — (scope line, as Company settings shows the company's name) | |
| `layout/SettingsNav.tsx:134` | `.snav-note` (admins) | "No Experimental page. The switches still worth changing are under General → Features." | Move | Tip on General → Features card (`settings/app/FeaturesCard.tsx:61`): "Replaces the old Experimental page: the switches still worth changing." | |
| `layout/TasksSheet.tsx:208` | "Add a company" row tag | "On desktop" | Keep | — (why it's missing on a phone) | |
| `layout/TasksSheet.tsx:239` | `Switch description=` | "Not available yet: Paperclip has no push notification API." | Keep | — (disabled reason; true: no web-push/PushSubscription anywhere in `server/src`) | |
| `layout/TasksSheet.tsx:251` | View profile row subtitle | "Your work and what agents spent on it" | Keep | — (row subtitle in a link; no room for a tip button) | |
| `layout/TasksSheet.tsx:260` | Settings and admin row subtitle | "Company, secrets, plugins, routines, activity" | Rewrite | Visible: "Members, models, secrets, budgets, environments" | the row opens company settings, whose sections are General, Members, Paperclip Models, Secrets, Budgets, Environments, Import and export and plugin pages (`settings/company/sections.ts:20-39`); recurring tasks and Activity are their own pages (`activity/ActivityPage.tsx`) |
| `layout/TasksSheet.tsx:270` | App settings row subtitle | "Your profile, this instance, harnesses, plugins" | Keep | — (matches `settings/app/app-settings-model.ts:51-57`) | |
| `routes/CompanyLayout.tsx:216` | phone `.on-desktop` note | "On desktop. {Area} are made for a bigger screen; you can look around here, but changes are easier on desktop." | Keep | Visible (shorter): "On desktop. Made for a bigger screen; changes are easier there." | |
| `routes/Companies.tsx:88` | empty state | "Create your first organization and its first agent." | Keep | — (empty state above its button) | |
| `routes/Legacy.tsx:101` | case link error | "Cases are turned off on this instance. An instance admin can turn them on in App settings → General → Features; then this link opens the case's main task." | Keep | — (why the link can't open; a 403 here is the cases-off denial, a read denial is a 404) | `server/src/routes/cases.ts:1574-1576`, `server/src/services/case-access.ts:166` |
| `routes/Legacy.tsx:120` | `StatusPlaceholder` PlannedNote | "Status cards (a board of tiles an agent keeps up to date, with history and dry runs) are being ported…" | Remove | — (dead code: not routed; status cards are built, `App.tsx:46,185`) | |
| `routes/NotFound.tsx:27` | `NotBuiltYet` body | "This page is planned for a later milestone. The classic UI still has it." | Rewrite | Visible: "This page isn't in this app. The classic UI may still have it." | renders for any unmatched company address that isn't a plugin page (`App.tsx:221`): typos and pages left out on purpose too, not only planned ones |
| `routes/SignIn.tsx:62` | Standalone `lede` (sign in) | "Use your email and password for this Paperclip." | Remove | — (the form's fields say it) | |
| `routes/SignIn.tsx:62` | Standalone `lede` (sign up) | "An account on this Paperclip. No email confirmation is needed." | Split | Tip (beside title): "No email confirmation is needed." / Visible: — | `requireEmailVerification: false`, `server/src/auth/better-auth.ts:294` |
| `shell/CommandPalette.tsx:321` | `.palette-foot` key legend | "↑ ↓ move · Enter open · Shift Enter search everything · Esc close" | Keep | — (control legend, `aria-hidden`) | |
| `shell/DevBanners.tsx:128` | restart `Dialog description=` | "This may interrupt {n live runs}." / "Nothing is running right now." | Keep | — (state and consequence before acting) | |

### Recurring (routines)

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `recurring/RecurringView.tsx:248` | empty state | "No recurring tasks yet. A task can repeat on a schedule, or each time a webhook arrives." | Split | Visible: "No recurring tasks yet." / Tip: "A task can repeat on a schedule, or each time a webhook arrives." | |
| `recurring/RecurringView.tsx:263` | phone note (`rv-on-desktop`) | "On desktop. You can turn recurring tasks on or off and run them here; setting them up is easier on desktop." | Keep | — (why the setup controls are missing on a phone) | |
| `recurring/RecurringView.tsx:371` | delete folder `Menu.Item description` | "Its recurring tasks move to Unfiled" | Keep | — (consequence) | |
| `recurring/RecurringView.tsx:399` | empty folder | "Nothing in this folder yet. Move a recurring task here from its panel." | Keep | — | |
| `recurring/RecurringView.tsx:602` | delete folder dialog note | "Its recurring tasks move to Unfiled. Nothing else changes." | Keep | — (destructive confirm) | |
| `recurring/RecurringPanel.tsx:237` | Archive `Menu.Item description` | "It stops running; restore it any time" | Keep | — (consequence) | |
| `recurring/RecurringPanel.tsx:244` | Restore `Menu.Item description` | "Comes back paused" | Keep | — (consequence) | |
| `recurring/RecurringDetails.tsx:357` | folders menu empty | "No folders yet. Make one from a folder's menu in the list." | Keep | — | |
| `recurring/RecurringDetails.tsx:483` | Description empty | "No description. Each task it makes starts with only the title." | Keep | — (state) | |
| `recurring/RecurringDetails.tsx:588` | Add trigger `Menu.Item description` | "Run at set times" | Keep | — (menu option description: stays visible, see J1) | |
| `recurring/RecurringDetails.tsx:591` | Add trigger `Menu.Item description` | "Run when an app or script calls a URL" | Keep | — (menu option description: stays visible, see J1) | |
| `recurring/RecurringDetails.tsx:594` | Add trigger `Menu.Item description` | "Run on events from a GitHub repository" | Keep | — (menu option description: stays visible, see J1) | |
| `recurring/RecurringDetails.tsx:599` | Add trigger `Menu.Item description` | "Run from a script with an API key" | Keep | — (menu option description: stays visible, see J1) | |
| `recurring/RecurringDetails.tsx:608` | no triggers | "No triggers: it runs only when you press Run now." | Keep | — | |
| `recurring/RecurringDetails.tsx:741` | Rotate secret `Menu.Item description` | "The old secret stops working" | Keep | — (destructive) | |
| `recurring/RecurringDetails.tsx:845` | Inputs empty state | "No inputs. Write a placeholder like {{date}} or {{region}} in the title or description to add one." | Split | Visible: "No inputs." / Tip: the section's tip already says how to add one. | |
| `recurring/RecurringDetails.tsx:852` (text in `recurring/recurring-model.ts:261-262`) | built-in input row | "The run's date, like 2026-10-26" / "The run's date and time, in UTC" | Keep | — (row content: what the input holds) | |
| `recurring/RecurringDetails.tsx:874` | Choice type `Menu.Item description` | "One of a list of options" | Keep | — (menu option description: stays visible, see J1) | |
| `recurring/RecurringDetails.tsx:999` | Add a secret popover note | "Each run gets it as an environment variable, over the project's and the agent's." | Move | Tip: same | |
| `recurring/RecurringDetails.tsx:1007` | no secrets | "This company has no secrets yet. Add them in company settings." | Keep | — | |
| `recurring/RecurringDetails.tsx:1048` (text in `recurring/schedule.ts:52-54`) | open-run policy `Menu.Item description` (3) | "The new run joins the task that's still open" / "No new task while the last one is open" / "A new task every time" | Keep | — (menu option description: stays visible, see J1) | |
| `recurring/RecurringDetails.tsx:1069` | Missed runs `Menu.Item description` (2) | "Runs the server missed while it was down are dropped" / "Missed runs catch up, a few at most" | Rewrite | Visible (menu descriptions): "Missed runs are dropped" / "Missed runs are made up, up to 25" | `MAX_CATCH_UP_RUNS = 25` (`server/src/services/routines.ts:95`, used at `:3333`). "A few" undersells 25. |
| `recurring/RecurringDetails.tsx:1114` | gate disabled reason | "Only schedules can wait for a change." | Keep | — (disabled reason) | |
| `recurring/RecurringDetails.tsx:1208` | plugin notice | "It matches the plugin's defaults. / Changed from the plugin's defaults: … The plugin may put them back. Plugin settings" | Keep | — (state; holds link) | |
| `recurring/RecurringRuns.tsx:87` | runs empty state | "No runs yet. Run now starts one." | Keep | — | |
| `recurring/RecurringRuns.tsx:366` (text at `:42-43`) | Workspace `Menu.Item description` (2) | "The project's main checkout" / "A fresh branch just for this run" | Rewrite | Visible (menu descriptions): "The project's primary workspace, shared with other tasks" / "A fresh branch just for this run" | The shared mode uses the project's primary workspace as is, which can be a local folder rather than a checkout (`server/src/services/heartbeat/workspaces.ts:3544-3640`, source `project_primary`). |
| `recurring/RecurringRuns.tsx:428` | Environment default `Menu.Item description` | "The agent's own environment" / "The instance default" | Keep | — (state: which default applies) | |
| `recurring/RecurringActivity.tsx:114` | activity scope note | "Shows the activity of the latest {N} runs. Runs has every run." | Keep | — (state: the list is cut) | |
| `recurring/ConnectWebhook.tsx:156` | secret not shown | "The secret was shown once, when the webhook was made. Rotate it to see a new one; the old one stops working." | Keep | — (state; destructive note) | |
| `recurring/ConnectWebhook.tsx:198` | waiting for a test event | "In GitHub, open the webhook's Recent Deliveries and redeliver one. Test events don't create a task." / "Send one from your app, …" | Keep | — (instructions for the current step) | |

### Status cards

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `status-cards/StatusPage.tsx:134` | `.sc-page-note` (flag off) | "Status cards are off on this instance. An instance admin turns them on with the \`enableStatusCards\` experimental setting." | Rewrite | Visible: "Status cards are off on this instance. An instance admin can turn them on in the app settings' Features." | The flag is a "Status cards" switch in ui-new's Features card (`ui-new/src/settings/app/FeaturesCard.tsx`, `features-model.test.ts:90–114`); the backticks show literally in JSX text |
| `status-cards/StatusPage.tsx:148` | empty-state `<p class="muted">` | "A card keeps a summary of the tasks you care about current: ask it a standing question, and an agent answers it as the tasks change." | Split | Tip (beside "No status cards yet", or on the page title): same text / Visible: heading + New card button | |
| `status-cards/StatusPage.tsx:246` | Restore button `title=` | "Restoring runs an update at once" | Keep | — (hover title; see judgement calls) | |
| `status-cards/AgentPicker.tsx:49` | `Menu.Item description=` (Summarizer) | "The company's built-in agent for summaries" | Keep | — (menu option description) | |
| `status-cards/CardTile.tsx:83` | `Menu.Item description=` | "Rebuilds the query from the prompt" | Keep | — (menu option description) | |
| `status-cards/CardPanel.tsx:133` | `Menu.Item description=` | "Writes the summary from scratch" | Keep | — (menu option description) | |
| `status-cards/CardPanel.tsx:138` | `Menu.Item description=` | "Builds the query again from the prompt" | Keep | — (menu option description) | |
| `status-cards/CardPanel.tsx:142` | `Menu.Item description=` | "Stops updates; keeps its summary and history" | Keep | — (menu option description; consequence) | |
| `status-cards/CardPanel.tsx:444` | Watched tab intro `<p class="cap">` | "A dry run of the card's query: the tasks it matches now. No agent runs." | Move | Tip (beside Run again): same text | |
| `status-cards/CardSettings.tsx:36` | radio option note (`.sc-option .cap`) | "Updates only when you ask" | Move | Tip on "Manual": same text | |
| `status-cards/CardSettings.tsx:37` | radio option note | "Checks every few minutes, and updates if something changed" | Move | Tip on "On a schedule": same text | `server/src/services/status-card-update-engine.ts:145` |
| `status-cards/CardSettings.tsx:38` | radio option note | "Updates shortly after a change, up to a limit an hour" | Move | Tip on "When something changes": same text | same file :181 |
| `status-cards/CardSettings.tsx:107` | `Field help=` ("Name") | "Leave it empty to let the agent name the card." | Move | Tip (Field `info`): same text | |
| `status-cards/CardSettings.tsx:110` | `Field help=` ("What this card watches and reports") | "The agent builds the query from this and follows it in every update. Changing it rebuilds the card." | Split | Tip: "The agent builds the query from this and follows it in every update." / Visible: "Changing it rebuilds the card." | |
| `status-cards/CardSettings.tsx:113` | `Field help=` ("Agent") | "Runs the card's setup and updates." | Move | Tip (Field `info`): same text | |
| `status-cards/CardSettings.tsx:196` | Switch `description=` ("Only during active hours") | "Changes outside the window wait for one update when it opens." | Move | Tip: same text | |
| `status-cards/CardSettings.tsx:222` | unit `.cap` after the cap input | "tokens; empty uses the server's {100K}" | Split | Tip: "Empty uses the server's default, {100K} a day." / Visible: "tokens" | default 100 000: `status-card-update-engine.ts:176` |
| `status-cards/CardSettings.tsx:230` | `Tooltip content=` on the estimate | "{note} A rough guide from typical update sizes; the History tab has what each update really cost." | Move | Tip (InfoTip beside "Estimated cost", replacing the hover-only Tooltip): same text | hover-only `Tooltip` doesn't open on tap (decision H) |
| `status-cards/CardSettings.tsx:246` | query caption `.cap` | "Built {when}, version {n}. The agent keeps it; change the prompt to rebuild it." | Split | Tip (beside "Query"): "The agent keeps the query; change the prompt to rebuild it." / Visible: "Built {when}, version {n}." | |
| `status-cards/CardSettings.tsx:268` | ConfirmDialog body | "Its summary, history and settings go for good. Archive it instead to keep them." | Keep | — (destructive warning) | |
| `status-cards/NewCardDialog.tsx:81` | `Dialog description=` | "Say what to keep an eye on and what each update should tell you. The agent builds the query from it and writes every update to it." | Move | Tip (Field `info` on "What do you want to keep an eye on?"): same text | |
| `status-cards/NewCardDialog.tsx:119` | `Field help=` ("Agent") | "Runs the card's setup and updates. Each run is a real agent run and costs tokens." | Split | Tip: "Runs the card's setup and updates." / Visible: "Each run is a real agent run and costs tokens." | |

### Profile and sign-in

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `profile/ProfilePage.tsx:123` | Usage card note (`<p class="cap">`) | "What agents spent working on this person's tasks." | Move | Tip by "Agent attribution" | |
| `profile/ProfilePage.tsx:134` | Usage card note | "The models behind that spend." | Move | Tip by "Provider mix" | |
| `auth/AuthForm.tsx:69` | Password Field help (sign up) | "At least {n} characters." | Keep | — (a rule needed before typing; see judgement calls) | |
| `auth/BoardClaim.tsx:74` | Standalone lede | "This makes your account the instance admin and moves the local board's organizations to it." | Keep | — (consequence before claiming) | |
| `auth/BootstrapPending.tsx:22` | Host fallback instructions | "Prefer to finish from the host? Run this where Paperclip runs to print a one-time first-admin invite link:" / "A first-admin invite is already active…" | Keep | — (instructions for the command shown) | |
| `auth/BootstrapPending.tsx:56` | Standalone lede | "It runs invite-only. The operator makes a one-time first-admin invite link on the host; open it in this browser to finish setup." | Keep | — (state and the only way forward) | |
| `auth/BootstrapPending.tsx:59` | Muted note | "Claiming from the browser is off on public instances, so nobody on the network can make themselves admin." | Keep | — (why the claim button is missing) | |
| `auth/CliAuth.tsx:94` | Standalone lede | "A CLI is asking for full board access to the organizations you can open here. Approve it only if you started this in your own terminal." | Keep | — (security warning) | |
| `auth/ChatIdentity.tsx:79` | Body paragraph | "Confirm only if this is your {provider} identity. Paperclip checks your organization membership on every action." | Keep | — (security warning) | |
| `auth/Invite.tsx:199` | Standalone lede | "This invite is for an agent. Fill in its details to send the join request." / "Create your Paperclip account first, or sign in if you already have one, and the invite is accepted for you." | Keep | — (the next step) | |
| `auth/Invite.tsx:302` | Standalone lede | "{inviter} needs to approve it, from Settings → Members. Open this link again once it's approved." | Keep | — (state: waiting for approval) | |
| `auth/McpConnect.tsx:191` | Device code check | "Check this matches the code your assistant shows: {code}" | Keep | — (verification step) | |
| `auth/McpConnect.tsx:204` | Pairing paragraph | "Enter the one-use code from Paperclip's agent setup to review what this connection may do. Keep the code out of the bot's chat. Access is granted only when you allow the agent named below." | Keep | — (security instruction) | |
| `auth/McpConnect.tsx:294` | Access paragraph | "Connect Dot as a Paperclip agent. Pair it with an agent after connecting…" / "It can read all of your Paperclip data in this organization." | Keep | — (what access is granted) | |
| `auth/McpConnect.tsx:350` | Assistant connections Standalone lede | "Revoking a connection stops its future tool calls. Work it already handed off carries on under your organization's usual controls." | Move | Tip by the title (Standalone has no `info`) | |

### Others

| Where | Element | Current text | Verdict | Proposed | Evidence |
| --- | --- | --- | --- | --- | --- |
| `lib/session.tsx:203` | session-gate Splash body (server unreachable) | "The server isn't answering. Start it with corepack pnpm dev at the repo root; this page retries on its own." | Rewrite | Visible: "The server isn't answering. This page retries on its own." | shown on every instance, including the Docker deploy (`deploy/README.md`), where there is no repo to run `pnpm dev` in. The auto-retry is real: `lib/session.tsx:134,143` (`refetchInterval` on temporary errors) |

## 3. Judgement calls

Cases where the rule is unclear, with a recommendation. The area tables already follow these
recommendations, except where a call says otherwise. Each area's own notes follow the list.

- **J1. Menu option descriptions stay visible.** `Menu.Item description=` (`.mi-desc`) shows only
  while the menu is open, which is exactly when the person is choosing, and a menu item can't hold
  an "i" button: the item takes the click and closes the menu, and on phones menus are sheets. So
  they're Keep, Remove when they repeat the label, and Rewrite when they're wrong. This matches the
  converted Secrets menus (`settings/company/SecretVaults.tsx:244-261`). The Projects, Skills and
  Recurring agent first marked 17 of them Move, as one tip beside the trigger listing every option;
  they're set to Keep here. The alternative stays open if the user prefers it.
- **J2. Radio and choice-card options.** Where the option is a `<label>` with a radio (Connect's
  method picker, status card modes, project visibility, the Slack method), its description moves
  into a per-option `info`, as `ChoiceCard` does (`apps/shared.tsx:67`). Where the choice is
  itself a button or link (ChatConnect's `PurposeChoice`, template tiles in `apps/advanced`), a tip
  would sit inside an interactive element: keep the text as the tile's content.
- **J3. Segmented controls.** One tip on the control's label explaining every option, one line
  each; never one tip per segment.
- **J4. A description of the currently selected option** (ImportCard:404, GatewaySetup:143,169,
  AgentOnboarding:683, EnvironmentDialog:393, agent trust preset at PermissionsSection:300) is
  borderline state. Keep it when it states a consequence of the choice; move it when it only
  explains the option. The settings agent kept these; the agents agent moved the trust preset's.
  Recommendation: keep the ones above except PermissionsSection:300, which explains the preset.
- **J5. "Changes save as you make them" / "Changes save at once."** It's guidance on how the card
  works, and the save status beside it already shows the state. Recommendation: move it into the
  card's tip and leave the save status visible. The agent settings rows
  (`ProfileSection.tsx:63`, `PermissionsSection.tsx:87`, `InteractionsCard.tsx:47-48`,
  `SkillsSection.tsx:132`) and `apps/chat/GitHubBot.tsx:277` are marked Keep or Split in the tables;
  they should follow this call, for one rule across settings.
- **J6. Empty states that also explain the feature** are Split: the empty state stays ("No
  commentary yet."), the explanation moves to the section's tip. If the explanation holds a link
  (the next step), it stays visible.
- **J7. Setup steps and instructions to act now** (Slack and GitHub setup, copy-this-value
  steps, `.ch-howto`) are Keep. They're the task, not a description of it; only their "why"
  parts move.
- **J8. Security and cost notes.** Keep when they change whether the person goes ahead: invite
  links anyone can use (`MembersSection.tsx:319`), guests in chat, a test call that runs the real
  action (`apps/TestCall.tsx:105`), agents that may act as you (`apps/identities/Identities.tsx:268`),
  "Shown here and in run logs" for plain variables (verified: only secret keys are redacted from a
  run's logged env, `server/src/services/heartbeat/run-output.ts:311`). Move when only admins see the
  control and the note is standard (provider traces, `RuntimeSection.tsx:376`).
- **J9. Settings the server ignores.** Cooldown (`RuntimeSection.tsx:345`) isn't read anywhere, and
  a project workspace's Setup command (`CodeSection.tsx:631`) is stored but never run. A tip that
  says "this does nothing" is odd. Recommendation: hide both rows in ui-new (UI-only, keeps the
  stored value) and record the drop in the capabilities inventory; the setup command is also an
  upstream question (a candidate for `fork/upstream-fixes.md`, as an issue rather than a fix).
- **J10. Hover-only text breaks decision H.** `title=` attributes holding text found nowhere else
  (`status-cards/StatusPage.tsx:246` Restore, `runs/RunModal.tsx:594` Stop, `NewAgentPage.tsx:868`,
  `activity/CostReports.tsx:69`, `activity/CostExtras.tsx:106`, `AiSummary.tsx:123`), recurring's
  local `InfoTip` and `search/SearchControls.tsx:49` `TypedFiltersTip` all open on hover only.
  Explanations become `ui/InfoTip`; the error in `CostExtras.tsx:106` becomes visible text.
- **J11. Page-level notes with no header to sit beside** (`.org-foot` footers in Activity and
  Skills, `act-toolbar` spans in Skills): put one InfoTip beside the page's subnav or toolbar, not
  one per note.
- **J12. Text inside links and tiles.** Phone link-row subtitles (`layout/TasksSheet.tsx:251-270`)
  and template tiles can't hold an InfoTip (no buttons inside an `<a>`). Keep them as short
  subtitles; only fix the wrong one (`TasksSheet.tsx:260`).
- **J13. Keyboard hints** (Inbox key hints, composer "Enter to send", document shortcuts) are
  general guidance, but they only help while visible. Keep them; consider hiding them on touch
  screens.
- **J14. Development placeholders and roadmap text** (`settings/app/AccountSection.tsx:189`
  LaterNote, `EnvironmentsSection.tsx:225` "On hold (decision 39, D7)", Memory's "one memory for
  every harness is still to come", `routes/Legacy.tsx:120`, `routes/NotFound.tsx:27`) aren't help.
  Remove or reword them in a separate cleanup, not as tips.
- **J15. Text that points at experimental flags** (status cards off, cases off, isolated
  workspaces off) stays visible as a disabled reason, but must name the switch as the Features card
  shows it, not the flag key (`status-cards/StatusPage.tsx:134` shows `enableStatusCards` in
  backticks). The flags are being settled (CLAUDE.md, "Remove the switches"), so these lines may
  go later.
- **J16. Plugin-authored field descriptions** (`plugins/SchemaForm.tsx`, `schema.description`) are
  data, but they work as field help. Recommendation: render them behind `info` in `Labelled`,
  `Toggle` and the array and object headers, so plugin settings match the rest.
- **J17. Plugin-storage projects with Isolated workspaces off.** The Task checkouts card's note
  (`CodeSection.tsx:736`, Keep) says "Tasks share the project workspace" when the instance has
  Isolated workspaces off. The build plan records that a project created with a workspace storage
  plugin applies its task-checkout policy even then, so the note is wrong for those projects. Not
  re-verified here; check `server/src/services/heartbeat.ts:2484-2491` and the storage plugin path
  before rewording, and say so in the note only for plugin-storage projects.
- **J18. Suspects to confirm before changing**: skills "update by themselves" (`SkillCatalog.tsx:134`,
  `SkillLibrary.tsx:186`, `SkillStudio.tsx:56`), who approves hires (`GeneralSection.tsx:224`), the
  company name "in agents' instructions" (`GeneralSection.tsx:113`), Suspend
  (`MembersSection.tsx:198`), the "Create skills" permission (`PermissionsSection.tsx:93`), the
  instance default environment lookup (`agents/settings/fields.tsx:150` reads
  `metadata.defaultForInstance`, the server reads `instanceSettings.defaultEnvironmentId`), and the
  gateway run-token lifetime (`apps/gateways/GatewayDetail.tsx:361`).

Confirmed here, beyond the area agents' checks: Cooldown is unused (only a default in
`server/src/services/company-portability.ts:804`); the project's variables win
(`run-preparation.ts:556-560`); required personal secrets fail, not wait; a project workspace's
`setupCommand` is never run; routines catch up at most 25 runs (`server/src/services/routines.ts:95`);
the no-workspace folder order (`heartbeat/workspaces.ts:3661-3690`). The role descriptions were
re-checked against `company-member-roles.ts`: operators also get `agents:create` and
`agents:configure`, so the proposed role text stays coarse until the finer rules are traced.

### Area notes

The area auditors' own judgement calls, lightly edited. Where one disagrees with J1–J18, the J call wins.

#### Tasks; Inbox and requests

- **Menu option descriptions (Menu.Item / Menu.CheckboxItem `description=`, `.mi-desc`):** 24 Keep rows and 3 Remove rows above. I marked them Keep: they're short, they say what an option does at the moment of picking it, and a tip inside a menu item is hard to reach (the item takes the click and closes the menu). Only ones that repeat their label are Remove (`tasks/TaskActions.tsx:224`, `tasks/TasksView.tsx:897`, `cases/NewTaskCase.tsx:91`). If the sweep wants these moved too, it needs a Menu change first (see Shared components).
- **Keyboard hints** (`tasks/TaskEditors.tsx:189`, `tasks/TaskList.tsx:737`, `documents/NewDocument.tsx:130`, `documents/DocumentView.tsx:747`, `inbox/InboxPage.tsx` KeyHints ×5): Keep. They're general guidance by the letter of the rule, but they only help while visible at typing time. `TaskList` already has a `hideHint` prop. Alternative: hide them on touch screens only.
- **Search idle card** (`search/SearchPage.tsx:607`): it's all guidance, so Move. But without recent searches the idle card would be empty. Either drop the card when there's nothing recent, or keep one visible line ("Type to search tasks, comments, docs, files, agents and projects"). Recommend the tip plus dropping the empty card.
- **`documents/Annotations.tsx:253`** "Select text in the document to comment on it.": Keep. It's the only cue for how to start a comment, and it shares the slot with the blocked reason (state).
- **`tasks/TaskRecovery.tsx:567`, `tasks/integrations/EmailThread.tsx:202`**: guidance-like, but they tell the person what to check before an action that can't be undone. Keep.
- **`cases/StartWorkflow.tsx:73`** (dialog description): Keep, because it says the agent is woken. If dialogs get an `info`, the first half ("Hands the case to an agent with a new main task") could move.
- **`tasks/composer/Composer.tsx:409`** is a placeholder, not body text. I listed it only because it's inaccurate ("nothing runs").
- **`tasks/NewTaskDialog.tsx:160`** EXTRA_META "Private: Only you and the assignee can see it": also people it's later shared with, its responsible user, and members of a private project (`server/src/services/authorization.ts:663-675`). Fine for a menu line; the tip at `TaskActions` (title) already says "people and agents with access".
- `recurring/RepeatMenu.tsx` and `recurring/ConnectWebhook.tsx` render inside the new-task dialog but aren't in my files. The coordinator should check that the recurring area covers them.

#### Projects; Skills; Recurring

- **Option descriptions in menus** (`Menu.Item description=`): first marked Move (one tip beside the trigger listing every option); the coordinator set them to Keep to match the other areas (J1). Wrong ones are Rewrite in place.
- `projects/NewProjectDialog.tsx:367,374`: the Visibility pill has no label beside it to carry a tip. Either add one tip next to the pill row, or keep the two descriptions: they're short and they're what you choose between. I'd keep them unless the menu-description rule is applied app-wide.
- `projects/settings/ArchiveSection.tsx:45`: the not-archived variant describes the action next to a danger button. Kept visible as a destructive consequence; moving it would leave a bare "Archive project" row.
- `projects/settings/ArchiveSection.tsx:66` (join/leave): not destructive, so Move. Kept rows beside it would look uneven; an `info` on the row title works.
- `projects/settings/EnvironmentSection.tsx:137`: "Shown here and in run logs" stays visible because it warns that a plain value leaks into logs. The other two descriptions can move.
- `projects/settings/EnvironmentSection.tsx:207`: kept visible (rewritten) because it explains why a card has no control. Alternatively remove the whole Execution environment card: it has nothing to set.
- `projects/settings/CodeSection.tsx:631`: if the coordinator confirms that a project workspace's setup command is never run, the honest fix is to hide the field (fork policy: no server change) or note "Paperclip doesn't run this yet". Not changing it on the strength of my search alone.
- `projects/summary/AiSummary.tsx:123`: an "AI" chip `title` is hover-only. Make it an InfoTip, or drop it (the chip plus "Regenerate the brief" already say it).
- `projects/summary/AiSummary.tsx:297`: `SummaryCard` renders its `description` prop visibly as the empty state, but nothing calls `SummaryCard` today (grep found no callers outside the file). Nothing to convert now; whoever uses it should pass state text only.
- `skills/SkillCatalog.tsx:384`, `skills/SkillActions.tsx:559`, `skills/SkillStudio.tsx:639`: the help repeats what the placeholder or label shows. Move or Remove both fine; I chose Move/Remove per row.
- `recurring/RecurringRuns.tsx:428`: "The agent's own environment" / "The instance default" is state (which default this run gets). Kept.
- Rewrites marked "suspect" (`SkillCatalog.tsx:134`, `SkillLibrary.tsx:186`, `SkillStudio.tsx:56`, `CodeSection.tsx:631`): checked in `server/src/services/company-skills.ts` and `skill-sources.ts`, or by searching `server/src` and `packages`, but not run end to end.

#### Agents

- **Rewrites, most important first.**
  - `agents/settings/RuntimeSection.tsx:327` On a heartbeat: besides the tip, show a visible state line when it can't do what the switch suggests: for a `paperclip_runner` agent ("Paperclip Runner agents don't take scheduled check-ins without a task"), and when `runtimeConfig.heartbeat.skipTimerWhenNoActionableWork` is true ("Skips check-ins while it has no open task"). The UI doesn't read either today.
  - `agents/settings/RuntimeSection.tsx:345` Cooldown: the server ignores `heartbeat.cooldownSec`. Recommend dropping the row (keep the stored value) rather than a tip that says it does nothing.
  - `agents/settings/RuntimeSection.tsx:326` When there is work: turning it off also blocks Run now and routine wakes. Worth a visible warning when it's off, not only the tip.
  - `agents/settings/SecretsSection.tsx:74`: precedence is the opposite of what's shown (the project's value wins). Also check `projects/settings` and any other "on top of" wording elsewhere (coordinator).
  - `agents/settings/fields.tsx:172-178` + `RuntimeSection.tsx:317`: "Organization default" is really the instance default. `EnvironmentMenu` is shared with New agent (`NewAgentPage.tsx` "Where it runs"), so one fix covers both. Note too that `instanceDefaultEnvironment()` (`fields.tsx:150`) finds the default by `metadata.defaultForInstance`, while the server reads `instanceSettings.defaultEnvironmentId` (`agent-runner-selection.ts:480`). The two may disagree (suspect; not checked further).
  - `agents/settings/BudgetSection.tsx:94,170` and `org/OrgAgents.tsx:600`: a hard stop also stops running work, and raising the limit resumes the agent by itself.
  - `agents/settings/SecretsSection.tsx:180`: "Runs wait" vs. fail is a suspect only; confirm before changing.
- `agents/settings/PermissionsSection.tsx:93` Create skills: suspect that `canCreateSkills` doesn't gate anything (the skill routes use the company skill policy and `skills:create` grants). Kept as Move; worth a closer look, maybe an upstream question.
- `agents/settings/RuntimeSection.tsx:376` provider traces: Move all. You could argue "records the full model input and output" is a privacy note to keep visible, but only admins can read traces and the switch only shows to admins (`canTrace`).
- "Changes save at once." / "Changes save as you make them." (`PermissionsSection.tsx:87`, `InteractionsCard.tsx:47-48`, `SkillsSection.tsx:132`, `ProfileSection.tsx:63`): kept visible as save behaviour beside the save status. Alternative: drop them, since the save status already shows.
- `agents/settings/PermissionsSection.tsx:300`: the current preset's description under the menu. Moving it into the row tip leaves only the hiring warning visible. You could argue it's state ("what this preset means"); I'd still move it.
- `agents/settings/AdvancedSection.tsx:52` "Anything you leave out stays as it is." is key to editing YAML safely. Tip recommended, but it could stay visible as a short line.
- `org/BulkEditDialog.tsx:397`: consequences of the bulk change ("applies to future runs…"). Tip recommended; fine to keep if it's read as a must-see before Update.
- `agents/settings/MemorySection.tsx:187`: the "one memory for every harness is still to come" banner is product-roadmap text. Move to a tip, or drop it.
- Hover-only `title` attributes holding text found nowhere else (decision H): `agents/AgentHeader.tsx:368-371` (status pill: "Runs start once its setup check passes." Profile shows it visibly at `ProfileSection.tsx:288`, so it's fine as a repeat). And `runs/RunModal.tsx:594` (Stop button on a failed run: "Stop the retry this run would start by itself."). Add an InfoTip or a visible line next to the button for the second.
- `agents/new/NewAgentPage.tsx:832` and `:855` say the same thing; keep the visible note and drop the hover Tooltip. `:868` is the reverse: the only explanation of "Draft, paused" is hover-only, so make it an InfoTip.
- `agents/settings/BuiltInCard.tsx:90` and `agents/BuiltInSetup.tsx:126` (+`:45`): a built-in's `shortPurpose` from the server shown as card or dialog description. It's content, so not listed. Could go in `info` if built-in cards should match the rest.
- `runs/RunInput.tsx:135` and `runs/RunModal.tsx:754`: short captions after a header ("· what Paperclip did before and after the run"). Marked Move; keeping them is defensible because they're one line and act as sub-labels.
- Menu option descriptions (`Menu.Item description=`) are all Keep: a tip can't sit inside a menu item, and they tell the options apart. `AgentHeader.tsx:194` "Starts a run now" is the one Remove, since it repeats its label.

#### Chat endpoints; Chat; Status cards

- **Option descriptions in radio/choice cards** (`apps/chat/ChatConnect.tsx:96,105,359,368,376`, `status-cards/CardSettings.tsx:36–38`, `apps/chat/EmailSetup.tsx:321`): marked Move per the rule. They're short and help pick, so Keep is the alternative; if moved, use one tip per option, not one for the group. `ChatConnect` PurposeChoice is the whole page: there I'd lean Keep.
- **Menu.Item descriptions** (all of `chat/ChatComposer.tsx`, `status-cards/AgentPicker.tsx:49`, `CardTile.tsx:83`, `CardPanel.tsx:133–142`): Keep. That's what the converted examples do (`SecretVaults.tsx:244–261`), and a menu can't hold an "i" button.
- **Setup steps** (`.ch-howto` and the instruction paragraphs in ChatConnect, SlackSetup, the Try and Verify steps): Keep. They're instructions to act on now, not descriptions. Only the "why" parts split out.
- `apps/chat/ChatEndpointPage.tsx:689`: once the text moves, the "Private voice access" card has nothing left in it. Either keep the text visible (it's the card's only content) or drop the card and put the tip on the Access tab. I recommend keeping it visible.
- `apps/chat/ChatEndpointPage.tsx:802` (Guests) and `ChatComposer.tsx:430`: kept as consequence/security text. Moving the Guests text to a tip is defensible if the tip is placed right on the switch.
- `apps/chat/ChatEndpointPage.tsx:348`: the Slack invite hint fits better as the second half of the "No channels yet." empty state (visible only while the list is empty), with a tip otherwise.
- `apps/chat/ChatConnect.tsx:321`: "It stays the same" is close to a must-see constraint. Moved, because the label already makes it a one-off choice. Keep is the alternative.
- `status-cards/StatusPage.tsx:246`: a `title=` on the Restore button holds text found nowhere else ("Restoring runs an update at once"). That's a cost consequence, so it should be visible near the button or behind an InfoTip. A bare `title` doesn't open on tap.
- `chat/ChatView.tsx:105,124`: `title=` on the Plan and New session buttons ("Same as typing /new"). Hover-only, but it only repeats other text, so it's fine (decision H).
- `apps/chat/TaskDefaults.tsx:378`: Rewrite. The old UI says "allowed by the agent's execution policy" (`ui/src/pages/apps/chat/ChatExecutionDefaults.tsx:103`). Both versions suggest a refusal, but a low-trust agent is quietly switched to an isolated checkout.
- `apps/chat/ChatRoutes.tsx:184` and `status-cards/StatusPage.tsx:134` point admins to flags. The redesign is dropping flag toggles, so these may change once flags are settled.

#### Connections/apps

- `apps/Connect.tsx:404`: `whenToUse` comes from the gallery's method definitions (data), but it is shown as a radio option's description. Recommend moving it to `ChoiceCard info=`, like the own-server sign-in options already do.
- `apps/Connect.tsx:418`: `guidanceMd` is per-app Markdown that may hold links. Recommend leaving it visible.
- `apps/AppDetail.tsx:860`: the Disconnect card's warning is destructive, but the confirm dialog (`:878`) repeats it. Moving it is safe; keeping it is also fine.
- `apps/TestCall.tsx:105`: kept visible because the test runs the real action with the agent's credentials. It could move if the Run button said "Run it for real".
- `apps/identities/Identities.tsx:268`: kept as a security note ("any work they do"). Could move under an InfoTip beside "Agents that may act as you" if the label is felt to be enough.
- `apps/identities/Identities.tsx:146`: the row detail explains the account; kept, but it could be cut to "Just me".
- `apps/assistant/AssistantConnection.tsx:142`: `AUTHORIZATION_HANDOFF` is long and mostly speaks to the assistant, not the person. Recommend a tip, or dropping it from the board page since the invitation carries it.
- `apps/advanced/Profiles.tsx:158`, `ProfileWizard.tsx:235`: template descriptions sit inside link and button tiles, where an InfoTip can't go. Kept as the tile's content.
- `apps/advanced/ProfileDetail.tsx:308`: option bodies repeat their titles, so Remove. If kept, they'd need a radio card with `info`.
- `apps/gateways/GatewayDetail.tsx:361`: the run-token claim (one-hour token per run, revoked at run end) is plausible (`server/src/services/tool-gateway.ts:286`, `MAX_SESSION_TTL_MS` = 1 h) but not traced end to end.
- `apps/Connect.tsx:662` (`MACHINE_TIP`, already in a tip): "For connections shared with the organization, which this one is." reads oddly. Suspect only, not verified.
- `connectors/ConnectionSetup.tsx:183`: the "authenticated, public deployment" warning (kept) is accurate, but sign-in is also allowed there when a trusted runtime host is set (`server/src/services/local-ai-login-policy.ts:4-12`). Minor.

#### Company and app settings; Plugins; Profile and sign-in; Onboarding

- **Menu.Item descriptions** (Members roles, audiences, LimitMenu, EnvVarsEditor, environment and secret actions, harness and plugin menus): I kept these visible. They show only while the menu is open, when the person is choosing, and menus have no `info` slot. I still rewrote the inaccurate ones (roles, Suspend, Pause, Required).
- **Description of the selected option** (ImportCard:404, GatewaySetup:143/169, AgentOnboarding:683, EnvironmentDialog:393): kept as current-state text. InboxTidyCard:89 is marked Remove because each line only repeats its label.
- `settings/company/GeneralSection.tsx:113`: "in agents' instructions" is a suspect claim. I found no server code that puts the company name into run instructions. I'd drop the clause unless someone confirms it.
- `settings/company/GeneralSection.tsx:224` (Hiring): the Rewrite rests on the approve route checking only company write access. A check inside `approvalService.approve` could have been missed, so verify before changing the text.
- `settings/company/GeneralSection.tsx:35-36`: the file's header comment repeats the wrong meaning of "default owner". Fix it together with row :166 (it isn't UI text).
- `settings/company/GeneralSection.tsx:269`: the Agent requests table's "Example" column is table content, not help. Left as is.
- `settings/company/MembersSection.tsx:319`: Invites "Anyone with the link can join…" stays visible as a security note. It could move to a tip if the coordinator reads it as general guidance.
- `settings/company/PluginSection.tsx:22`: the plugin page intro is provenance (which plugin and version). It is a tip candidate, but could also stay visible.
- `auth/AuthForm.tsx:69`: the sign-up password-length rule stays visible. Hiding it would mean people only learn it from the error.
- Auth and onboarding Standalone ledes: kept on the consent and setup pages, where the lede is what the person is deciding. Only McpConnect:350 (the connections list) moves.
- `settings/app/AccountSection.tsx:189` LaterNote and `settings/company/EnvironmentsSection.tsx:225` OutlineCard ("On hold (decision 39, D7)") are development placeholders, not help. Kept here; they could go in a separate cleanup.
- `settings/app/HarnessesSection.tsx:166`: the card title "Installed from npm" disagrees with its description ("from npm or a folder on the server"). Consider "Installed packages".
- **SchemaForm**: plugin-authored `schema.description` (SchemaForm.tsx:125, 143, 226, 254, 303) is content from data, so not listed. It still works as field help, though. I recommend that `Labelled`, `Toggle` and the array and object headers render it behind `info`.
- `settings/company/EnvVarsEditor.tsx:67`: the claim that a text value is "Shown here and in run logs" wasn't verified. Run logs may redact values.

#### Activity/costs; Shell/nav; Others

- `activity/CostExtras.tsx:408`: the six reason texts explain each run's state, but they're generic and repeat on every row. A tip beside each reason pill keeps the list scannable. Keeping them visible is defensible because they say what to do; my pick is Move.
- `activity/CostExtras.tsx:106` and `activity/CostReports.tsx:69`: these are `title=` hover-only texts. The first is an error (it should become visible), the second an explanation (it should become an InfoTip). Both break decision H as they are.
- `activity/CostExtras.tsx:280`: show "doesn't cancel… with the provider" only while Counting is set to "The subscription ended". It's a must-see warning at that moment and noise otherwise.
- `activity/CostExtras.tsx:291`: linking has no undo in the API, so "can't be undone" should stay visible. The current text doesn't say it.
- `activity/ActivityLog.tsx:270`, `CostExtras.tsx:186`, `CostReports.tsx:128,181,360`: these `.org-foot` lines have no header to sit beside. Pick one anchor per view: the Costs sub-tab bar or the card's `org-card-row` header, and the Log toolbar.
- The "Reads and housekeeping" switch (`activity/ActivityLog.tsx:196`) has no text today. It would benefit from a tip: "Shows reads and routine housekeeping entries, hidden by default."
- Column legends "Spend · tokens" (`Costs.tsx:206,227`), "Runs · tokens in / out · spend" (`CostReports.tsx:92`) and "Net · debits · credits" (`CostReports.tsx:467,500`) are kept as legends and not listed.
- `layout/Nav.tsx:190,574`: Remove rather than Move, since menus can't hold a tip (see Menu above). Keeping "Takes it out of your nav" (`:522`) is the exception because it's a consequence.
- `layout/SettingsNav.tsx:134`: either Move it to the Features card's tip or Remove it once the old UI is gone. It only helps people coming from the old UI.
- `layout/TasksSheet.tsx:251,260,270`: phone link-row subtitles work as wayfinding, and a tip button can't sit inside an `<a>` row. Keep them visible; only `:260` is wrong.
- `routes/SignIn.tsx:62`: the "No email confirmation" tip needs a tip slot on `auth/Standalone.tsx` (the auth agent's file).
- `shell/CommandPalette.tsx:321`: the key legend is standard palette UI. Keep it.

## 4. Proposed split for the change phase

**Step 0: shared components, one agent, lands first.** Everything in the
[shared-component table](#shared-component-changes) marked as a change: `info` on `ui/Dialog.tsx`
and `ui/Switch.tsx`; `InfoHeading` in `ui/Field.tsx`; `ChoiceCard` moved to `ui/`; `info` on
`agents/shared.tsx` `SectionTitle` and `SwitchRow` (with `help` optional), on the app settings
copies in `settings/app/shared.tsx`, on `settings/company/shared.tsx` `CardHead`, on
`apps/chat/parts.tsx` `Card` and on `auth/Standalone.tsx`; `CardNote` reduced to save status
(`projects/settings/shared.tsx`); recurring's `InfoTip` turned into a wrapper over `ui/InfoTip`.
Tests for each prop (the existing `InfoTip.test.tsx` and `Dialog.test.tsx` are the pattern), a
phone check that a tip inside a Switch or a dialog title opens on tap without toggling or closing.
No text moves in step 0, so every later agent starts from the same components. About a day's work.

**Step 1: four or five area agents in parallel**, each on its own files, each moving text, applying
rewrites and checking phones (tap to open). Rows to change are every row but Keep.

| Agent | Areas (folders under `ui-new/src/`) | Rows | To change |
| --- | --- | --- | --- |
| 1. Agents | Agents (`agents/`, `runs/`, `org/`) and Onboarding (`onboarding/`; it shares `runnerHelp` in `agents/new/new-agent-model.ts` and the environment menu) | 234 | 138 |
| 2. Connections | Connections/apps (`apps/` except `apps/chat/`, `connectors/`), Plugins (`plugins/`), Profile and sign-in (`profile/`, `auth/`) | 167 | 113 |
| 3. Chat, activity and shell | Chat endpoints (`apps/chat/`), Chat (`chat/`), Status cards (`status-cards/`), Activity/costs (`activity/`), Shell/nav (`layout/`, `shell/`, `routes/`), Others (`lib/session.tsx`) | 180 | 111 |
| 4. Settings | Company settings (`settings/company/`, `settings/*.tsx`) and App/instance settings (`settings/app/`) | 142 | 99 |
| 5. Work | Projects (`projects/`, `workspaces/`), Skills (`skills/`), Recurring (`recurring/`), Tasks (`tasks/`, `cases/`, `documents/`, `files/`, `search/`, `workload/`), Inbox and requests (`inbox/`, `requests/`, `approvals/`) | 249 | 115 |

Agents 4 and 2 are the lightest; with four agents, merge them (212 to change), or move Onboarding
from 1 to 4.

Files more than one area touches, and who owns them:

- `layout/SettingsNav.tsx:134` points at the Features card: agent 3 removes the note, agent 4 adds
  the matching tip to `settings/app/FeaturesCard.tsx`.
- The "Required" personal-secret wording appears in `agents/settings/SecretsSection.tsx:180`
  (agent 1), `settings/company/EnvVarsEditor.tsx:120` (agent 4) and
  `projects/settings/EnvironmentSection.tsx:179` (agent 5): use the same text in all three.
- Budget hard-stop wording appears in agent, project and company budgets and the bulk budget
  dialog (agents 1, 4, 5): use the same text.
- `routes/SignIn.tsx` (agent 3) needs the `auth/Standalone.tsx` `info` from step 0.
- The shared helpers from step 0 aren't edited again in step 1; a missing prop goes back to the
  coordinator.
- Each agent edits only its own areas' CSS files.

Each agent's brief should include this file's rules, the judgement calls, its area tables, and the
Gotchas in CLAUDE.md (worktrees start from `master`; reset onto `new-ui` first).

## Appendix A. Shared-component dependencies by area

Which rows in each area depend on a component change, as each area's auditor counted them. The [summary table](#shared-component-changes) totals them.

### Tasks; Inbox and requests

- **`Dialog description=`** (ui/Dialog.tsx renders `.dialog-desc` visibly; it has no `info`): 2 Move rows (`tasks/SavedViews.tsx:102`, `tasks/ShareSheet.tsx:111`), plus 3 Keep rows that would partly move if it had one (`cases/StartWorkflow.tsx:73`, `tasks/composer/RunnerGoal.tsx:281`, `tasks/FeedbackVotes.tsx:192`).
- **`Switch description=`** (ui/Switch.tsx renders `.switch-desc`; it has no `info`): 1 Move (`tasks/TaskEditors.tsx:448`), 1 Remove (`cases/NewTaskCase.tsx:77`).
- **`Field help=`** (Field already has `info`): 2 rows (`cases/StartWorkflow.tsx:98` Move, `tasks/composer/RunnerGoal.tsx:302` Split).
- **`Menu.Item` / `Menu.CheckboxItem description=`** (ui/Menu.tsx renders `.mi-desc`; it has no `info`): 27 rows (24 Keep, 3 Remove). Moving any of them needs a Menu design that can hold a tip.
- **A second, hover-only InfoTip:** `recurring/RepeatMenu.tsx:207` exports its own `InfoTip` (`{ text, label }`, a Kobalte `Tooltip`), which opens on hover only and not on tap. It's used at `tasks/NewTaskDialog.tsx:697` and `cases/NewTaskCase.tsx:79`, `:117` and `:206`. Swap these for `ui/InfoTip.tsx` (decision H: phones have no hover). The same goes for `search/SearchControls.tsx:49` `TypedFiltersTip`, an "i" button on a hover-only `Tooltip`.
- **Popover notes (`.te-note`, `.cmp-who-note`, `.te-hint`), with no shared header:** 6 Move rows in `tasks/TaskEditors.tsx` (454, 553, 761), `tasks/TaskExecution.tsx` (129, 247) and `tasks/composer/Composer.tsx` (758). There's no title row to hang an "i" on, so each needs a small header with an InfoTip, or an `info` on `Popover.Content` (`label=` is only for accessibility; `title=` renders a visible title).
- **Custom section heads that aren't SettingsCards:**
  - `.td-section-head` / `.tsec` sections (TaskRuns, TaskWorkspace, TaskFiles FileGroup in `tasks/TaskFiles.tsx:~485`): 3 Split rows. `FileGroup` takes `title`/`count`/`empty`, so an `info` prop there would cover Outputs.
  - Case parts (`cases/CaseSection.tsx` `.tcase-part` heads): 2 rows.
  - Workload `.wl-head` / `.wl-lanes-head` with `.wl-sub`: 3 rows. A local section-head helper with `info` would fit.
  - Inbox `.ibx-bar` / `.ibx-fold`: 3 rows. `InboxPage` already uses `ui/InfoTip` beside `.ibx-note` for Snoozed/Archived (line 791), the pattern to copy.
  - Approvals `.apv-h` / `.apv-follow-row`: 2 rows.
  - `PageHeader` (ApprovalHistory): 1 row. It needs an `info` slot, or an InfoTip in `numbers`.
- **`TaskContext.tsx:226`**: the Compact now note comes from `tasks/context-usage.ts:73-76`. The "available" text needs to become tip text, not a visible note.

### Projects; Skills; Recurring

- **`Menu.Item description=` / `Menu.CheckboxItem description=`** (renders visible `.mi-desc`; no `info`): 21 rows. Projects: NewProjectDialog 367, 374; ProjectPhoneHeader 274; GoalsSection 374; EnvironmentSection 137, 179; BudgetSection 174, 177. Skills: SkillLibrary 141, 144, 147, 150, 154. Recurring: RecurringDetails 588, 591, 594, 599, 874, 1048, 1069; RecurringRuns 366. The fix is usually an `InfoTip` beside the trigger, not a Menu change.
- **`Dialog description=`** (renders visible `.dialog-desc`; Dialog has no `info`): 9 rows to move, split or remove: SkillActions 258, 512; SkillStudio 578, 624; SkillSources 308; SkillFolders 180; SkillImport 73, 252; SkillCatalog 371 (Split). A Dialog `info` prop (tip beside the title) would cover them.
- **`ui/Switch` `description=`** (renders visible `.switch-desc`; no `info`): 2 rows (SourceExtras 240, 241).
- **`Segmented` option help shown as `fhelp`** (no per-option info): 1 row (SkillActions 575, with `skill-settings-model.ts` `SHARING_OPTIONS.help`).
- **Radio choice cards** (`ps-choice` / `ps-choice-help`, local markup in AccessSection.tsx): 2 rows (81, 90). One `info` on the Visibility row would cover both.
- **`CardNote`** (`projects/settings/shared.tsx`): puts help text and save status together in a SettingsCard `description`. 3 rows (DetailsSection 65, AccessSection 69, EnvironmentSection 80) need the text moved to `info` and `description` reduced to `<SaveStatus>`, as CodeSection's `saveNote` does.
- **`SettingsRow help=` / `SettingsCard description=` / `Field help=`** (already have `info`): 30 rows, no component change.
- **Local helpers with no info slot**:
  - `Well` (`projects/ProjectDashboard.tsx:276`): title only. 2 rows (302, 372) need an `info` prop or an InfoTip in `aside`.
  - Section heads with a `cap` subtitle and no info: ProjectDashboard `pd-section-head` (267), ProjectDocs `pdocs-head` (137), NewProjectDialog `np-code-head` (448).
  - NewProjectDialog storage block (`np-storage`, 510): the label is a bare `cap` span.
  - `WorkspaceForm`'s `field()` helper (`projects/settings/CodeSection.tsx:602-608`): a label with only a placeholder. 2 rows (631, 632) need an `info` slot. The commands `fhelp` (641) sits under a disclosure button and needs an InfoTip next to it.
  - Archive danger rows (`ps-danger-row`, ArchiveSection.tsx): 1 row (66).
  - Skills page footers (`org-foot`, SkillCatalog 134, SkillLibrary 186) and toolbars (`act-toolbar` span: SkillStudio 56, SkillSources 56): page-level guidance with no header to attach a tip to. 4 rows; put an InfoTip beside the subnav or toolbar.
  - `sk-block-head` section heads (Safety check, SkillActions 625) and the `chead` intro (SkillStudio 130): 2 rows.
  - `org-card-row` header note (SourceExtras 420): 1 row.
  - `ConnectionField` (SourceExtras.tsx:580-596): its `help` default (589) should become `info`, with `help` kept for the error case (248).
- **Recurring's own `InfoTip`** (`recurring/RepeatMenu.tsx:207-217`): a hover-only `Tooltip` with an "i" button. It doesn't open on tap (decision H / InfoTip.tsx rule), and its text is the button's `aria-label`. Used 6 times (RepeatMenu 158; ConnectWebhook 150, 224; RecurringDetails 449, 840, 1082). Replace it with `ui/InfoTip` (`<InfoTip label=…>{text}</InfoTip>`); no text changes needed.

### Agents

- **`SectionTitle`** (`agents/shared.tsx:112`, the section intro paragraph, no `info`): 12 rows (one per agent settings section). Needs an `info` prop (title + InfoTip). It's re-exported to `settings/company/shared.tsx`, so company and app settings get it too.
- **`SwitchRow`** (`agents/shared.tsx:20`, `help` is *required* and renders as `.fhelp`, no `info`): 10 rows (Runtime ×5, Permissions ×3, Interactions ×1 for 11 switches, Profile ×1), plus harness toggles via `ExtraFieldRow` (`RuntimeSection.tsx:584`). Needs an optional `info`, with `help` made optional. Also re-exported to company settings. (`settings/app/shared.tsx:91` has its own `SwitchRow`, outside this area.)
- **`NumberRow`** (local, `RuntimeSection.tsx:700`): passes `help` to SettingsRow. 4 rows (Cooldown, Runs at once, Timeout, Grace period). Add an `info` pass-through.
- **`ExtraFieldRow`** (local, `RuntimeSection.tsx:578`): harness field hints (`harness-model.ts` `hint`) go to `help`. 1 row (all harness fields). Switch to `info`.
- **`TestEnvironment`** (local, `RuntimeSection.tsx:633`): idle hint in a `ps-muted-line` beside the button. 2 rows. An InfoTip beside the button.
- **`SettingsRow help=`** → `info` (already supported): ~43 rows across settings, New agent and BuiltInSetup.
- **`SettingsCard description=`** → `info` (already supported): ~19 rows. Split rows keep a short `description`.
- **`Dialog description=`** (no `info`; renders `.dialog-desc`): 2 rows (`OutsideAgentInvite.tsx:111` Move; `OrgAgents.tsx:600` Rewrite, best as an InfoTip beside the field label inside the dialog). `BulkEditDialog.tsx:202` is a Remove. The other dialog descriptions are Keep.
- **Custom `<header class="chead"><p>`** (not a SettingsCard): 1 row (`ToolsSection.tsx:347`).
- **`ag-note` block** (Memory): 1 row.
- **Hover-only `Tooltip` → `InfoTip`**: 1 row (`NewAgentPage.tsx:868`); `:832` is a Remove.
- **No shared component, plain InfoTip placement needed** beside a heading, footer or input: 15 rows. `InteractionsCard.tsx:54` (footer); `InstructionsSection.tsx:576` (popover input with no label); `BuiltInCard.tsx:139` (hand-rolled `frow ag-frow-switch`; could use `SwitchRow` once it takes `info`); `BuiltInSetup.tsx:144` (dialog body); runs ×5 (`RunActivity.tsx:313`, `RunInput.tsx:38`, `:135`, `RunTrace.tsx:113`, `RunModal.tsx:754`); org ×5 (`OrgAgents.tsx:351`, `:363`, `OrgChart.tsx:184`, `BulkEditDialog.tsx:324`, `:397`).

### Chat endpoints; Chat; Status cards

- **`Card` in `apps/chat/parts.tsx:110`** (local helper over `SettingsCard`): passes `description` but not `info`. Add `info` and pass it through. 24 rows depend on it (ChatEndpointPage 208, 229, 272, 346, 348, 349, 495, 546, 617, 689, 698, 699, 716, 822, 891; GitHubBot 229, 277, 394, 613, 635, 657, 674; SlackSetup 482; TaskDefaults 378 lands in the Task defaults card's `info`).
- **`Switch` (`ui/Switch.tsx`, imported as `Toggle`)**: has `description` (rendered visibly as `.switch-desc`) but no `info`. 13 rows: ChatEndpointPage 429, 437, 446, 588, 802; GitHubBot 328, 429, 454, 523, 529, 618, 647; CardSettings 196. 11 of these Move or Split.
- **`Field help=`** (Field already has `info`): 13 rows, just a prop change. ChatConnect 321; GitHubSetup 256; EmailSetup 321; GitHubBot 474, 496, 511; CardSettings 107, 110, 113; NewCardDialog 119; plus 182, 219 and 803, which stay. **`ListField` in `apps/chat/GitHubBot.tsx:358`** (local helper) takes `help` and passes it to `Field help`. It needs an `info` prop: 7 rows (457–462, 494).
- **`Dialog description=`** (`ui/Dialog.tsx`, no `info`): 4 rows. GitHubBot 762 (Move), SlackSetup 403 (Split), NewCardDialog 81 (Move; can go to the prompt Field's `info` instead), and ChatEndpointPage 1190, which stays. Without a Dialog `info` prop, 2 rows need an InfoTip in the title.
- **Custom headers that aren't SettingsCards** (`.ap-connect-head` / `.ap-connect-title p`): ChatConnect 87, 156; EmailSetup 168, which needs an InfoTip beside the `h2`. **`h4.ch-subhead`** in SlackSetup 510 needs an inline InfoTip. **`.ch-side-head`/`.ch-now`** in ChatActivity 179 and the **`.ch-empty`** block in ChatView 399 need an inline InfoTip.
- **Local choice components**: `.ch-choice` buttons (ChatConnect `PurposeChoice`, 2 rows), `.cx-option` radios with `.cx-row-meta` (ChatConnect Slack method, 3 rows), `.sc-option` radios (CardSettings `MODES`, 3 rows), and a `Segmented` with its explanation in `Field help` (EmailSetup 321, 1 row). An InfoTip inside a `<label>` is safe (it swallows the click), but a `.ch-choice` is itself a `<button>`/`<A>`, so a tip would be nested inside an interactive element. That one needs restructuring or should stay Keep.
- **Inline `.cx-note`/`.cx-static`/`.cap` paragraphs** inside card bodies (ChatEndpointPage 453, 724, 1098; GitHubBot 297, 416, 464; SlackSetup 259; PhotonConnect 50, 119; GitHubSetup 230, 345; ChatConnect 607; CardPanel 444; CardSettings 222, 246; ChatComposer 403): each needs a hand-placed `<InfoTip>`. There's no shared slot. For `<details>` summaries (GitHubBot 416, 464; ChatEndpointPage 724), the tip goes in the `<summary>`. That works, since InfoTip swallows its click.
- **`Tooltip`** in `status-cards/CardSettings.tsx:230`: replace it with an InfoTip (1 row).
- Text kept in `apps/chat/chat-model.ts` (`LIFECYCLE_GUIDANCE`, `resolutionText`) and `apps/chat/github-model.ts` (`repositoryNote`): only `LIFECYCLE_GUIDANCE.reconnect` moves (1 row). The data stays where it is.

### Connections/apps

- `Field help=` → Field already has `info`: 20 rows (Connect 426/445/459, ConnectionSetup 169/204/278, PasteConfig 119, ProfileDetail 489, ProfileWizard 264, Gateways 232, GatewayDetail 379, SetupExtras 112/156, AggregatorConnect 98/148/152, AggregatorAccounts 151/154/199, AppExtras 243). Four are Splits that keep state or disabled text in `help` (ConnectionSetup 204, Gateways 232, SetupExtras 112, AppExtras 243).
- `SettingsCard description=` / `SettingsRow help=` → already have `info`: 11 rows (AppDetail 368/785/796, TestCall 257/325/378, GatewayDetail 217/227, Pools 388/440/450).
- `Card description=` (`apps/chat/parts.tsx:110`, wraps SettingsCard but drops `info`): 5 rows (Identities 96, AggregatorAccounts 52, AppExtras 138/191/281). Needs an `info` pass-through on `Card`.
- `Switch` `description=` (`ui/Switch.tsx:16`, renders `.switch-desc`, no `info`): 9 rows, 8 to convert (shared.tsx 162 default, Connect 553/730, AggregatorConnect 196 via `AgentAccessPicker allDescription`; ConnectionSetup 234; Pools 396/447; AppExtras 62; SetupExtras 167 kept). Needs an `info` prop on Switch, and `AgentAccessPicker` to pass `allInfo` alongside `allDescription` (description kept for the manager-only reason).
- `Dialog description=` (`ui/Dialog.tsx:36`, `.dialog-desc`, no `info`): 10 rows, 6 to convert (ConnectionSetup 59; Profiles 281; ProfileDetail 374; Gateways 199; GatewayDetail 587; CatalogRows 349). Kept: TestCall 105, ConnectionSetup 61. Removed: ConnectionSetup 62, Gateways 198. Needs an `info` prop on Dialog, beside the title.
- Custom `<header class="chead">` / `ap-chead` intros (not SettingsCard): 28 rows, 26 to convert (GatewayDetail 711 and Pools 522 stay) (AiConnections 83; Browse 93/242; Review 31; AppDetail 232/445/563/860; PasteConfig 108/159/318; Profiles 120; ProfileDetail 213/297; ProfileWizard 226/416/569/669; Assistant 78/168; Gateways 94; GatewayDetail 160/248/361/711; Pools 103/495/522). Each needs an `info-line` + InfoTip in the h3, as TailscalePage.tsx:52 does; a small shared `CardHead` helper would help.
- `ap-connect-head` page intros (Connect/Vercel/aggregator header `<p>`): 2 rows (Connect 253, AggregatorConnect 125). Same InfoTip-in-h2 pattern as `ByoConnect` (Connect.tsx:817).
- Radio/choice option descriptions: 3 rows. Connect 404 (`cx-option ap-method`) and SetupExtras 127 (`IdentityPicker`) can switch to the existing `ChoiceCard` (`apps/shared.tsx:63`, has `info`); `NewToolsChoice` (`apps/advanced/ProfileDetail.tsx:302`, local `tl-radio` helper, 1 row, Remove).
- Group-title notes (`<h4 class="ap-group-title">…<span>`): 3 rows (Browse 123 via local `ConnectionGroup note=` in Browse.tsx:163; Profiles 175; CatalogRows 94). Need an InfoTip in the h4.
- `PageHeader numbers` muted note: 1 row (ProfileWizard 205, Remove), so no PageHeader change needed.
- Raw `<label class="field-stack">` + `.fhelp` (not Field): 2 rows (TestCall 288/297). Convert to `Field` with `info`, or add InfoTip by hand.
- Free-standing `cx-note` / `cx-static` / `.fhelp` paragraphs: Connect 433; TestCall 260/384; ConnectionSetup 266/424; ProfileWizard 676/709; Assistant 117/142; Identities 363; AggregatorAccounts 150; CatalogRows 166/298; AiConnections 324. Need InfoTip beside the nearest label or heading.

### Company and app settings; Plugins; Profile and sign-in; Onboarding

- **`SectionTitle`** (agents/shared.tsx:112; company settings import it from settings/company/shared.tsx): its children render as a visible `<p>` and it has no `info`. 9 rows: CompanySettingsPage:72, General:54, Members:93, Connections:47, Budgets:63, Environments:116, Transfer:36, PluginSection:22, :37.
- **App `SectionTitle`** (settings/app/shared.tsx:79): same issue, no `info`. 6 rows: Account:74, General:57, Admins:62, Organizations:112, Harnesses:125, Plugins:103.
- **`CardHead`** (settings/company/shared.tsx:64): its `note` renders as a visible `<p>` in a custom `<header class="chead">`, and it has no `info`. 9 rows (7 to convert): General:251, Members:319 (Keep), :413, Connections:142, Telemetry:124, Budgets:336, Transfer:93, Import:298, PluginSection:39 (Remove).
- **`SwitchRow`, agents version** (agents/shared.tsx:20, used through company/shared.tsx): `help` is required and renders as `.fhelp`, with no `info`. 11 rows: General:62, :224; Connections:165, :168, :292, :307, :418; Telemetry:243; Transfer:94, :95; Import:431.
- **`SwitchRow`, app version** (settings/app/shared.tsx:91): `help` only, no `info`. 1 row: General:107.
- **Card footer** `<footer class="cfoot cs-muted">` (raw markup): 2 rows to move into the card's tip, General:315 and Members:255. Both need `CardHead` or `SettingsCard` `info`.
- **`CardNoteLine`** (settings/company/shared.tsx:83), used for help: 1 row, Environments:128 (needs `CardHead` `info`).
- **`Dialog description=`** (ui/Dialog.tsx, renders `.dialog-desc`; no `info`): 7 rows: ConnectionPicker:147 (can use the API key Field's `info` instead), EnvironmentDialog:206, SecretVaults:643, SecretDetails:582 (Split), Admins:183, Organizations:178 (can use the Name Field's `info`), GatewaySetup:38.
- **`Switch description=`** (ui/Switch.tsx, renders `.switch-desc`; no `info`): 3 rows to move, EnvironmentDialog:379, :436 and SecretVaults:469. EnvironmentDialog:393 and SecretVaults:478 stay visible.
- **`Menu.Item` / `Menu.CheckboxItem` `description=`** (ui/Menu.tsx, `.mi-desc`): 19 rows, all kept or rewritten in place. No change needed unless the coordinator decides menu descriptions should go behind tips.
- **`PageHeader numbers`**: 1 row, AppSettingsPage:61.
- **`Standalone lede`** (auth/Standalone.tsx:24, no `info`): 1 row to move, McpConnect:350.
- **`SettingsRow help=`, `SettingsCard description=`, `Field help=`**: `info` already exists, so no shared change. That covers most of the rest: company General, Connections, Telemetry, Budgets, EnvironmentDialog, Import and Transfer rows; app Account, General, InboxTidy, Admins, Harnesses and Plugins cards; plugins PluginLocalFolders and PluginStatus; Onboarding rows.
- **Local helpers that render help:**
  - `FeatureRow` (settings/app/FeaturesCard.tsx:89): `flag.help` as `.fhelp`, about 30 flags in 1 row (FeaturesCard:104).
  - `Usage` (profile/ProfilePage.tsx:325): its `note` renders as `<p class="cap">`. 2 rows (ProfilePage:123, :134).
  - `Row` in SecretDetails.tsx: its `sec-sub` sub-line. 1 row (SecretDetails:206).
  - `Labelled` (plugins/SchemaForm.tsx:210): `description` as `.fhelp`. 1 row (SchemaForm:138), plus the plugin schema descriptions under judgement calls.
  - EnvironmentDialog raw `field-stack` + `.fhelp` (Private key :372, Environment variables :445): needs an inline `InfoTip` on the label span. 2 rows.
  - ConnectionsSection:438: a raw `.fhelp` inside a `SettingsRow`. Move it to that row's `info`.
  - `runnerHelp` (agents/new/new-agent-model.ts:216): shared with New agent, so the Split at AgentOnboarding:729 also affects agents/new. Coordinate with that area.

### Activity/costs; Shell/nav; Others

- **`Dialog description=`** (Dialog has no `info`): 1 row (`activity/CostExtras.tsx:126`).
- **`Field help=`** (Field already has `info`): 1 row (`activity/CostExtras.tsx:291`).
- **`Menu.Item description=`** (`.mi-desc`, no `info`, none advised): 3 rows (`layout/Nav.tsx:190,522,574`). 2 are Remove, 1 Keep.
- **`Switch description=`** (`.switch-desc`, no `info`): 1 row (`layout/TasksSheet.tsx:239`, Keep, no change needed).
- **`auth/Standalone.tsx` `lede`** (`.stand-lede`, no `info`): 2 rows (`routes/SignIn.tsx:62`).
- **Custom card headers, not SettingsCard** (`<div class="org-card-row"><h2>…</h2><span class="org-muted org-push">…`): 1 row (`CostReports.tsx:531`). The `.org-foot` lines need the same kind of header anchor: 5 rows (`ActivityLog.tsx:270`, `CostExtras.tsx:186`, `CostReports.tsx:128,181,360`).
- **KPI tiles** (`.org-kpi` label plus `.org-kpi-note`; the tip goes beside `.org-kpi-label`): 1 row (`CostReports.tsx:592`).
- **Inline tips beside a pill or badge** (TonePill in `QualityNotice`, `Amount`'s estimate badge in `CostReports.tsx`): 2 rows (`CostExtras.tsx:408`, `CostReports.tsx:69`).
- **Empty-state splits inside `.org-empty` / `.org-muted` paragraphs** (the tip goes beside the visible empty line or on the card header): 4 rows (`Commentary.tsx:111`, `CostExtras.tsx:134`, `CostReports.tsx:535,632`).
- **Local helpers that render help:** `QualityNotice` (`activity/CostExtras.tsx:320`, reason descriptions), `Amount` (`activity/CostReports.tsx:63`, estimate `title`), `SettingsTitle` (`layout/SettingsNav.tsx:159`, title note), and `PlannedNote` (`routes/Planned.tsx:13`; the only remaining user, `Project.tsx:236`, shows state).

### How the ui/ components render text (from the Shell/nav audit)

None of `ui/*.tsx` carries its own help or hint copy. The only built-in strings are labels and state: the InfoTip name fallback "About this setting" (`ui/Field.tsx:20`), provider-failure titles and facts (`ui/provider-failure.ts:17-74`), and status labels (`ui/status-meta.ts`). How each one renders descriptions:

- **Dialog** (`ui/Dialog.tsx:36,104-106`): `description` renders visibly under the title as `KDialog.Description.dialog-desc`, which is also the dialog's `aria-describedby`. It has no `info` prop. **Needs one**: an InfoTip beside `.dialog-title` in `.dialog-head`, with `description` kept for state. In this area 1 row depends on it (`CostExtras.tsx:126`). DevBanners:128 and Commentary:183 (the sent date) stay in `description`.
- **Menu** (`ui/Menu.tsx:84-108`): `Menu.Item description` renders as a second line, `KMenu.ItemDescription.mi-desc`, and makes the item 44px tall. `hint` is a trailing `<small class="mi-hint">` (a shortcut, a count or a tick). **No `info` prop advised**: a tip button inside a menuitem would fight item selection, and on phones the menu is a sheet. A description stays (a consequence) or goes (Remove). 3 rows here (`Nav.tsx:190,522,574`).
- **Segmented** (`ui/Segmented.tsx:14-21`): options are `{value, label, icon}`, with no description field. An icon-only segment gets `title`/`aria-label` set to its label, which repeats the label, so that's fine. **No `info` needed** on the control. A caller that needs to explain the choice puts an InfoTip beside its own label. 0 rows here.
- **PageHeader** (`ui/PageHeader.tsx:83-136`): there is no description prop. `numbers` holds the key numbers plus a muted note (`.ph-numbers`), and `children` render under them inside `.ph-text`, so intro text would arrive as children. `titleAside` ("Next to the title, such as a star button") can already hold an `<InfoTip>` without a component change. An `info` prop would only be a convenience. 0 rows here.
- **ConfirmDialog** (`documents/ConfirmDialog.tsx:10-48`, used in 24 files): `body` renders as `<p class="confirm-body">` in the dialog body, with no `description`. The body is the consequence of a destructive action, so it stays visible. **No `info` needed.**
- **Switch** (`ui/Switch.tsx:16,27-29`): `description` renders visibly as `KSwitch.Description.switch-desc`, with no `info` prop. 1 row here (`TasksSheet.tsx:239`, Keep). Other areas may need `info` added.
- **Field / SettingsCard / SettingsRow** (`ui/Field.tsx:71-170`): these already take `info`. `help` renders as `.fhelp` and `description` as `<p>` in the card header. 1 row here (`CostExtras.tsx:291`, Field `help` → `info` + shorter `help`).

## Appendix B. Files checked with no help text

**Tasks; Inbox and requests:** tasks/integrations/TaskIntegrations.tsx, tasks/composer/PendingComments.tsx, tasks/LiveRunStatus.tsx, tasks/CopyMessage.tsx, tasks/PersonPicker.tsx, tasks/PendingTasks.tsx, tasks/TaskParentCrumb.tsx, tasks/TaskPicker.tsx, tasks/ListSearch.tsx, tasks/ExternalObjects.tsx, tasks/TaskPanel.tsx, tasks/NewLabelDialog.tsx, tasks/UsageLimit.tsx, tasks/PlanDecompositions.tsx, tasks/people.tsx, tasks/TaskAbout.tsx, tasks/composer/file-drop.tsx, tasks/ToolCallProgress.tsx, tasks/pickers.tsx, tasks/TaskModal.tsx, tasks/MessageBody.tsx, tasks/TaskSections.tsx, tasks/composer/MentionTextArea.tsx, tasks/LinkPreview.tsx, tasks/retry.tsx, tasks/integrations/BrowserViewer.tsx, tasks/composer/QueuedMessages.tsx, tasks/integrations/ChatBinding.tsx, tasks/BoardView.tsx, tasks/TaskNotices.tsx (state notices only), tasks/TaskActivity.tsx, tasks/TaskDetails.tsx, cases/CaseChip.tsx, cases/CaseListParts.tsx, cases/CaseGroupHead.tsx, documents/SourceTrustBadge.tsx, documents/ConfirmDialog.tsx, documents/ImageGallery.tsx, documents/MarkdownEditor.tsx, files/CodeView.tsx, files/FilePreview.tsx, search/SearchRow.tsx, workload/CompanyWorkload.tsx, inbox/InboxTasks.tsx, inbox/InboxRouting.tsx (help already in an InfoTip), inbox/InboxHistory.tsx, inbox/InboxRow.tsx, requests/WithdrawDialog.tsx, requests/card-parts.tsx, requests/QuestionSetForm.tsx (helpText is data), requests/DecisionControls.tsx (state and warnings only)

**Projects; Skills; Recurring:** projects/settings/ProjectSettings.tsx, projects/settings/shared.tsx (only the `CardNote` helper, under Shared components), workspaces/WorkspaceOperations.tsx, skills/SkillsPage.tsx, skills/SkillUpdateDiff.tsx, recurring/RecurringHistory.tsx, recurring/ShowSwitch.tsx, recurring/RoutineRedirect.tsx, recurring/RepeatMenu.tsx (its only help is already in tips; see Shared components)

**Agents:** agents/AgentPage.tsx, agents/AgentStar.tsx, agents/shared.tsx (helpers only; `OutlineCard`'s "Coming next" text isn't used in this area), runs/RunRoute.tsx, runs/QueueWait.tsx, runs/RunFind.tsx, runs/RunRawOutput.tsx, runs/RunRequest.tsx, org/OrgHeader.tsx, org/OrgDashboard.tsx

**Chat endpoints; Chat; Status cards:** `apps/chat/parts.tsx` (renders others' text only; the `CopyValue` "Not available yet." fallback is state), `chat/ChatDocuments.tsx`, `chat/ChatPlanDock.tsx`, `chat/ChatRedirect.tsx`, `chat/LiveReply.tsx` (MCP health warning and status lines are state), `chat/chat-read.tsx`. (`status-cards/CardTile.tsx` and `AgentPicker.tsx` have only one Menu.Item row each; the rest is state.)

**Connections/apps:** apps/AppsPage.tsx, apps/ResumeAiLogin.tsx, apps/MachineSignIn.tsx (already converted; only state left), apps/advanced/MoreApps.tsx, apps/advanced/parts.tsx, apps/gateways/Activity.tsx, apps/tailscale/TailscalePage.tsx (already converted; one Keep row)

**Company and app settings; Plugins; Profile and sign-in; Onboarding:** settings/OwnerMenu.tsx, settings/SettingsBody.tsx, settings/company/shared.tsx, settings/company/MySecrets.tsx, settings/company/NewSecretDialog.tsx, settings/company/SecretRequests.tsx (all three are already converted), settings/app/shared.tsx (helpers only, listed above), plugins/CommentPlugins.tsx, plugins/DashboardPlugins.tsx, plugins/NavPlugins.tsx, plugins/PluginConfigForm.tsx (already uses `info`), plugins/PluginLaunchers.tsx, plugins/PluginPage.tsx, plugins/PluginSlot.tsx, plugins/ShellPlugins.tsx, plugins/TaskPlugins.tsx, plugins/WorkspacePlugins.tsx, auth/OAuthHandoff.tsx, auth/Standalone.tsx, onboarding/OnboardingFrame.tsx. plugins/react has no .tsx files.

**Activity/costs; Shell/nav; Others:** activity/ActivityPage.tsx, activity/redirects.tsx, activity/PickMenu.tsx, layout/Shell.tsx, layout/PhoneDock.tsx, layout/Panel.tsx, layout/NavRail.tsx, layout/dock-icons.tsx, layout/nav-prefs.tsx, shell/Announcements.tsx, shell/ServerInfo.tsx, shell/ShortcutsDialog.tsx, shell/pwa.tsx, routes/Planned.tsx, routes/Project.tsx, routes/Projects.tsx, routes/Splash.tsx, routes/Tasks.tsx, routes/StyleGuide.tsx (a dev page, skipped), App.tsx, index.tsx, lib/commands.tsx, lib/company.tsx, lib/live-events.tsx, lib/offline/SyncBanner.tsx, lib/offline/WriteQueueProvider.tsx, lib/offline/WriteStatus.tsx, styles/base.css, styles/fonts.css, styles/tokens.css, ui/Avatar.tsx, ui/Button.tsx, ui/Dialog.tsx, ui/Field.tsx, ui/Grain.tsx, ui/InfoTip.tsx, ui/Markdown.tsx, ui/Menu.tsx, ui/PageHeader.tsx, ui/Popover.tsx, ui/ProviderFailureNotice.tsx, ui/ScrollCapsule.tsx, ui/ScrollList.tsx, ui/Segmented.tsx, ui/Status.tsx, ui/Switch.tsx, ui/ThemeScope.tsx, ui/Toast.tsx, ui/Tooltip.tsx, ui/layer.tsx. Every directory in `ls ui-new/src` is covered here or in another agent's list. `api/` has no `.tsx` files, and `test/` was skipped.
