# Agents

Tier 1 (redesign). Agents are the AI workers: each has an identity and role, a harness (adapter) and
model, instructions, skills and tools, permissions, and a run history. People hire agents, assign them
tasks, chat with them, and pause or retire them.

Source of truth for requests: [generated/pages.md](../generated/pages.md) sections for `Agents`,
`AgentDetail`, `NewAgent`, `AgentChats`, `AgentChat`, and **App shell** (sidebar agents list, primary
agent, chat navigation, configuration form). Upstream recipes: `maps/feature-map/agents.md`,
`agent-chat.md`, `runs-adapters.md`, `teams.md`.

## Pages

| Page | Routes | What it is |
| --- | --- | --- |
| Agents roster (`pages/Agents.tsx`) | `/:co/agents/:tab` (`all`, `active`, `paused`, `error`, `builtin`) | All agents as a list or org chart. |
| Agent detail (`pages/AgentDetail.tsx`) | `/:co/agents/:agentId`, `/:co/agents/:agentId/:tab`, `/:co/agents/:agentId/runs/:runId` | One agent: overview, configuration sections, run detail. |
| New agent (`pages/NewAgent.tsx` → `components/new-agent/NewAgentSetup.tsx`) | `/:co/agents/new` | Hiring flow. |
| Agent chats (`pages/AgentChats.tsx`) | `/:co/chats` | Pick an agent to chat with. |
| Agent chat (`pages/AgentChat.tsx`) | `/:co/chats/:agentRef` | A conversation with one agent. |

Agent detail navigation (streamlined shell), from `pages/agent-detail-navigation.ts`:

- **Agent:** Overview, Instructions, Skills
- **Runtime:** Harness / Runtime, Secrets, Tools, Channels
- **Governance:** Permissions / Trust, API Keys, Revisions

Runs, activity, costs and budget for an agent link out to the Activity hub filtered to that agent
(`agentScopedAuditHref`); old `?tab=runs|audit|costs|budget` URLs redirect there.

## Roster and organization

### `agents/roster`: Agents list and org chart

- **Where:** Agents roster; sidebar agents list (app shell).
- **What:** filter tabs (all, active, paused, error, built-in); list or org-chart view (reporting lines);
  live-run indicators; per-row actions (run now, pause/resume). Built-in agents can be provisioned from
  the roster.
- **Requests:** `GET /api/companies/:companyId/agents`, `GET /api/companies/:companyId/org`,
  `GET /api/companies/:companyId/live-runs`, `GET /api/companies/:companyId/built-in-agents`,
  `POST /api/companies/:companyId/built-in-agents/:key/provision`.
