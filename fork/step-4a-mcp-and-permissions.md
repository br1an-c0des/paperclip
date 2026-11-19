# Step 4a: Paperclip over MCP, with agent permissions

**Status: approved 2026-11-17; wave 1 built on `feat/step-4a`, wave 2 planned 2026-11-18 (see [the plan](step-4a-plan.md) and [the handoff](step-4a-handoff.md) for what changed while building).** The first half of
[hard-fork plan step 4](hard-fork-plan.md#4-make-runs-claude-native). The second half, 4b
(Claude-native runs: repo working folder, all setting sources, the repo's `.mcp.json` and skills,
memory), comes after this and gets its own design.

## Why

The MCP server is how outside agents work with Paperclip, and it can't do everyday things: an outside
Claude Code session couldn't add a label to a task or archive or delete one. Agent runs don't use MCP
at all for task work. They use curl, taught by an 800-line skill. And what an agent may do is spread
over five permission systems that don't know about each other, with gaps (nothing governs deleting).

The intent: **MCP becomes the primary way every agent works with Paperclip,** whether a run Paperclip
started or an agent outside it, and **each agent or connection has permissions** that decide which
tools it sees and what it can do.

## Goals

- One tool list, served to every kind of caller: a run's token, an agent API key, and an OAuth
  connection (acting as the person or as a named agent).
- Full task control through it, including labels, archive and (when granted) hard delete.
- Permission levels with per-action overrides, set per agent and per outside connection.
- Permissions hold however the agent gets in: MCP tools, `call_api`, or curl with the run token.
- A denied action becomes a request in the Inbox; approving it carries the action out.
- Runs reach Paperclip through MCP; the `paperclip` skill stops teaching curl.
- A run isn't done until it calls `finish` or `block` (the plan's completion rule).

## Non-goals

- Half 4b: working folder, setting sources, dropping `--strict-mcp-config`, repo skills, memory.
- Agents in their own container (deferred).
- Where personas live: they stay in Paperclip's per-agent `AGENTS.md` (decided).
- The other adapters, the Runner and its tool gateway, cloud and sandbox execution: dormant, not
  extended. Their tests may be skipped with a note if shared changes break them.
- Rewriting the public MCP's OAuth, consent and device-login machinery: kept as it is.

## Anti-goals (a failure even if it works)

- A permission that only the MCP layer checks, so curl or `call_api` gets around it.
- A tool list so large that every run pays for it in context.
- Two tool lists drifting apart (one for runs, one for outside connections).
- Existing agents breaking on deploy because their new level is too narrow to do their normal work.

## Decisions taken (2026-11-17)

| Question | Decision |
| --- | --- |
| What an outside agent is | Both, per connection: an OAuth connection acts **as me** or **as a named agent**. One tool list either way. |
| Delete vs archive | Archive is a normal tool. Hard delete is a separate permission, **off by default**, granted per agent. |
| Granularity | **Levels plus overrides:** read-only, worker, manager, admin; any single action can be switched on or off. Absorbs the existing interaction switches. |
| `call_api` reach | Named tools by default. `call_api` reaches the **whole REST API**, but only for callers granted it. |
| A denied action | **Asks the user:** it becomes an Inbox request; approving it performs the action. |
| Existing agents | Start at **manager**, so nothing they do today breaks; new hires start at **worker** (an outside connection acting as an agent uses that agent's level). (First answered "worker"; changed after the builder check showed today's defaults are wider than a narrow worker.) |
| What worker means | **Narrow:** its own tasks, plus creating and assigning subtasks of them. |
| Order | **4a (MCP and permissions) first,** then 4b. |
| Personas | Stay in `AGENTS.md`. |
| Approach | **Our own endpoint and tool list, permissions in the server's authorization service** (below). |

## Approaches considered

1. **Our own endpoint and tool list, permissions in `authorization.ts` (chosen).** A new shared tool
   catalog served from one endpoint for run tokens and agent keys; the public MCP keeps its OAuth
   front and hands calls to the same catalog. Permission levels become actions in the server's
   authorization service, checked in the REST routes, with the MCP layer filtering tools and turning
   denials into requests. Most work up front; the only option where the levels hold for curl and
   `call_api` too.
2. **Grow the public MCP into the one server.** Least new plumbing, but it builds on ~60 files of
   upstream cloud, device and idle-proof code behind an experimental flag; its tools are written for
   "acting as a person" and its `call_api` is curated by design.
3. **Permissions only in the MCP layer.** Cheapest, but `call_api` and curl get around it. Dropped.

## How it works today

| Path | Who | What it reaches |
| --- | --- | --- |
| REST with curl | `claude_local` runs | Everything, as the agent (`agent_jwt`, `PAPERCLIP_API_KEY`) |
| "Paperclip projects" (`/api/mcp/project-tools`) | Task-bound runs | 5 project and task tools ([project-tools.ts](../server/src/services/project-tools.ts)) |
| "Paperclip connections" (`/mcp/runtime-tools`) | Runs with a responsible user | `connections_search`, `connection_request` |
| "paperclip-assigned" gateways | Agents with tool connections | Third-party tools; stays as is |
| Public MCP (`/mcp/paperclip`) | Outside assistants, OAuth, as a person | ~30 named tools; `call_api` only reaches those ([capabilities.ts](../server/src/services/public-mcp/capabilities.ts)) |
| Agent API keys (`agent_key`) | Outside tools acting as an agent | REST, no run id ([Agent → Keys](../ui-new/src/agents/settings/KeysSection.tsx)) |

The REST API already supports what the public MCP lacks: `DELETE /issues/:id`
([issues.ts:17467](../server/src/routes/issues.ts)), `labelIds` and `hiddenAt` (archive) on
`PATCH /issues/:id`, and label definitions under `/companies/:companyId/labels`.

Permissions today:

- OAuth scopes `paperclip:read`, `:write`, `:configure` on public MCP grants (`mcp_oauth_grants.scopes`).
- The person's membership role.
- The agent's `permissions` JSON: `canCreateAgents`, `canCreateSkills` (saved but unenforced),
  `trustPreset`, `authorizationPolicy`, and 11 `interactions` switches
  ([agent-interaction-permissions.ts](../packages/shared/src/agent-interaction-permissions.ts)).
- `principal_permission_grants` with `PERMISSION_KEYS` such as `tasks:assign`,
  `tasks:manage_active_checkouts`.
- Route checks: `assertAgentIssueMutationAllowed` and similar in `routes/issues.ts`, most through
  `authorizationService.decide` ([authorization.ts](../server/src/services/authorization.ts), 3,172
  lines, its `AuthorizationAction` union at line 95; about 85 `decide` calls in routes).

The delete route runs only the edit check, so any agent that can edit a task can delete it today.

## Design

### 1. Callers

The endpoint resolves every call to a **caller**: the actor the REST routes already understand, plus
the access level that applies.

| Caller | How it authenticates | Acts as | Access from |
| --- | --- | --- | --- |
| Run | Run JWT (`agent_jwt`), sent by the run's MCP config | The agent, with the run id | The agent's access |
| Agent key | `agent_key` bearer | The agent, no run id | The agent's access |
| OAuth, as me | Public MCP OAuth grant | The person | The person's membership, **capped by** the connection's access |
| OAuth, as agent | Public MCP OAuth grant bound to an agent | The agent, no run id | The agent's access, capped by the connection's access |