- **Notes:** `/org` redirects to the roster's org view. The production shell defaults to org view.
  Since the 2026-10-24 sync, the status tabs are gone: `/agents/active|paused|error|builtin` redirect to
  the full roster, and paused agents show a badge instead. The list filters by harness (icons) and can
  bulk edit the selected agents' AI connection and default model, with compatible choices, a preview
  of the change, per-agent save results and retry (`components/agents/AgentBulkSettingsSheet.tsx`;
  `PATCH /api/agents/:id` with `runtimeSettings`, `GET /api/companies/:companyId/ai-connections`,
  `GET /api/companies/:companyId/adapters/:type/models`).
  Since the 2026-11-10 sync (#20317), the roster filters by model (or "Harness default"), status,
  harness and connection, each with All and an active count, on both layouts and the org chart; bulk
  selection survives hidden rows (`components/agents/AgentRosterFilters.tsx`,
  `lib/agent-roster-filters.ts`, which also reads `GET /api/companies/:companyId/ai-connections`).

### `agents/organization`: Reporting relationships

- **Where:** Runtime section ("Reports to" field); org chart.
- **What:** set who an agent reports to; inspect the tree.
- **Requests:** `PATCH /api/agents/:id`, `GET /api/companies/:companyId/org`.
- Since the 2026-11-05 sync, the agent profile also has a manager picker with linked agent chips, which
  blocks the agent itself and its reports (`pages/agent-detail/AgentReportingManager.tsx`,
  `GET /api/companies/:companyId/agents`, `PATCH /api/agents/:id` with `reportsTo`).

### `agents/primary-agent`: Personal primary agent

- **Where:** agent profile ("Set as my primary"), roster crown, sidebar order.
- **What:** each person picks a primary agent per company; it becomes the default for new tasks and chat.
- **Requests:** `GET|PUT /api/companies/:companyId/primary-agent/me`.

### `agents/membership`: Join, leave, star

- **What:** the same personal membership as projects: which agents appear in your sidebar.
- **Requests:** `PUT /api/companies/:companyId/resource-memberships/me/agents/:agentId`.

## Hiring

### `agents/hire`: New agent

- **Where:** "New agent" from the roster and sidebar (`/agents/new`); onboarding.
- **What:** steps: choose a harness (adapter; experimental harnesses flagged), connect a model/account
  (AI connection, OAuth or local login, with model detection), name and role, then saved. Variants:
  invite an external agent (pairing code, `enableOpenAiDot`), invite a personal Muse agent
  (`enableMuse`), and Grok bot setup (`enableGrokBot`).
- **Requests:** `POST /api/companies/:companyId/agent-hires` (hire, may need approval) or
  `POST /api/companies/:companyId/agents` (direct create),
  `GET|POST /api/companies/:companyId/muse-invitations` (resume or create a Muse invitation), `GET /api/adapters`,
  `GET /api/companies/:companyId/adapters/:type/models`,
  `GET /api/companies/:companyId/environments` (+ `/capabilities`), `GET /api/companies/:companyId/secrets`,
  `GET /api/companies/:companyId/me/user-secrets`; AI connection and adapter-login requests in the app
  shell (`/ai-connections/*`, `/adapters/:type/login-sessions/*`, `/adapters/:type/test-environment`).
  Since the 2026-10-26 sync, `POST /api/agents/:id/lifecycle/retry`: setup prepares the saved draft
  agent's execution environment before the model connection test, and keeps the chosen model account
  when the environment changes. The harness list no longer shows a second ACP agent selector or
  "Coming soon" harnesses.
- **Notes:** a hire that needs a formal approval shows "pending approval" until approved
  (`POST /api/agents/:id/approve`). Codex hires default to Paperclip Runner on a qualified target (flag
  `enableNativeRunner`). Since the 2026-10-22 sync, the setup flow saves a paused agent record as soon as
  the name is submitted and finishes the hire on that record (`POST /api/companies/:companyId/agents`,
  then `PATCH /api/agents/:id`), can probe the chosen environment
  (`POST /api/environments/:environmentId/probe`), and new Claude (qualified macOS and Linux targets),
  OpenCode and Pi agents also default to Paperclip Runner.
- **Since the 2026-11-01 sync:**
  - Kimi Code and Google Antigravity run on Paperclip Runner (ACPX `kimi` and `antigravity`). Both
    need an operator's candidate authorization; `GET /api/companies/:companyId/adapters` lists
    Antigravity under `candidateHarnesses` on `paperclip_runner` when it's authorized. Antigravity
    signs in with a Google subscription or a Gemini API key.
  - First onboarding offers only Claude and Codex.

## Agent detail

### `agents/overview`: Overview

- **What:** identity (public key, creator), status and lifecycle state, capabilities, skills summary,
  latest run card, recent tasks, board link; header actions: run now, pause or resume, clear error,
  terminate. (The header's "Run with provider trace" button was removed upstream on 2026-10-22; the
  agent's saved tracing setting and the run detail's "Re-run with provider trace" remain.)
- **Requests:** `GET /api/agents/:id`, `/identity`, `/runtime-state`, `GET /api/companies/:companyId/issues`
  (agent filter), `GET /api/companies/:companyId/heartbeat-runs`, `POST /api/agents/:id/heartbeat/invoke`.

### `agents/lifecycle`: Pause, resume, terminate, recover

- **What:** pause and resume; terminate (retire, keeping history; hidden for built-ins); clear an error
  state; retry a failed lifecycle step; approve a pending hire; reset the agent's session (fresh provider
  context) for tasks it touched.
- **Requests:** `POST /api/agents/:id/pause|resume|terminate|clear-error|approve|lifecycle/retry`,
  `POST /api/agents/:id/runtime-state/reset-session`.