"As agent" is new: the grant records an `actAsAgentId`, chosen on the consent screen (or later in
the connection's settings) from agents the person may configure. The grant's existing scopes stay
as a coarse ceiling (read-only consent still means read-only).

Tools that need a run (`finish`, `block`, `report_progress`, `task_context` for the current wake)
are hidden from callers without a run id.

### 2. Access levels and actions

New authorization actions, added to `AuthorizationAction`. The level table and the action list live
in one shared module (`packages/shared/src/agent-access.ts`) so the server and `ui-new` read the same
thing.

| Action | Covers | read-only | worker | manager | admin |
| --- | --- | :-: | :-: | :-: | :-: |
| `tasks:read` | Read tasks, comments, documents, projects, agents, labels; search | ✓ | ✓ | ✓ | ✓ |
| `tasks:comment` | Comment on tasks it can read | | ✓ | ✓ | ✓ |
| `tasks:update_own` | Change its own tasks: status, fields, labels, documents, archive | | ✓ | ✓ | ✓ |
| `tasks:create` | Create tasks; create subtasks of its own tasks and assign them to anyone; hand its own task off | | ✓ | ✓ | ✓ |
| `requests:create` | Ask the board, request approval | | ✓ | ✓ | ✓ |
| `tasks:update_any` | Change and archive anyone's tasks | | | ✓ | ✓ |
| `tasks:assign` | Assign or reassign any task to agents and people (existing key) | | | ✓ | ✓ |
| `labels:manage` | Create, rename, delete label definitions | | | ✓ | ✓ |
| `projects:manage` | Create and update projects, goals, routines | | | ✓ | ✓ |
| `agents:configure` | Configure other agents, instructions, skills (existing keys) | | | | ✓ |
| `agents:create` | Hire agents (existing key) | | | | ✓ |
| `api:raw` | `call_api` over the whole REST API | | | | ✓ |
| `tasks:delete` | Hard delete tasks | | | | |

`tasks:delete` is in no level: it's granted only as an override (decided). Putting `api:raw` in admin
rather than override-only is my call; it's what "admin" should mean, and it's still off for every
existing agent because they start at manager.

Manager is meant to match what an agent can do by default today (edit visible tasks not locked by
another run, assign, create projects), so moving existing agents to it changes nothing in practice.
Agent 1 checks this against `decideVisibleIssueWrite` and the `taskAssignmentAction` rules in
`authorization.ts` and widens manager if anything today's agents can do is missing.

**"Own" tasks (my call):** a task assigned to the agent, created by it, or below one of those in the
task tree. The manager-chain rule carries over: a manager agent's reports' tasks count as its own.

**Storage.** On the agent, `permissions.access = { level, overrides }` in the existing
`agents.permissions` JSON. An override is `true`, `false`, or `{ scope }` for actions that take a
scope (`tasks:assign` with today's `tasks:assign_scope`, `tasks:manage_active_checkouts`). On the
OAuth grant, new columns `act_as_agent_id`, `access_level`, `access_overrides`. Migration `0491`
adds those columns and **writes `access` onto every existing agent once**, so reads never have to
work it out from the old flags; an agent created later without `access` gets the default level.

**One source of truth (my call).** After 4a, `permissions.access` is the only standing permission
record for agent callers: `decide` stops consulting `principal_permission_grants` for agents (people
keep theirs), and the agent grants UI and endpoints are retired. (As built, narrower: agents still read `principal_permission_grants` for keys with no access action: `tools:*`, `inbox:manage`, `skills:*`, `tasks:manage_active_checkouts`, `agents:read`, `agents:suggest-changes`. The task-watchdog scope stays computed per request rather than a temporary grant.) The one other input is
**temporary grants**: a time-limited, scoped allow, used today by task-watchdog runs and in 4a by
approved permission requests (section 7). Both use the same mechanism, which `decide` checks after
the level and overrides.

**Carrying over today's flags (my call):** `canCreateAgents: true` becomes the `agents:create`
override; an agent's existing `principal_permission_grants` become overrides, keeping their scope.
Existing agents start at manager (decided); agents created after 4a default to worker.

**The interaction switches.** (As built: four of the six fold into actions; `canCommentOnOtherTasks` and `canMentionAgents` stay as switches.) The six actor-side switches (`canAssignTasksToAgents`,
`canAssignTasksToHumans`, `canMentionAgents`, `canCommentOnOtherTasks`, `canEditOtherTasks`,
`canConfigureOtherAgents`) fold into the actions above and are migrated into overrides when they're
set to `false`. The five receiver-side switches (`canReceive…`) stay: they're the target agent's
consent, a different question from what the actor may do.

**An "as me" connection** defaults to manager (my call), so an outside assistant can run the board
but not configure agents, delete, or use `call_api` until you raise it. **Existing grants** start at
the level matching their consent (my call): `paperclip:configure` → admin, `paperclip:write` →
manager, read-only → read-only, so your current Claude Code connection keeps everything it can do
today and gains `call_api`. Hard delete is still an override you switch on.

### 3. Enforcement in the server

The REST layer is the authority; the MCP layer only adds filtering and requests on top.

- **Explicit route checks** for the actions with a natural home:
  - `DELETE /issues/:id` → `tasks:delete`;
  - `PATCH /issues/:id` with `hiddenAt` → `tasks:update_own` or `tasks:update_any`; with `labelIds`,
    the same;
  - label definition routes → `labels:manage`;
  - task edits on another agent's task → `tasks:update_any` (inside `assertAgentIssueMutationAllowed`,
    replacing `canEditOtherTasks`).
- **A route policy for agent callers** (new middleware after `actorMiddleware`), so the whole API is
  covered without editing every route: each write route (POST, PATCH, PUT, DELETE under `/api`) is
  tagged with the action it needs. A caller acting as an agent may call a write route only if it holds
  that action; **an untagged write route requires `api:raw`**. Reads need `tasks:read` plus the
  routes' existing visibility checks. The tags live in one table keyed by method and route pattern,
  checked by a test against the OpenAPI document (`server/src/routes/openapi.ts`) so a new route can't
  be added untagged without failing it.
- Callers acting as a person keep the membership checks they have today; the connection cap applies
  in the MCP layer and through the same route policy.
- `PAPERCLIP_API_KEY` stays in a run's environment, for scripts. The route policy is what makes that
  safe.

### 4. The tool list

A shared catalog module, `server/src/mcp/catalog/`, one file per area. Each tool declares its name,
description, input schema, the action it needs, whether it needs a run, whether it's "requestable"
(can be turned into an Inbox request when denied), and a `run` function that re-enters REST through
an internal dispatch as the caller (the pattern in `createMcpApiDispatch`,
[capabilities.ts:26](../server/src/services/public-mcp/capabilities.ts)).

The proposed tools, about 22:

| Tool | Action | Notes |
| --- | --- | --- |
| `paperclip_me` | `tasks:read` | Identity, company, effective access, which tools are hidden and why |
| `paperclip_task_context` | `tasks:read` | Task, recent comments, documents index, the current wake (run only) |
| `paperclip_search_tasks` | `tasks:read` | Filters: status, assignee, project, label, text |
| `paperclip_read_task` | `tasks:read` | Any task by id or identifier |
| `paperclip_create_task` | `tasks:create` (+ `tasks:assign` to assign elsewhere) | Subtask or handoff; labels on create |
| `paperclip_update_task` | `tasks:update_own` / `_any` | Title, description, status, priority, assignee, labels, parent, blockers |
| `paperclip_archive_task` | `tasks:update_own` / `_any` | Sets `hiddenAt`; unarchive with `archived: false` |
| `paperclip_delete_task` | `tasks:delete` | Hard delete; requestable |
| `paperclip_add_comment` | `tasks:comment` | |
| `paperclip_read_document`, `paperclip_write_document` | `tasks:read`, `tasks:update_own` / `_any` | Revision check as today |
| `paperclip_list_labels`, `paperclip_manage_labels` | `tasks:read`, `labels:manage` | Create, rename, recolor, delete definitions |
| `paperclip_list_agents`, `paperclip_list_projects` | `tasks:read` | |
| `paperclip_ask_board` | `requests:create` | An Inbox question |
| `paperclip_request_approval` | `requests:create` | |
| `paperclip_report_progress` | run only | |
| `paperclip_finish`, `paperclip_block` | run only | Record the run's disposition (section 6) |
| `paperclip_search_api` | `api:raw` | Searches the OpenAPI document; returns only operations the caller may call (built: `api:raw`, since it only lists what `call_api` can reach) |
| `paperclip_call_api` | `api:raw` | Any REST operation from `search_api`, by operation id (`"METHOD /path"`; the OpenAPI document has no `operationId`s) and arguments |

The project tools from `/api/mcp/project-tools` fold in (`create_project` and friends under
`projects:manage`). **Every tool the public MCP offers today carries over** as a named tool (my
call), so retiring its list loses nothing: skills (read, create, update, files) and agent
configuration and instructions under `agents:configure`; deliverables under
`tasks:update_own`/`_any`; project details and repositories under `projects:manage`; pending
approvals and document revisions under `tasks:read`. A person's finish and block are
`paperclip_update_task` with a status. That makes the catalog about 40 tools, but filtering keeps a
worker's list to about 20. **`tools/list` returns only the tools the caller may use,** plus requestable
tools it may not use (marked as needing approval), so an agent can still ask for them.

### 5. Endpoints

- **`POST /api/mcp/paperclip`**, behind `actorMiddleware`, for run tokens and agent keys. Stateless
  Streamable HTTP with JSON responses, built like
  [project-tools.ts](../server/src/routes/project-tools.ts).
- **`POST /mcp/paperclip`** (the public MCP) keeps its OAuth and consent, resolves the grant to a
  caller (section 1), and serves the same catalog. Its own capability list
  (`capabilities.ts`, `expanded-capabilities.ts`) is retired. Its file-transfer tools
  (`get_upload_url`, `get_download_url`) move into the catalog if they work for agent callers too,
  else stay public-only.
- The consent screen and the connection settings (`/assistant-connections` in the old UI; the
  `ui-new` equivalent) gain "act as: me / agent X" and the access level.

### 6. Runs

- `runtime-execution.ts:852-871` gives a run **one** Paperclip server, `paperclip` →
  `/api/mcp/paperclip` with the run token, replacing "Paperclip projects". The connection tools
  ("Paperclip connections") fold in if their separate token can be replaced by the run token, else
  stay as they are (builder's call). "paperclip-assigned" gateways are unchanged.
  `--strict-mcp-config` stays until 4b.
- **Finish or block (my calls).** A run's **disposition** is any of: `paperclip_finish` (task to
  done or in review, with a summary), `paperclip_block` (task to blocked, with the owner and what's
  needed), `paperclip_report_progress` with `continue: true` (the work carries on in a later run),
  or the task reaching done, in review or blocked by any route (`paperclip_update_task`, curl).
  "Stalled" is **not a new status**: it's the existing missing-disposition recovery
  (`missing_disposition` in `run-completion.ts`), which already re-wakes the agent and then
  escalates to the Inbox. The change is that the tools count as a disposition and the run log says
  which one ended the run. Exempt: chat turns (`conversationMode`), runs that aren't task-bound, and
  wakes on a task that was already done or cancelled. No enum changes. The auto-comment fallback
  stays until the rule has proven itself (a later cleanup).
- **The `paperclip` skill** is rewritten from a curl manual to a short workflow guide in terms of the
  tools: start with `paperclip_task_context`, when to block, how to hand off, when to ask the board,
  always end with finish or block. The default heartbeat template's `search_api`/`call_api` lines
  become true.

### 7. Denied actions become requests

When a requestable tool is denied, the MCP layer creates an approval of a new type,
`permission_request`, holding the caller, the run and task if any, the tool, and its arguments. The
tool returns "Sent to the board for approval" with a link, and the agent carries on or blocks.

**Only a refusal by the level or an override becomes a request (my call).** Refusals by checks that
4a keeps — a receiving agent's consent switches, low-trust review, a restricted assignment policy,
private tasks or projects, another run's lock on an `in_progress` task — return a plain denial with
the reason, since approving a request couldn't get past them. The request records which action was
missing.

On approval, the server replays the call once **as the agent (or person), without a run id**, with a
temporary grant (section 2) for that action on that resource, and records the result on the
approval. Checks that depend on a run are evaluated without one; if the replay is refused anyway,
the approval records the refusal. If the request came from a task, a comment on the task reports the
outcome, which wakes the assigned agent in the normal way. Requests expire after 7 days (my call).
The request can also offer "approve and always allow", which adds the override.

Reads are never requestable; writes are requestable unless the tool says otherwise. The run tools (`finish`, `block`, `report_progress`), `search_api` and `call_api` are not requestable (as built).

### 8. `ui-new`

- **Agent → Permissions:** a level picker, then the actions as switches showing each one's level
  default, with overrides marked. Replaces the current switches and the actor-side half of the
  Interactions card. Help text behind info tips ([decision 52](../ui-new/docs/decisions.md#52-help-text-goes-behind-an-info-icon)).
- **Outside connections:** each connection's "acts as" and access level, editable.
- **Inbox:** a permission request card: who, what (the tool and its arguments in plain words), from
  which task; approve, approve and always allow, deny.

## Testing

- Server unit tests for the level table, override resolution and the carry-over of today's flags.
- Route tests: delete, archive and label changes allowed and denied by level; the route policy
  denying an untagged write without `api:raw`; a test that every write route in the OpenAPI document
  is tagged.
- MCP tests per caller kind: `tools/list` filtering, a denied requestable call creating a request,
  approval replaying it once.
- A run test: a run without finish or block ends stalled; a chat turn doesn't.
- `ui-new` component tests and the Playwright smoke suite with mocked writes.
- On the local instance, against TES with an "M7 test" agent (never Bob): a real run that uses only
  MCP tools and finishes. server1 only after you ask, with a database backup first (migration 0491).

## Splitting the work across agents

One feature branch, `step-4a`, merged into `main` with `--no-ff` at the end. Each agent works in its
own worktree on a branch off `step-4a` (resetting onto it first: worktrees can start from `master`),
and I review and merge each one into `step-4a`. At most three run at once.

**Wave 0, me, before any agent starts: the contracts.** A short commit on `step-4a` with the shared
pieces everyone builds against: `agent-access.ts` (actions, levels, the table, override resolution),
the new `AuthorizationAction` members, the catalog's tool definition type, the `permission_request`
approval type and its payload, and the run disposition shape for finish and block.

**Wave 1, three agents in parallel:**

| Agent | Builds | Owns |
| --- | --- | --- |
| 1. Permissions core | Access storage and resolution, carry-over of today's flags, the new actions in `authorization.ts`, the explicit route checks, the route-policy middleware and its OpenAPI test, migration `0491` | `server/src/services/authorization.ts`, a new middleware, the access checks in `routes/issues.ts` and the label routes, `packages/db` |
| 2. MCP endpoint and catalog | `/api/mcp/paperclip`, the catalog and its tools, `tools/list` filtering through the contracts' resolver, `search_api` over the OpenAPI document, `call_api`, finish/block/progress writing the disposition | `server/src/mcp/**`, the new route file |
| 3. Runs | The completion rule in `run-completion.ts`, the one-server MCP config for runs (behind a switch until agent 2 merges), the `paperclip` skill rewrite, the heartbeat template | `runtime-execution.ts`, `run-completion.ts`, `packages/adapters/claude-local`, `skills/paperclip` |

**Wave 2, after wave 1 merges, two agents in parallel:**

| Agent | Builds | Owns |
| --- | --- | --- |
| 4. Requests and outside connections | `permission_request` creation and replay; the public MCP serving the catalog; "act as me / agent" and access level on grants and the consent screen; retiring the old public capability list | `server/src/services/public-mcp/**`, approvals services and routes |
| 5. `ui-new` | The Permissions section, outside-connection settings, the Inbox permission request card | `ui-new/**` |

Then me: switch runs onto the new server, run the checks above on the local instance, update the
hard-fork plan's progress and [repo-map.md](repo-map.md), and stop for your approval before merging
into `main`.

## Left to the builder

- The exact route-pattern format of the route-policy table, and which existing write routes map to
  which action (most are obvious; untagged ones fall to `api:raw`).
- Whether the connection tools fold into the one server (depends on replacing their token).
- Tool descriptions and output field choices; keep each description short.
- Whether file-transfer tools move into the catalog.
- How `paperclip_me` explains hidden tools.