- **Since the 2026-11-10 sync** (#20361, #20375): an agent whose verification needs an AI account
  default parks without a `pauseReason`, and the task's paused banner stays hidden while the agent is
  `preparing`, `verifying` or `resuming`; a `connection_intent` card on the task repairs it. Moving an
  agent to a plugin environment pauses it automatically instead of answering 409.

### `agents/instructions`: Instructions

- **Where:** Instructions section (`AgentInstructionsBundle`, `PromptsTab`).
- **What:** an instruction bundle of markdown files: open, edit, save, delete, download files; bundle
  settings; history and restore; candidate changes proposed by runs (view diff, accept or reject, refresh
  base); image upload in markdown.
- **Requests:** `GET|PATCH /api/agents/:id/instructions-bundle`,
  `GET|PUT|DELETE .../instructions-bundle/file`, `GET .../history`, `POST .../restore`, `GET .../diff`,
  `GET .../candidates`, `POST .../candidates/:runId/resolve`, `POST /api/companies/:companyId/assets/images`.
  Since the 2026-11-03 sync, bundle settings have their own panel
  (`pages/agent-detail/InstructionsBundleSettings.tsx`), and `PATCH .../instructions-bundle` accepts
  `requireExistingEntry` so a changed entry file must already exist.
  Since the 2026-11-13 sync, `PUT .../instructions-bundle/file` with `renameTo` and `baseHash`
  renames a file (`agentsApi.renameInstructionsFile`, #20973; U141).

### `agents/skills`: Skills

- **What:** skills assigned to the agent, versions, sync with the company library.
- **Requests:** `GET /api/agents/:id/skills`, `POST /api/agents/:id/skills/sync`,
  `GET /api/companies/:companyId/skills` (+ `/:skillId/versions`).

### `agents/runtime`: Harness / Runtime configuration

- **Where:** Runtime section (`components/AgentConfigForm.tsx`, also used in hiring).
- **What:** name, title, reports to, harness, model ID and thinking effort, command and extra args,
  prompt template (and legacy bootstrap prompt), default environment and override, heartbeat on interval,
  wake on demand, cooldown, max concurrent runs, timeout, interrupt grace period, continue after max-turn
  stop (attempts, delay), capture raw provider traces, browser access; adapter login (e.g. Claude login);
  test environment; qualify the agent's Runner on its environment. Agents run through Muse show a Muse connection panel: pair, verify, pause,
  disconnect, record a detector-removal observation, attest that a worker stopped, and allow an
  externally billed provider (`enableMuse`).
- **Requests:** `PATCH /api/agents/:id`, `POST /api/agents/:id/claude-login`,
  `POST /api/agents/:id/qualify-runner` (since the 2026-10-24 sync),
  `GET /api/companies/:companyId/adapters/:type/models`, `.../detect-model`, `.../test-environment`,
  `.../login-sessions/*`; Muse: `GET|POST /api/companies/:companyId/agents/:agentId/muse-binding`
  (`/verify`, `/revoke`, `/attest-detector-cleanup`, `/attest-stop`), `POST /api/agents/:id/pause`.
- **Notes:** unsaved changes prompt before navigating away. Built-in agents show their own bundle panel
  (`BuiltInBundlePanel`) and limit what can change. Since the 2026-10-22 sync, existing Claude and
  Codex agents are offered "Upgrade to Paperclip Runner", which saves the switch together with any
  unsaved changes.
  Since the 2026-11-10 sync (#20417, #20410), the Codex and Claude sign-in panels also work on a saved
  agent's computer from an environment plugin: the login-session requests take `agentId`, and
  `components/AgentLoginTarget.tsx` adds a "Sign-in computer" picker (`EnvironmentCapabilities.loginPtyDrivers`).

### `agents/secrets`: Secrets

- **What:** environment values and secret references the agent's runs receive.
- **Requests:** company and user secret lists (see Tier 2 Secrets), `PATCH /api/agents/:id`.

### `agents/tools`: Tools

- **Where:** Tools section (`AgentToolsTab`).
- **What:** which tool connections (apps, MCP servers) the agent can use; install or remove connection
  tools for the agent; effective tool profiles and policies; tool-gateway audit and per-run tool decisions.
- **Requests:** `GET /api/companies/:companyId/tools/connections|policies`,
  `GET .../tools/profiles/effective/agents/:agentId`, `GET /api/tool-connections/:connectionId/catalog|grants`,
  `PUT /api/tool-connections/:connectionId/installs`, `GET /api/tool-gateway/audit`,
  `GET /api/companies/:companyId/tools/runs/:runId/decisions`.

### `agents/channels`: Channels

- **What:** external chat channels (Slack and others) connected to the agent.
- **Requests:** `GET /api/companies/:companyId/chat-endpoints`.
- **Notes:** flag `enableChatConnectors`.

### `agents/permissions`: Permissions / Trust

- **What:** trust presets and individual permissions (what the agent may do without approval). Since
  the 2026-10-24 sync, project access: which projects a low-trust agent may read, and adding projects
  to that scope while keeping its other restrictions (`components/AgentProjectAccessSettings.tsx`).
- **Requests:** `PATCH /api/agents/:id/permissions`, `GET|POST /api/agents/:id/project-access`.
- **Since the 2026-11-10 sync** (not used by the old UI): eleven deny-only interaction switches per
  agent (`agent.permissions.interactions`, `AGENT_INTERACTION_PERMISSION_KEYS`), read and set with
  `GET` and `PATCH /api/agents/:id/interaction-permissions` (board only; `null` resets a switch;
  answers `{agentId, companyId, overrides, effective}`; #20411, #20422). `PATCH /api/agents/:id` and
  `/permissions` now refuse `permissions.interactions` (422). Single grants go through
  `PATCH /api/agents/:id/permission-grants` with `{permissionKey, enabled}` (board only, #20323).

### `agents/api-keys`: API keys

- **What:** create and revoke the agent's API keys (shown once on creation).
- **Requests:** `GET|POST /api/agents/:id/keys`, `DELETE /api/agents/:agentId/keys/:keyId`.

### `agents/revisions`: Configuration revisions

- **What:** history of configuration changes; roll back to a revision.
- **Requests:** `GET /api/agents/:id/config-revisions`,
  `POST /api/agents/:id/config-revisions/:revisionId/rollback`.

### `agents/configuration-yaml`: Agent configuration as YAML

- **Where:** the agent's Advanced tab (`/agents/:agentId/advanced`); in ui-new, Advanced →
  Configuration as YAML (`/agents/:key/advanced`, alias `/yaml`).
- **What:** the agent's whole setup as one `paperclip/v1` YAML document (profile, harness and its
  settings, runtime, instructions location and files, skill pins, tool installs, profiles and
  policies, channels and channel operations, permissions, secrets and proposals, API keys, revision
  restore), saved through each resource's own API. Omitted sections stay as saved; the editor shows
  a compact document (no defaults, empty fields, instruction file contents or legacy prompt text).
  Before saving it lists the steps in order; it refuses stale writes (`configurationRevision` or an
  edited section changed), checks the whole plan before writing, and explains a save that stopped
  part-way. Created API key tokens and secret ids are shown once.
- **Requests:** `GET /api/agents/:id/configuration`, `GET /api/agents/:id`, `…/instructions-bundle`
  (+ `/file`), `…/skills`, `…/keys`, `…/config-revisions`;
  `GET /api/companies/:companyId/tools/connections|profiles|policies`, `…/chat-endpoints`
  (+ `/chat-endpoints/:id`, `/resources`, `/principals`), `…/secrets`, `…/secret-proposals`.
  Writes: `PATCH /api/agents/:id` (with `expectedConfigurationRevision`, `replaceAdapterConfig`),
  `PATCH|PUT|DELETE …/instructions-bundle(/file)`, `POST …/skills/sync`, `PATCH …/permissions`,
  `POST|DELETE …/keys`, `POST …/config-revisions/:revisionId/rollback`,
  `GET|PUT /api/tool-connections/:id/installs`, `POST …/tools/profiles`
  (+ `PATCH /api/tool-profiles/:id`, `…/bind|unbind`), `POST|PATCH|DELETE …/tools/policies`,
  `PATCH /api/chat-endpoints/:id` (+ `/resources`, `/setup`, `DELETE /principals/:id/link`),
  `POST …/chat-endpoints`, `POST …/secrets`, `POST /api/secrets/:id/rotate`, `PATCH /api/secrets/:id`,
  `POST …/secret-proposals/:id/approve|reject`.
- **Notes:** upstream #18036, #18168. The schema is `agentConfigurationInputSchema` in
  `@paperclipai/shared`; a revision restore must be saved on its own.

### `agents/audit`: Agent actions audit

- **What:** log of the agent's actions, exportable as CSV.
- **Requests:** `GET /api/companies/:companyId/audit/agent-actions` (+ `.csv`).
- Since the 2026-11-03 sync (Refine-v2 agent page, #18378), Activity, Runs, Costs and Budgets show
  inside the agent page instead of linking out: `GET /api/companies/:companyId/activity`,
  `/heartbeat-runs`, `GET /api/routines/:id/runs`, `/costs/by-agent`, `/costs/by-agent-model`,
  `/budgets/overview`, `POST /api/companies/:companyId/budgets/policies`,
  `POST /api/companies/:companyId/budget-incidents/:incidentId/resolve`.

### `agents/built-in`: Built-in agents

- **What:** provision and reset built-in agents; run their routines now; enable or disable a routine's
  schedule.
- **Requests:** `POST /api/companies/:companyId/built-in-agents/:key/provision|reset`,
  `POST .../routines/:routineKey/run|enable|disable`.
- **Notes:** flag `enableBuiltInAgents`.

### `runs-adapters/runs`: Run detail

- **Where:** `/agents/:agentId/runs/:runId` (from the Activity hub, a task's run ledger, or the overview).
- **What:** run status, event stream, log, tasks the run touched, workspace operations and their logs,
  provider trace (view, reveal frame, download, delete), tool decisions, recovery actions; live
  transcript while running. Actions: cancel, resume, retry, rerun with provider trace, reset sessions for
  touched tasks, reconcile the workspace branch.
- **Requests:** `GET /api/heartbeat-runs/:runId` (+ `/events`, `/events?view=conversation`, `/log`
  with optional `alignStartToRecord=true`, `/issues`, `/workspace-operations`, `/provider-trace*`), `GET /api/workspace-operations/:operationId/log`,
  `POST /api/heartbeat-runs/:runId/cancel`, `POST /api/agents/:id/wakeup`,
  `POST /api/issues/:id/recovery-actions/resolve`, `POST /api/execution-workspaces/:id/reconcile-branch`,
  `WS /api/companies/:companyId/events/ws`.

## Agent chat

### `agent-chat/history` and `/handoff`: Conversations

- **Where:** Agent chats list and conversation page; sidebar chat links (app shell).
- **What:** one ongoing conversation per agent. It is a task underneath: the page renders
  `TaskDetailSurface` in conversation mode, so everything in the [Tasks](tasks.md) thread and composer
  applies (attachments, queued messages, interactions, run control). `/new` starts a fresh provider
  context in the same conversation. Asking for project work creates projects and tasks, shown as cards.
- **Requests:** `GET /api/companies/:companyId/chats`, `GET|POST /api/companies/:companyId/chats/:agentRef`,
  plus the task-detail requests.
- **Notes:** flag `enableAgentChat` (default off) shows chat links and pages. Board chat (`/board-chat`,
  "conference room") is a separate, separately gated feature (`enableConferenceRoomChat`).
- **Since the 2026-11-01 sync:**
  - An agent can post into a person's chat from a task it is working on
    (`POST /api/agents/me/chat/messages`); the comment's `metadata.chatMessage` names the source
    task and run.
  - Chats carry `isUnreadForMe` and `lastExternalCommentAt`; reading a chat marks it read up to the
    last message shown (`POST /api/issues/:id/read` with `{ throughCommentId }`,
    `hooks/useAgentChatRead.tsx`).
  - `GET /api/issues/:id/recent-comments` returns a chat's 20 newest comments with
    `oldestCommentId`; older ones page in on scroll (`GET /api/issues/:id/comments`,
    `hooks/useConversationHistoryPages.ts`).
- **Since the 2026-11-10 sync** (#20292): a message held at the agent's daily limit waits in the
  outbox (a `deferred` queue with its `executionWait.message`) instead of being dropped.

## Switches that change this area

`enableAgentChat`, `enableBuiltInAgents`, `enableNativeRunner`, `enableEnvironments`,
`enableAiConnectionRouters`, `enableOpenAiDot`, `enableGrokBot`, `enableMuse`, `enableChatConnectors`,
`enableConferenceRoomChat`. Full list with affected files: [generated/flags.md](../generated/flags.md).

## Redesign notes

- **Configuration is spread across seven sections** (Runtime, Secrets, Tools, Channels, Permissions,
  API keys, Revisions) plus Instructions and Skills. The runtime form alone has around 25 fields; many
  are advanced run-policy settings that could sit behind one "Advanced" area.
- **Runs live in two places.** The agent's run list moved to the Activity hub, but run detail stays under
  the agent route. A redesign could bring an agent's runs back onto the agent page.
- **Agent chat is a task.** Chat and task detail share one surface; a redesign of the conversation UI
  serves both.
- **Hiring reuses the configuration form.** `AgentConfigForm` drives both hire and edit, so a new form
  design covers both.
- **The app shell holds agent features too:** sidebar agents list with pause/resume and wake, primary
  agent, chat navigation, adapter login flows.
