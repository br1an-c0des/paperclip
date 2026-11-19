# Step 4a Implementation Plan: Paperclip over MCP, with agent permissions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement your part of this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking. Each agent implements only the tasks its brief
> names.

**Goal:** One Paperclip MCP tool list for runs, agent keys and outside connections, governed by
per-agent access levels that the server enforces however the agent gets in.

**Architecture:** A shared access model (`packages/shared/src/agent-access.ts`) defines actions,
levels and overrides. The server's authorization service and a new route policy enforce it on every
REST write. A tool catalog under `server/src/mcp/` re-enters REST as the caller, hides tools the
caller can't use, and is served at `/api/mcp/paperclip` (runs, agent keys) and later through the
public MCP's OAuth front.

**Tech Stack:** TypeScript, Express, Drizzle/Postgres, Zod 4, vitest; MCP over stateless Streamable
HTTP (JSON-RPC, JSON responses).

**Spec:** [fork/step-4a-mcp-and-permissions.md](step-4a-mcp-and-permissions.md). Read it before
your tasks; this plan argues from it and doesn't repeat its reasoning.

## How the work is split

| Wave | Agent | Tasks | Branch |
| --- | --- | --- | --- |
| 0 | Contracts | 0.1–0.4 | `step4a/contracts` |
| 1 | Permissions core | 1.1–1.6 | `step4a/permissions` |
| 1 | MCP endpoint and catalog | 2.1–2.5 | `step4a/mcp` |
| 1 | Runs | 3.1–3.3 | `step4a/runs` |
| 2 | Follow-ups | (handoff item 1) | `step4a/followups` |
| 2 | Requests and outside connections | 4.0–4.4 | `step4a/requests` |
| 2 | `ui-new` | 5.1–5.4 | `step4a/ui` |

Two agents touch `server/src/app.ts` (1.4 mounts the route policy, 2.5 mounts the endpoint): one
line each, merged by hand.

Integration branch: `feat/step-4a`, cut from `main`. Every agent branch is cut from
`feat/step-4a` **after** the contracts merge, and is merged back into it with `--no-ff` by the
project manager after review. `feat/step-4a` merges into `main` with `--no-ff` at the end, after the
user approves.

Wave 2 is planned once wave 1 has merged, because its interfaces (temporary grants, the catalog's
dispatch, the route policy's denial shape) are only final then. Its scope is in the spec, sections
1, 5, 7 and 8.

## Global Constraints

- Hard fork rules from `CLAUDE.md`: server, database and package changes are allowed; don't extend
  dormant areas (other adapters, the Runner, cloud and sandbox execution); skip a dormant test that a
  shared change breaks, with a comment saying why.
- `pnpm` isn't global: use `corepack pnpm`.
- New migrations continue the numbered sequence: the next is `0491` (last is
  `0490_nappy_chat.sql`). Only task 1.5 adds a migration.
- Action names, exactly: `tasks:read`, `tasks:comment`, `tasks:update_own`, `tasks:create`,
  `requests:create`, `tasks:update_any`, `tasks:assign`, `labels:manage`, `projects:manage`,
  `agents:configure`, `agents:create`, `api:raw`, `tasks:delete`.
- Level names, exactly: `read_only`, `worker`, `manager`, `admin`.
- `tasks:delete` is in no level; only an override grants it.
- Agents existing at migration time start at `manager`; agents created later default to `worker`.
  An "as me" outside connection defaults to `manager`.
- An untagged REST write route requires `api:raw` for agent callers.
- Only a refusal by level or override is "requestable"; other refusals are plain denials.
- Tool names start with `paperclip_`.
- The run endpoint is `POST /api/mcp/paperclip`.
- Tests never touch server1. Local checks use company TES and "M7 test" agents; never change Bob
  (`8997b521-5718-4fce-988f-e79a301dc876`).
- Run one test file with `corepack pnpm exec vitest run <path>` from the repo root.

## Review Focus

1. **Existing agents after the migration:** an agent that today edits a visible task, assigns a
   subtask to another agent or creates a project must still succeed at `manager`. Test in 1.5.
2. **A run's own in-progress task:** the route policy must not deny a run's writes to the task it has
   checked out (status, comments, documents) at `worker`. Test in 1.4.
3. **Agent keys without a run id:** `tools/list` for an `agent_key` caller hides run-only tools and
   still works; finish and block refuse with a clear message. Test in 2.3.
4. **`call_api` reaching a route the caller lacks:** an `admin` caller calling a route that needs
   `tasks:delete` through `call_api` is refused by the route policy, not let through because
   `api:raw` is held. Test in 1.4.
5. **A run that sets `done` through curl, not `paperclip_finish`:** counts as a disposition and is
   not sent to missing-disposition recovery. Test in 3.1.

---

## Wave 0: contracts

One agent, alone, before anything else. Small: types, tables, two thin server helpers, and their
tests.

### Task 0.1: The shared access model

**Files:**
- Create: `packages/shared/src/agent-access.ts`
- Create: `packages/shared/src/agent-access.test.ts`
- Modify: `packages/shared/src/index.ts` (export it next to `agent-interaction-permissions.js`, line ~2978)
- Modify: `packages/shared/src/types/agent.ts:22-28` (add `access?: AgentAccess` to `AgentPermissions`)

**Interfaces:**
- Produces:
  - `AGENT_ACCESS_ACTIONS` (the 13 names, in the Global Constraints order), `type AgentAccessAction`
  - `AGENT_ACCESS_LEVELS = ["read_only", "worker", "manager", "admin"]`, `type AgentAccessLevel`
  - `AGENT_ACCESS_LEVEL_ACTIONS: Record<AgentAccessLevel, readonly AgentAccessAction[]>` (the spec's
    level table, section 2)
  - `type AgentAccessOverride = boolean | { scope: Record<string, unknown> }`
  - `interface AgentAccess { level: AgentAccessLevel; overrides?: Partial<Record<AgentAccessAction, AgentAccessOverride>> }`
  - `type ResolvedAgentAccess = Record<AgentAccessAction, false | true | { scope: Record<string, unknown> }>`
  - `DEFAULT_AGENT_ACCESS_LEVEL = "worker"`, `EXISTING_AGENT_ACCESS_LEVEL = "manager"`,
    `DEFAULT_CONNECTION_ACCESS_LEVEL = "manager"`
  - `resolveAgentAccess(access: AgentAccess | null | undefined): ResolvedAgentAccess` (missing →
    `DEFAULT_AGENT_ACCESS_LEVEL`; an override replaces the level's value for that action)
  - `capAgentAccess(access: ResolvedAgentAccess, cap: ResolvedAgentAccess): ResolvedAgentAccess`
    (an action is allowed only if both allow it; when both are scoped, keep `access`'s scope)
  - `hasAgentAccess(access: ResolvedAgentAccess, action: AgentAccessAction | readonly AgentAccessAction[]): boolean`
    (an array means any of them)
  - `agentAccessSchema` (Zod, strict)

- [ ] **Step 1: Write the failing tests** in `agent-access.test.ts`:
  - `resolves a missing access to worker`: `resolveAgentAccess(undefined)["tasks:update_own"] === true`
    and `["tasks:update_any"] === false`.
  - `no level grants tasks:delete`: for every level, `resolveAgentAccess({ level })["tasks:delete"] === false`.
  - `admin includes api:raw, manager doesn't`.
  - `an override replaces the level value`: `{ level: "admin", overrides: { "api:raw": false } }` →
    `false`; `{ level: "worker", overrides: { "tasks:delete": true } }` → `true`.
  - `a scoped override is kept`: `{ level: "worker", overrides: { "tasks:assign": { scope: { projectIds: ["p"] } } } }`
    → `{ scope: { projectIds: ["p"] } }`.
  - `cap intersects`: admin capped by manager has no `agents:configure`.
  - `hasAgentAccess with an array is any-of`.
  - `the schema rejects unknown actions and levels`.
- [ ] **Step 2: Run them and see them fail:** `corepack pnpm exec vitest run packages/shared/src/agent-access.test.ts`
- [ ] **Step 3: Implement `agent-access.ts`** with the interfaces above.
- [ ] **Step 4: Run them and see them pass,** plus `corepack pnpm --filter @paperclipai/shared typecheck`.
- [ ] **Step 5: Commit** `Shared: the agent access model (actions, levels, overrides)`.

### Task 0.2: Authorization actions and the catalog types

**Files:**
- Modify: `server/src/services/authorization.ts:95` (add `| AgentAccessAction` to `AuthorizationAction`; give each new action a line in the denial-copy switch around line 196)
- Create: `server/src/mcp/catalog/types.ts`
- Create: `server/src/mcp/catalog/tool-names.ts`

**Interfaces:**
- Produces, in `types.ts`:
  - `type McpCallerKind = "run" | "agent_key" | "oauth_person" | "oauth_agent"`
  - `interface McpCaller { kind: McpCallerKind; actor: AuthorizationActor; companyId: string; agentId: string | null; userId: string | null; runId: string | null; grantId: string | null; access: ResolvedAgentAccess }`
  - `type CatalogDispatch = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown) => Promise<unknown>`
    (path is relative to `/api`; the dispatch carries the caller's identity)
  - `interface PaperclipTool<S extends z.ZodType = z.ZodType> { name: PaperclipToolName; description: string; input: S; action: AgentAccessAction | readonly AgentAccessAction[]; needsRun?: boolean; requestable?: boolean; run(caller: McpCaller, args: z.infer<S>, api: CatalogDispatch): Promise<unknown> }`
    (`requestable` defaults to `true` for tools whose action isn't `tasks:read`)
- Produces, in `tool-names.ts`: `PAPERCLIP_TOOL_NAMES` (const array) and `type PaperclipToolName`,
  with the spec's section 4 names: `paperclip_me`, `paperclip_task_context`, `paperclip_search_tasks`,
  `paperclip_read_task`, `paperclip_create_task`, `paperclip_update_task`, `paperclip_archive_task`,
  `paperclip_delete_task`, `paperclip_add_comment`, `paperclip_read_document`,
  `paperclip_write_document`, `paperclip_list_labels`, `paperclip_manage_labels`,
  `paperclip_list_agents`, `paperclip_list_projects`, `paperclip_ask_board`,
  `paperclip_request_approval`, `paperclip_report_progress`, `paperclip_finish`, `paperclip_block`,
  `paperclip_search_api`, `paperclip_call_api`, and the project tools `paperclip_create_project`,
  `paperclip_update_project`, `paperclip_list_project_repositories`. Wave 2 adds the carried-over
  public tools.

- [ ] **Step 1: Write the types and names.** No behaviour, so no test of its own.
- [ ] **Step 2: Typecheck:** `corepack pnpm --filter @paperclipai/server typecheck` passes.
- [ ] **Step 3: Commit** `Server: access actions in authorization, and the MCP catalog's types`.

### Task 0.3: Loading an agent's access

**Files:**
- Create: `server/src/services/agent-access.ts`
- Create: `server/src/services/agent-access.test.ts`

**Interfaces:**
- Consumes: `resolveAgentAccess` (0.1).
- Produces: `loadAgentAccess(db: Db, agentId: string): Promise<ResolvedAgentAccess>`. It reads
  `agents.permissions.access` and resolves it. Task 1.1 extends it with temporary grants; its
  signature doesn't change.

- [ ] **Step 1: Failing test** `loads worker for an agent without access, and the stored level otherwise`,
  using the existing embedded-Postgres test helpers (as other `services/*.test.ts` files do).
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Commit** `Server: load an agent's resolved access`.

### Task 0.4: The run disposition and the permission request shapes

**Files:**
- Create: `packages/shared/src/run-disposition.ts` (exported from `index.ts`)
- Modify: `packages/shared/src/constants.ts:716` (add `"permission_request"` to `APPROVAL_TYPES`)
- Create: `packages/shared/src/permission-request.ts` (exported from `index.ts`)
- Create: `server/src/services/heartbeat/run-disposition.ts`
- Create: `server/src/services/heartbeat/run-disposition.test.ts`

**Interfaces:**
- Produces, shared:
  - `RUN_DISPOSITION_KINDS = ["finished", "blocked", "continuing", "task_state"]`, `type RunDispositionKind`
  - `interface RunDisposition { kind: RunDispositionKind; at: string; via: "tool" | "task_status"; tool?: string; taskStatus?: string; summary?: string; blockedOwner?: string; unblockAction?: string }`
  - `interface PermissionRequestPayload { version: 1; caller: { kind: "run" | "agent_key" | "oauth_person" | "oauth_agent"; agentId: string | null; userId: string | null; runId: string | null; grantId: string | null }; taskId: string | null; tool: string; arguments: Record<string, unknown>; missingAction: AgentAccessAction; summary: string; expiresAt: string; result?: { status: "done" | "refused" | "failed"; detail: string; at: string } }`
    and its Zod schema `permissionRequestPayloadSchema`.
- Produces, server:
  - `recordRunDisposition(db: Db, runId: string, disposition: RunDisposition): Promise<void>`: writes
    `heartbeat_runs.result_json.paperclipDisposition` without touching the other keys of `result_json`.
    The first disposition wins; later ones are ignored (a `finish` after a `block` doesn't overwrite).
  - `readRunDisposition(run: { resultJson: Record<string, unknown> | null }): RunDisposition | null`.

- [ ] **Step 1: Failing tests:** `records a disposition without dropping other result_json keys`;
  `keeps the first disposition`; `reads null when none was recorded`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement both files.**
- [ ] **Step 4: Run them and see them pass,** plus typecheck for shared and server.
- [ ] **Step 5: Commit** `Run disposition and permission request shapes`.

---

## Wave 1, agent 1: permissions core

### Task 1.1: Temporary grants

**Files:**
- Create: `packages/db/src/schema/temporary_access_grants.ts` (and export from the schema index)
- Modify: `server/src/services/agent-access.ts`
- Test: `server/src/services/agent-access.test.ts`

**Interfaces:**
- Produces:
  - Table `temporary_access_grants`: `id`, `company_id`, `principal_type` (`agent` | `user`),
    `principal_id`, `action`, `resource` (jsonb: `{ type, id }`), `expires_at`, `reason`, `uses_left`
    (nullable integer; `1` for a replayed request, null for watchdog), `created_at`. Migration in 1.5.
  - `grantTemporaryAccess(db, input: { companyId: string; principal: { type: "agent" | "user"; id: string }; action: AgentAccessAction; resource: { type: "issue" | "agent" | "project" | "company"; id: string }; expiresAt: Date; reason: string; usesLeft?: number }): Promise<{ id: string }>`
  - `consumeTemporaryAccess(db, input: { companyId; principal; action; resource }): Promise<boolean>`:
    true if an unexpired grant matches; decrements `uses_left` when set.
- Find how task-watchdog runs get their scoped permission today (`grep -n watchdog` in
  `server/src/services/authorization.ts` and `server/src/routes/issues.ts`) and move it onto
  `grantTemporaryAccess` if it's a standing grant; if it's computed per request, leave it and note it.

- [ ] Steps: failing tests (`a grant allows its action on its resource only`; `an expired grant is ignored`;
  `a one-use grant is consumed once`), see them fail, implement, see them pass, commit.

### Task 1.2: The authorization service decides access actions

**Files:**
- Modify: `server/src/services/authorization.ts`
- Test: `server/src/__tests__/agent-access-authorization.test.ts`

**Interfaces:**
- Consumes: `loadAgentAccess` (0.3), `consumeTemporaryAccess` (1.1).
- Produces: `authorization.decide({ actor, action: AgentAccessAction, resource })` returns
  `allowed: false` with `reason: "access_level"` when the level and overrides don't grant it and
  no temporary grant does. That reason is how the MCP layer (2.x) and wave 2 recognise a requestable
  refusal. Existing agent rules become checks on these actions:
  - `decideVisibleIssueWrite` and the `canEditOtherTasks` switch → `tasks:update_any`, or
    `tasks:update_own` for an "own" task (spec section 2: assigned to it, created by it, below one of
    those; a manager agent's reports' tasks too).
  - `taskAssignmentAction` → `tasks:assign`, except a worker assigning a subtask of its own task.
  - `principal_permission_grants` are no longer read for agent actors.
- People (`board` actors) are unchanged.

- [ ] Steps: failing tests (`a worker may change its own task but not another's`;
  `a worker may assign a subtask of its own task to another agent`;
  `a manager may change any visible task not locked by another run`;
  `a denial for a missing action has reason access_level`;
  `a temporary grant allows one call`), see them fail, implement, see them pass, commit.

### Task 1.3: Explicit route checks

**Files:**
- Modify: `server/src/routes/issues.ts` (the delete route at ~17467, `PATCH /issues/:id` for
  `hiddenAt` and `labelIds`, the label routes at ~9635–9666, `assertAgentIssueMutationAllowed` at ~5972)
- Test: `server/src/__tests__/issues-access-routes.test.ts`

**Interfaces:**
- Consumes: `decide` with the new actions (1.2).
- Produces: the REST behaviour later tasks rely on: a denied agent gets `403` with body
  `{ error, code: "access_denied", missingAction, requestable: true }` when the reason is
  `access_level`, else `requestable: false`.

- [ ] Steps: failing tests (`DELETE /issues/:id needs tasks:delete`; `archiving another agent's task needs tasks:update_any`;
  `label definitions need labels:manage`; `a 403 for a missing action is requestable`),
  see them fail, implement, see them pass, commit.

### Task 1.4: The route policy

**Files:**
- Create: `server/src/middleware/agent-route-policy.ts`
- Create: `server/src/middleware/agent-route-policy-table.ts`
- Modify: `server/src/app.ts` (mount after `actorMiddleware`, before the API routers)
- Test: `server/src/__tests__/agent-route-policy.test.ts`

**Interfaces:**
- Produces: `agentRoutePolicy(db): RequestHandler`, and in the table file
  `AGENT_ROUTE_POLICY: ReadonlyArray<{ method: "POST" | "PATCH" | "PUT" | "DELETE"; path: string; action: AgentAccessAction | readonly AgentAccessAction[] | "route_checks" }>`.
  Paths are Express patterns as mounted under `/api` (e.g. `/issues/:id`). `"route_checks"` means the
  route does its own access check (1.3) and the policy only needs `tasks:read`. Untagged writes for
  agent callers need `api:raw`. A denial uses the 403 body from 1.3.

- [ ] **Step 1: Failing tests:**
  - `every write route in the OpenAPI document is tagged` (walk `server/src/routes/openapi.ts`'s
    document; a route missing from the table fails with its method and path);
  - `an untagged write needs api:raw`;
  - `a worker run may update its checked-out task, comment and write its documents` (Review Focus 2);
  - `api:raw does not bypass a tagged route's action` (Review Focus 4);
  - `board callers are not affected`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement the middleware and the table.** Tag the routes a run uses today (the
  `paperclip` skill's procedure and its references) carefully; tag the rest by area. Leave a route
  untagged (so it falls to `api:raw`) when it's configuration or admin.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.**

### Task 1.5: Migration 0491 and carrying over today's access

**Files:**
- Create: `packages/db/src/migrations/0491_agent_access.sql` (and the Drizzle meta entry, as the
  repo's `check:migrations` expects)
- Modify: `packages/db/src/schema/public_mcp.ts` (`mcp_oauth_grants`: `act_as_agent_id` uuid null,
  `access_level` text null, `access_overrides` jsonb null)
- Test: `server/src/__tests__/agent-access-migration.test.ts`

**Interfaces:**
- Produces: after the migration, every agent row has `permissions.access`:
  - `level: "manager"`;
  - `canCreateAgents: true` → override `agents:create: true`;
  - each actor-side interaction switch set to `false` → the matching action overridden `false`
    (`canEditOtherTasks` → `tasks:update_any`, `canAssignTasksToAgents`/`canAssignTasksToHumans` →
    `tasks:assign`, `canConfigureOtherAgents` → `agents:configure`). `canCommentOnOtherTasks` and
    `canMentionAgents` have no matching action (`tasks:comment` also covers its own tasks), so they
    stay as interaction switches, read as today: a narrowing of the spec's "six fold in" to four;
  - each `principal_permission_grants` row for the agent → an override for the matching action,
    keeping `scope`.
  - Existing OAuth grants: `access_level` from consent: `paperclip:configure` → `admin`,
    `paperclip:write` → `manager`, otherwise `read_only`.
  - The `temporary_access_grants` table (1.1).
- Agents created after the migration without `access` resolve to `worker` (0.1's default).

- [ ] Steps: failing tests (`an existing agent becomes manager`; `canCreateAgents carries over`;
  `a scoped grant carries over with its scope`; `an existing agent that edits a visible task, assigns a
  subtask and creates a project still can` (Review Focus 1); `oauth grants get a level from their scopes`),
  see them fail, implement, see them pass, `corepack pnpm --filter @paperclipai/db typecheck` (runs
  `check:migrations`), commit.

### Task 1.6: Retire the agent grants endpoints

**Files:**
- Modify: the routes that set member permissions for agent principals (`accessService.setMemberPermissions`
  callers) so agent principals get `410` with a pointer to `permissions.access`; `PATCH` of
  `agents/:id/permissions` accepts `access` (validated by `agentAccessSchema`).
- Test: extend `server/src/__tests__/agent-access-authorization.test.ts`.

- [ ] Steps: failing tests (`setting grants on an agent member is refused`; `PATCH permissions with access saves it`),
  see them fail, implement, see them pass, commit.

---

## Wave 1, agent 2: MCP endpoint and catalog

### Task 2.1: Caller resolution and internal dispatch

**Files:**
- Create: `server/src/mcp/caller.ts`, `server/src/mcp/dispatch.ts`
- Test: `server/src/mcp/caller.test.ts`

**Interfaces:**
- Consumes: `McpCaller`, `CatalogDispatch` (0.2), `loadAgentAccess` (0.3).
- Produces:
  - `resolveMcpCaller(db: Db, actor: AuthorizationActor): Promise<McpCaller>` for `agent_jwt` (kind
    `run`) and `agent_key` (kind `agent_key`); anything else throws `unauthorized`. Wave 2 adds the
    OAuth kinds.
  - `createCatalogDispatch(api: Router, caller: McpCaller): CatalogDispatch`: re-enters the API
    in-process as the caller (the pattern in `createMcpApiDispatch`,
    `server/src/services/public-mcp/capabilities.ts:26`), sending the run id header for runs. A
    non-2xx answer throws `McpToolError { status, code, missingAction?, requestable? }` carrying the
    403 body from 1.3.

- [ ] Steps: failing tests (`a run token resolves to a run caller with its run id`; `an agent key resolves without a run id`;
  `a board session is refused`; `a 403 from a route surfaces missingAction and requestable`),
  see them fail, implement, see them pass, commit.

### Task 2.2: The task tools

**Files:**
- Create: `server/src/mcp/catalog/tasks.ts`, `documents.ts`, `labels.ts`, `directory.ts`
  (agents, projects, project tools), `requests.ts` (ask board, request approval), `index.ts`
  (`PAPERCLIP_CATALOG: PaperclipTool[]`)
- Test: `server/src/mcp/catalog/catalog.test.ts`

**Interfaces:**
- Consumes: `PaperclipTool`, `PAPERCLIP_TOOL_NAMES` (0.2).
- Produces: the spec's section 4 tools other than finish, block, progress and the API tools, each
  calling REST through `CatalogDispatch`. `paperclip_update_task` accepts `labelIds`;
  `paperclip_archive_task` takes `{ taskId, archived?: boolean }` and sets `hiddenAt`;
  `paperclip_delete_task` declares `action: "tasks:delete"`. The project tools replace
  `server/src/services/project-tools.ts`'s definitions (keep that file until 3.2 switches runs over).
  Keep descriptions to one or two sentences.

- [ ] Steps: failing tests (`every catalog tool name is in PAPERCLIP_TOOL_NAMES and unique`;
  `update_task sends labelIds`; `archive_task sets and clears hiddenAt`; `delete_task calls DELETE /issues/:id`),
  see them fail, implement, see them pass, commit.

### Task 2.3: Run tools and the disposition

**Files:**
- Create: `server/src/mcp/catalog/run.ts` (`paperclip_me`, `paperclip_task_context`,
  `paperclip_report_progress`, `paperclip_finish`, `paperclip_block`)
- Test: `server/src/mcp/catalog/run.test.ts`

**Interfaces:**
- Consumes: `recordRunDisposition` (0.4).
- Produces: `finish` (`{ summary, status?: "done" | "in_review" }`), `block`
  (`{ summary, owner, unblockAction }`) and `report_progress` (`{ summary, continue?: boolean }`)
  change the task through REST and record the disposition (`finished`, `blocked`, `continuing` only
  when `continue: true`). All three have `needsRun: true`. `paperclip_me` returns identity, company,
  the resolved access, and the hidden tools with the missing action for each.

- [ ] Steps: failing tests (`finish records a finished disposition and sets done`; `block records owner and action`;
  `progress without continue records nothing`; `an agent_key caller can't call finish` (Review Focus 3)),
  see them fail, implement, see them pass, commit.

### Task 2.4: search_api and call_api

**Files:**
- Create: `server/src/mcp/catalog/api.ts`
- Test: `server/src/mcp/catalog/api.test.ts`

**Interfaces:**
- Consumes: the OpenAPI document from `server/src/routes/openapi.ts`; `AGENT_ROUTE_POLICY` (1.4)
  if merged, else a stub returning `api:raw` for every route (replace when 1.4 lands).
- Produces: `paperclip_search_api({ query })` returns at most 20 operations matching every word,
  each with `operationId`, method, path, summary and input schema, **only those the caller's access
  allows** under the route policy. `paperclip_call_api({ operationId, pathParams?, query?, body? })`
  needs `api:raw`, resolves the operation, and calls it through `CatalogDispatch`; the route policy
  still applies.

- [ ] Steps: failing tests (`search hides operations the caller can't call`; `call_api refuses without api:raw`;
  `call_api reaches a route through the dispatch`), see them fail, implement, see them pass, commit.

### Task 2.5: The endpoint and filtering

**Files:**
- Create: `server/src/mcp/server.ts` (JSON-RPC: `initialize`, `notifications/initialized`,
  `tools/list`, `tools/call`)
- Create: `server/src/routes/paperclip-mcp.ts`; Modify: `server/src/app.ts` (mount under `/api`
  next to `projectToolRoutes`)
- Test: `server/src/__tests__/paperclip-mcp-route.test.ts`

**Interfaces:**
- Produces: `POST /api/mcp/paperclip`. `tools/list` returns the tools whose `action` the caller holds
  (`hasAgentAccess`), minus `needsRun` tools when there's no run id, plus requestable tools it
  doesn't hold, with `annotations: { paperclipNeedsApproval: true }` and a description suffix "Needs
  approval.". `tools/call` of a denied requestable tool returns `isError: true` with
  `structuredContent: { code: "access_denied", missingAction, requestable: true }` (wave 2 turns this
  into a request). Server name `paperclip`, version `1`.

- [ ] Steps: failing tests (`a worker run lists task tools but not delete`; `a worker run sees delete marked as needing approval`;
  `an agent key sees no run tools`; `calling a denied tool returns access_denied`), see them fail,
  implement, see them pass, commit.

---

## Wave 1, agent 3: runs

### Task 3.1: The completion rule

**Files:**
- Modify: `server/src/services/heartbeat/run-completion.ts` (next to `reconcileLegacyContinuation`,
  ~1037–1050) and the missing-disposition check in `server/src/services/recovery/service.ts`
  (~3263–3430)
- Test: `server/src/__tests__/heartbeat-run-disposition.test.ts`

**Interfaces:**
- Consumes: `readRunDisposition`, `recordRunDisposition` (0.4).
- Produces: when a task-bound legacy run completes, if its task's status is `done`, `in_review` or
  `blocked` and no disposition was recorded, record `{ kind: "task_state", via: "task_status", taskStatus }`.
  A run with any disposition is covered and isn't sent to missing-disposition recovery. A run with
  none goes to the existing missing-disposition recovery, unchanged. Exempt, as today or newly:
  `conversationMode` runs, runs without a task, wakes on a task already `done` or `cancelled`. The run
  log gets one line naming the disposition.

- [ ] Steps: failing tests (`a run that calls finish is covered`; `a run that sets done through REST is covered` (Review Focus 5);
  `a run with no disposition goes to missing-disposition recovery`; `a chat turn is exempt`;
  `a wake on a cancelled task is exempt`), see them fail, implement, see them pass, commit.

### Task 3.2: One Paperclip server per run

**Files:**
- Modify: `server/src/services/heartbeat/runtime-execution.ts:852-871`
- Test: the existing tests for that builder (find with `grep -rln "project-tools" server/src/__tests__`), extended

**Interfaces:**
- Produces: when `PAPERCLIP_UNIFIED_RUN_MCP=1`, a run with a token gets one HTTP MCP server named
  `paperclip` at `<api>/api/mcp/paperclip` with the run token, instead of "Paperclip projects".
  "Paperclip connections" and "paperclip-assigned" are unchanged. Without the variable, today's
  behaviour. The project manager flips the default after wave 2.

- [ ] Steps: failing tests (`with the switch on, a run gets one paperclip server and no project-tools server`;
  `with it off, nothing changes`), see them fail, implement, see them pass, commit.

### Task 3.3: The `paperclip` skill and the heartbeat template

**Files:**
- Modify: `skills/paperclip/SKILL.md` and its `references/` (rewrite)
- Modify: the default heartbeat template (`packages/adapter-utils/src/server/server-utils.ts:214-223`)
  and the ACP curl note (`packages/adapter-utils/src/acpx-engine/execute.ts:3149-3168`) only if they
  name curl procedures

**Interfaces:**
- Consumes: `PAPERCLIP_TOOL_NAMES` (0.2) and the tool behaviour in 2.2–2.5.
- Produces: a short workflow guide (aim under 150 lines, no curl): start with
  `paperclip_task_context`; work; end every run with `paperclip_finish`, `paperclip_block`, or
  `paperclip_report_progress` with `continue: true`; when to hand off, ask the board or request
  approval; a tool marked "Needs approval" can still be called and becomes a request. Keep one short
  section noting `PAPERCLIP_API_KEY` exists for scripts.

- [ ] Steps: rewrite; check every tool name against `PAPERCLIP_TOOL_NAMES` with a quick script or
  grep; run the claude-local adapter tests (`corepack pnpm exec vitest run packages/adapters/claude-local`);
  commit.

---

## Wave 2 (planned 2026-11-18, after wave 1 merged)

Two agents in parallel, plus a follow-ups agent (`step4a/followups`) that runs first or alongside:
it swaps the route-policy stub for `AGENT_ROUTE_POLICY`, adds rename and recolour to
`paperclip_manage_labels`, builds the new-agent hiring rule, and rewords
`CONNECTION_INTENT_AGENT_GUIDANCE`. Agent 4 starts from `feat/step-4a` after the follow-ups merge,
since it builds on the real route-policy table.

**Follow-ups merged 2026-11-18** (`8652daf9b` on `feat/step-4a`). They also found bugs
[43](upstream-fixes.md#43-stop-a-company-import-from-setting-an-existing-agents-access-level)
(an import can set an existing agent's level; fix before `main`) and
[44](upstream-fixes.md#44-return-409-not-500-when-a-new-labels-name-is-taken). Expect
regression fixture changes: CEOs and agents created with `canCreateAgents: true` now store
`permissions.access`.

**Agent 5 merged 2026-11-18** (`7e2c2527a`): label manager, Access card, permission request card,
connection access and consent. Until agent 4 merges, `feat/step-4a`'s consent and connection
editing aren't backed by the server. Agent 5 found bugs 45 (the four retired interaction switches
are still enforced) and 46 (the YAML editor overwrites hiring access), to fix before `main`, and
47 (stale assignment fields).

**Agent 4 merged 2026-11-18** (`4f12573de`): permission requests and replay, outside connections
acting as the person or an agent at their level, the public MCP serving the catalog (old lists
deleted), and bug 43. Notes:
- **Worker run list:** 26 tools, about 4.2k tokens (was 23, about 3.1k). Admin: 29 tools, about
  5.3k tokens.
- **File tools are hidden from runs and agent keys:** `mcp_file_tickets.grant_id` and the uploads'
  `user_id` are NOT NULL, so opening them to runs and agent keys needs a migration.
- **An `mcp_oauth` actor can't approve or reject approvals,** so a connection can't approve its
  own requests through `call_api`.
- **Old grants keep their backfilled level.** No reconnect is forced. Clients see the new tool
  names on their next `tools/list`.
- **New bugs:** 48 (a multi-write replay is covered for its first write only) and 49 (file uploads
  check the connection's level only).

**Bugs 45–47 fixed and merged 2026-11-18** (`093b94b3b`), plus agent 5's `paperclip_me` rename
(`61b948c8c`). The four retired interaction switches are no longer enforced or accepted (410), the
YAML editor edits `access`, and the legacy assignment fields are gone. New: bug 50 (plugin-origin
configure and edit calls may skip the access check). Wave 2's building is done. Open before
`main`: bugs 48–50, then the project manager's list below.

**Run MCP merged 2026-11-18** (`0b0beb9e6`): every `claude_local` run with a token gets the
`paperclip` server, on both engines, task or not. `PAPERCLIP_UNIFIED_RUN_MCP` is gone and
`/api/mcp/project-tools` is retired (`services/project-tools.ts` stays for the dormant Runner). The
ACP prompt's API note is MCP-only, with no curl recipe.
- **Side effect:** every run now passes `--strict-mcp-config`, including task-less runs that used
  to load the repo's `.mcp.json` and the user's MCP servers. Step 4b drops the flag.
- **New bugs:** 51 (runs lost `set_task_title`), 52 (the chat directive uses old tool names) and 53
  (the ACP tests write `.claude/settings.local.json` into the repo).
- **Docs to update before `main`:** `fork/claude-local-run.md`, `repo-map.md` and
  `hard-fork-plan.md`. The agent listed the out-of-date lines: claude-local-run 75, 192, 412-416,
  513, 528-563, 666, 684-691; repo-map 127, 150, 184, 202; hard-fork plan 380, 404.

**Bugs 48–50 fixed and merged 2026-11-18** (`3c33eb7ad`):
- An approved replay runs under an in-memory allow for its `missingAction`, for that caller, for
  as long as the replay runs. Nothing is stored. The allow covers the task when the call names
  one, else the company.
- Act-as uploads check the agent's level as capped by the connection.
- Plugin calls made for an agent check that agent's access.
- **New:** bug 54 (the other plugin-origin writes), plugins only.

**Bugs 51 and 52 fixed and merged 2026-11-18** (`4f88dbd19`):
- `paperclip_update_task` takes `onlyIfProvisional` with `title` alone, and goes through
  `PUT /issues/:id/title`. The run directive points at it; the native Runner keeps its own text.
- The chat directive names `paperclip_create_project` and `paperclip_create_task`. Those tools now
  take `repositoryUrls` and `initialPlan`.
- A worker run sees 22 tools plus 4 that need approval.
- **New:** bugs 55 (the title route's refusal isn't requestable) and 56 (no retry key for task
  creation).

**Real-run check passed 2026-11-18** on a server1 dev instance on :3101, built from
`feat/step-4a` at `6e3c7e22b`, with the TES company and agent "M7 test runner" at `worker`, on
`claude_local` with the ACP engine:
- **Run 1 (TES-1):** the agent used only the `paperclip` server's tools (`paperclip_task_context`,
  `paperclip_add_comment`, `paperclip_finish`). It made no shell or curl calls. The disposition was
  recorded `via: tool`, and the task ended `done`.
- **Run 2 (TES-2):** `paperclip_delete_task` was refused and became a pending `permission_request`
  for `tasks:delete`, with a 7-day expiry. TES-1 was left alone, and the agent finished through
  `paperclip_finish`. The request wasn't approved, so approving and replaying it is still checked
  only by tests.

**Left before `main`:**
- bugs 53 and 54, optional;
- the docs listed above;
- the regression, after step 3a;
- the user's approval.

**Merged into `main` 2026-11-19** (`549e76036`). The regression after step 3a: `main` merged into
`feat/step-4a` (`48a722c62`), then the quick tier (750 files) found 21 server files failing that
passed on `main`. Two agents fixed them: A gave test agents the access level each test means
(merge `3319d35d7`), B sorted the rest into design changes (test updates) and regressions (code
fixes; merge `472aecb57`, bug 59 in `4bd93bce3`). The regressions became bugs 58–61, all fixed: a scoped
override counted as unscoped (58, security), provider `access_denied` errors taken for agent
refusals (59), a worker's new subtask judged as someone else's task (60), and a write and row lock
on every refused check (61). CI then failed only on bug 62, a test leak on `main` too, fixed on
`main` and merged in. CI green on `feat/step-4a` `18ceb34cd` (run 44578190447) and `main`
`0d5646ab9` (run 44578190090); merged with the user's approval. **Deployed to server1** 2026-11-19 (`5bde9aec2`), after a
backup (`~/deployments/paperclip/backups/paperclip-2026-11-19-1215.dump`): 0491 applied, health
`ok`; the 5 agents carried over at `manager` with `agents:create`, `agents:configure` and
`tasks:assign` overrides; the one outside OAuth connection carried over at `admin`, acting as the
person.

**Open after the merge:** bugs 53–56 (optional); B's design question, whether a refusal outside a
scoped override (`deny_scope`) should be requestable (now it isn't); the invite route serves the
MCP-oriented `paperclip` skill to outside agents joining by invite, which may not have the MCP
server configured.

**Outside connections may break (decided 2026-11-18):** the user would rather the public MCP be
built the right way than stay compatible. Existing OAuth connections may have to be removed and
made again; consent doesn't have to keep the old checkbox meaning; old public tool names don't
have to map. Capabilities still carry over: nothing an outside agent could do is lost. Agents
existing at 0491 still start at `manager` (that rule is about runs, not connections).

**Testing while step 3a renovates the suite:** typechecks, each agent's own new or changed test
files one at a time by path, and `ui-new`'s unit tests. No package suites, directories or broad
patterns.

**What wave 1 left that wave 2 builds on** (facts on `feat/step-4a`, 2026-11-18):

- There are two endpoints with the same tail. **`/mcp/paperclip`** is the public OAuth MCP
  (`publicMcpIngressRoutes`, `server/src/routes/public-mcp.ts:43`). It's behind the instance flag
  `enablePublicMcp` and needs `PAPERCLIP_PUBLIC_URL`. **`/api/mcp/paperclip`** is the catalog
  (`server/src/routes/paperclip-mcp.ts:17`).
- **How the public MCP sees a caller.** `actorForGrant` (`server/src/services/public-mcp/oauth.ts:124`)
  makes a `board` actor (`source: "mcp_oauth"`) for a personal grant. For a grant with purpose
  `"agent"` it makes an `agent` actor. Purpose `"agent"` belongs to the Dot, Grok Bot and Muse
  runtime pairings, which are dormant here.
- **The public MCP's dispatch already goes through the route policy.** `createMcpApiDispatch`
  (`capabilities.ts:25`) re-enters the main `api` Router, where `agentRoutePolicy` is mounted first
  (`app.ts:682`). But the policy only acts on `agent` actors, so personal grants pass it untouched.
- **The grant columns aren't wired up.** `mcp_oauth_grants.act_as_agent_id`, `access_level` and
  `access_overrides` exist (migration 0491 backfills `access_level`), but no server code reads or
  writes them.
- **`resolveMcpCaller` (`server/src/mcp/caller.ts:12`) only makes run and agent-key callers.**
  `McpCallerKind` already has `oauth_person` and `oauth_agent`.
- **A denied requestable call creates nothing yet.** `server/src/mcp/server.ts:82-117` returns
  `{ code: "access_denied", missingAction, requestable }` as an error result, and that's all.
- **`approvalService.decide` (`server/src/services/approvals.ts:193`) routes by type in one place:**
  `hire_agent` goes to `decideHire`, and every other type to `resolveApproval`.
- **Approvals never expire.** Only retention archives pending ones, after 90 days.
- **There's no endpoint to update a grant.** `/mcp/connections` has `GET` and `DELETE` only
  (`routes/public-mcp.ts:248`).
- **The consent page is in `ui-new`** (`ui-new/src/auth/McpConnect.tsx`). It posts
  `mcpConsentSchema { decision, companyId?, allowWrites, allowConfiguration }`
  (`packages/shared/src/public-mcp.ts:7`).
- **The public tool list: 33 tools** in `capabilities.ts`, `expanded-capabilities.ts` and
  `file-transfers.ts`. The catalog already covers 12 of them by name or meaning. The rest are listed
  in task 4.4.

---

## Wave 2, agent 4: requests and outside connections

Branch `step4a/requests`. Owns:
- `server/src/services/public-mcp/**`, `server/src/routes/public-mcp.ts`;
- `server/src/mcp/**` (after the follow-ups merge);
- `server/src/services/approvals.ts`, `server/src/routes/approvals.ts`;
- a new `server/src/services/permission-requests.ts`;
- the grant and consent types in `packages/shared` (`public-mcp.ts`, `permission-request.ts`);
- `server/src/middleware/agent-route-policy.ts` (for 4.3 only).

It doesn't touch `ui-new/`.

### Task 4.0: The wave 2 contracts (first commit, so agent 5 can build against it)

**Files:**
- Modify: `packages/shared/src/public-mcp.ts`, the shared index
- Test: `packages/shared/src/public-mcp.test.ts` (or the existing nearest test)

**Interfaces:**
- Produces:
  - `mcpConsentSchema` gains `actAsAgentId?: string | null` and `accessLevel?: AgentAccessLevel`.
    Existing clients that send neither keep today's behaviour: the level comes from
    `allowWrites`/`allowConfiguration` (configure → admin, write → manager, else read-only), and
    the grant acts as the person.
  - `McpConnection` (the `GET /mcp/connections` row) gains `actAsAgent: { id, name } | null`,
    `accessLevel`, `accessOverrides`.
  - `updateMcpConnectionSchema = { actAsAgentId?: string | null; accessLevel?: AgentAccessLevel; accessOverrides?: AgentAccessOverrides }`
    for `PATCH /mcp/connections/:id`.
- The project manager merges this commit into `feat/step-4a` on its own as soon as it lands, and
  tells agent 5.

- [ ] Steps: schema tests, implement, commit.

### Task 4.1: Permission requests from a requestable denial

**Files:**
- Create: `server/src/services/permission-requests.ts`
- Modify: `server/src/mcp/server.ts`
- Test: `server/src/services/permission-requests.test.ts`

**Interfaces:**
- Consumes: `PermissionRequestPayload` (0.4), the `access_denied` tool error (2.x), `McpCaller`.
- Produces:
  - `createPermissionRequest(db, { caller, tool, arguments, missingAction, taskId }): Promise<{ approvalId; url }>`.
    It writes an approval of type `permission_request`:
    - `requestedByAgentId` is the caller's agent, if any;
    - the issue link is the task, if any;
    - `payload.expiresAt` is 7 days out;
    - `summary` is one plain sentence, e.g. "Delete task TES-12".
  - **Only for a requestable denial:** the level or an override refused it, and the tool doesn't set
    `requestable: false`. Every other refusal returns the plain denial, as now.
  - **No duplicates:** an identical pending request (same caller principal, tool, arguments and
    task) is reused, not duplicated.
  - **The tool result** becomes "Sent to the board for approval" with the request's link and id. It
    carries `isError: false` and `structuredContent { status: "requested", approvalId }`, so the
    agent carries on or blocks.
  - This covers both refusal points: the `needs_approval` visibility check in `callTool`, and a 403
    with `requestable: true` from a route.

- [ ] Steps: failing tests:
  - `a worker calling paperclip_delete_task creates one permission_request`;
  - `a second identical call reuses it`;
  - `a refusal for a reason other than access_level creates nothing`;
  - `run-only tools never create one`.

  See them fail, implement, see them pass, commit.

### Task 4.2: Approve, replay once, record

**Files:**
- Modify: `server/src/services/approvals.ts` (a `permission_request` branch in `decide`, beside
  `hire_agent`), `server/src/routes/approvals.ts`, `server/src/services/permission-requests.ts`,
  `server/src/app.ts` (wiring only)
- Test: `server/src/__tests__/permission-request-replay.test.ts`

**Interfaces:**
- Consumes: `grantTemporaryAccess` (1.1), `createCatalogDispatch` and `createPaperclipCatalog` (2.x).
- Produces:
  - **The replayer.** On approve, the server rebuilds the caller from `payload.caller` **without a
    run id**. A run caller becomes an agent-key-like caller for its agent; an OAuth caller is
    rebuilt from its grant and refuses if the grant was revoked.
    - It grants `{ action: missingAction, resource: <the task, else the company>, usesLeft: 1, expiresAt: +10 min }`.
    - It runs the tool once through the catalog with the stored arguments.
    - It writes `payload.result { status: "done" | "refused" | "failed", detail, at }`.
    - The approval is resolved approved either way. The result says what happened.
  - **Wiring:** the replayer needs the `api` Router, so it's built in `app.ts` and injected into
    the approval route and service, like `createMcpApiDispatch`. No import cycle from services into
    `app.ts`.
  - **"Approve and always allow"** is `POST /approvals/:id/approve` with
    `{ alwaysAllow: true }`, for `permission_request` only. Before replaying, it adds the
    `missingAction` override to the agent (`withAccessOverride`), or to the grant's
    `access_overrides` for an OAuth person caller.
  - **Expiry:** an approve after `payload.expiresAt` doesn't replay. It records
    `result { status: "refused", detail: "expired" }`. No sweeper; the Inbox shows the request as
    expired (agent 5).
  - **Reporting:** if the request has a task, a comment on it reports the outcome in one line. That
    wakes the assignee in the normal way. Reject records nothing beyond the normal rejection.
  - **No direct creation:** `POST /companies/:companyId/approvals` refuses `type: "permission_request"`
    (422, `code: "permission_request_reserved"`). Only `createPermissionRequest` makes them.

- [ ] Steps: failing tests:
  - `approving replays the call once and records done`;
  - `the temporary grant is used up by the replay`;
  - `a replay refused by another check records refused`;
  - `approve after expiry doesn't replay`;
  - `always-allow adds the override`;
  - `POST approvals refuses permission_request`;
  - `a task comment reports the outcome`.

  See them fail, implement, see them pass, commit.

### Task 4.3: OAuth callers and the connection's level

**Files:**
- Modify: `server/src/mcp/caller.ts`, `server/src/services/public-mcp/oauth.ts`,
  `server/src/middleware/agent-route-policy.ts`, `server/src/routes/public-mcp.ts`
- Test: `server/src/mcp/caller.test.ts`, `server/src/__tests__/public-mcp-grant-access.test.ts`

**Interfaces:**
- Produces:
  - `resolveMcpCaller` handles `mcp_oauth` actors:
    - **A personal grant without `act_as_agent_id`** is `oauth_person`. Its access is the grant's
      `access_level` and `access_overrides`. The person's membership checks still apply in the
      routes, as today.
    - **A personal grant with `act_as_agent_id`** is `oauth_agent`. It acts as that agent, with no
      run id. Its access is `capAgentAccess(agent's access, grant's access)`.
    - **A purpose-`"agent"` grant (Dot, Grok Bot, Muse; dormant)** also maps to `oauth_agent` on its
      `agent_id`, without a cap. Don't extend those pairings.
  - **`actorForGrant`:** for a personal grant with `act_as_agent_id`, it gives an `agent` actor
    (`source: "mcp_oauth"`, plus `grantId`), so the routes and the route policy treat it as that
    agent.
  - **The route policy caps `oauth_person`:** a `board` actor with `source: "mcp_oauth"` must hold
    the route's action at the grant's level, or it gets the same 403 body. This is the "cap applies
    through the same route policy" in spec section 3. A person's own browser session is unchanged.
  - **Consent:** `approveGrant` writes `access_level` and `act_as_agent_id` from the extended
    `mcpConsentSchema` (4.0).
    - **Act as:** the person may pick only agents they may configure. Anything else is a 403.
    - **Level:** a level above what the old checkbox would give needs `allowConfiguration`.
    - **The scope ceiling:** a read-only consent stays read-only whatever level is sent.
  - **`PATCH /mcp/connections/:id`** takes `updateMcpConnectionSchema`. It's open to the grant's own
    person, or to a person who may configure the act-as agent, and is logged as
    `mcp_connection.updated`.
  - **`GET /mcp/connections`** returns the new fields.

- [ ] Steps: failing tests:
  - `a personal grant at read_only can't create a task through call_api or a tool`;
  - `a grant acting as an agent uses the lower of the two levels`;
  - `consent can't act as an agent the person can't configure`;
  - `PATCH changes the level and the next call sees it`;
  - `an existing grant with no new consent fields keeps its backfilled level`.

  See them fail, implement, see them pass, commit.

### Task 4.4: The public MCP serves the catalog

**Files:**
- Modify: `server/src/services/public-mcp/**`, `server/src/mcp/catalog/**` (new tools)
- Delete (at the end, once nothing imports them): the tool definitions in `capabilities.ts` and
  `expanded-capabilities.ts`. Keep the OAuth, consent, idempotency-receipt and file-ticket code.
- Test: `server/src/mcp/catalog/catalog.test.ts`, `server/src/__tests__/public-mcp-catalog.test.ts`

**Interfaces:**
- Produces:
  - **The handler:** the public MCP's `tools/list` and `tools/call` come from
    `createPaperclipCatalog(catalogDeps(db))`, through the same filtering as `/api/mcp/paperclip`,
    with the caller from 4.3. Run-only tools are hidden; there's no run id. Writes still record
    `mcp_mutation_receipts`, as today.
  - **Carry over every public tool** that the catalog lacks. To keep a worker's list near today's
    23, fold reads into existing tools where the shape allows:

    | Public tool | Becomes |
    | --- | --- |
    | `paperclip_connection` | `paperclip_me` |
    | `finish_task`, `block_task` | `paperclip_update_task` with a status (spec section 4) |
    | `get_agent` | `paperclip_list_agents` with `agentId` |
    | `get_project` | `paperclip_list_projects` with `projectId` |
    | `pending_approvals` | `paperclip_list_requests` (`tasks:read`) |
    | `list_deliverables`, `register_deliverable`, `update_deliverable` | `paperclip_deliverables` (read `tasks:read`; write `update_own`/`_any`) |
    | `list_document_revisions` | `paperclip_read_document` with `revisions: true` |
    | `read_agent_instructions`, `list_agent_instruction_revisions`, `update_agent`, `update_agent_instructions` | `paperclip_configure_agent` (`agents:configure`; reads included) |
    | `set_project_repositories` | `paperclip_update_project` |
    | `list_skills`, `get_skill`, `read_skill_file`, `create_skill`, `update_skill`, `write_skill_file` | `paperclip_skills` (read `tasks:read`; write `agents:configure`) |
    | `get_upload_url`, `get_download_url` | `paperclip_file_upload`, `paperclip_file_download` (`update_own`/`_any`, `tasks:read`) |

    A tool whose action depends on its arguments (read or write) declares the write action for
    visibility and checks per call. The new names go into `tool-names.ts`. The skill test
    (`paperclip-skill-tools.test.ts`) still passes.
  - **The file tools** work for every caller kind, through the existing ticket code. The Dot prefix
    `/mcp/runner/files` stays.
  - **Report two numbers:** the worker run list (count and definition tokens) before and after.

- [ ] Steps: failing tests:
  - `the public MCP lists the catalog for a personal grant`;
  - `every former public tool name maps to a catalog tool` (a table test over the old names);
  - `a read_only grant sees no write tools`;
  - `upload then download a file through the catalog tools`.

  See them fail, implement, then delete the old lists, see the tests pass, commit.

---

## Wave 2, agent 5: `ui-new`

Branch `step4a/ui`. Owns `ui-new/**` only. Load the `solidjs` skill. Follow `ui-new/docs/design/`
(the boards, `design-system.md`, `tokens.css`), and put help text behind info tips (decision 52).
Types come from `@paperclipai/shared` with `import type`. Tasks 5.1–5.3 need nothing from agent 4.
Task 5.4 starts once 4.0 is merged into `feat/step-4a`; the project manager says when. Until then,
merge `feat/step-4a` into the branch with `--no-ff`; no rebases.

### Task 5.1: Rename and recolour labels

**Files:**
- Create: a label manager reachable from the company's settings (where the board puts company-wide
  settings; ask the PM if no board covers it), plus an "Edit labels" link from `NewLabelDialog`
- Modify: `ui-new/src/api/task-actions.ts` (`updateLabel`, `deleteLabel`)
- Test: a component test beside the new files

**Interfaces:**
- Consumes: `PATCH /labels/:labelId` (`{ name?, color? }`; 409 `label_name_taken`) and
  `DELETE /labels/:labelId`.
- Produces:
  - list, rename, recolour and delete, with confirmation on delete and the clash shown on the field;
  - the shared label query (`lib/company-data.ts:55`) is invalidated after each change.

- [ ] Steps: test, implement, typecheck, commit.

### Task 5.2: The Permissions section

**Files:**
- Modify: `ui-new/src/agents/settings/PermissionsSection.tsx`, `InteractionsCard.tsx`,
  `interactions-model.ts`, `ui-new/src/api/agents.ts`
- Test: `PermissionsSection.test.tsx` (new or existing)

**Interfaces:**
- Consumes: `AGENT_ACCESS_ACTIONS`, `AGENT_ACCESS_LEVELS`, `AGENT_ACCESS_LEVEL_ACTIONS`,
  `resolveAgentAccess` (`packages/shared/src/agent-access.ts`); `PATCH /agents/:id/permissions`
  with `{ access: { level, overrides } }`.
- Produces:
  - **The level picker** (read-only, worker, manager, admin).
  - **The 13 actions as switches.** Each shows its level default, marks an override, and offers to
    reset it. `tasks:delete` is shown as override-only.
  - **What it replaces:** "Hire agents" and the assignment switch become the `agents:create` and
    `tasks:assign` rows. `InteractionsCard` keeps only the five receiver-side switches and
    `canCommentOnOtherTasks`/`canMentionAgents`. The others moved into actions; the server returns
    410 `agent_grant_retired` for them.
  - **Trust preset and project access** stay as they are.

- [ ] Steps: test, implement, typecheck, commit.

### Task 5.3: The permission request in the Inbox

**Files:**
- Modify: `ui-new/src/inbox/row-model.ts:110`, `ui-new/src/requests/request-model.ts:617`,
  `ui-new/src/requests/RequestCard.tsx`
- Test: `RequestCard.test.tsx` (new or existing)

**Interfaces:**
- Consumes: `PermissionRequestPayload` (`packages/shared/src/permission-request.ts`);
  `POST /approvals/:id/approve` (with `{ alwaysAllow: true }` for always-allow, 4.2) and `/reject`.
- Produces:
  - a `permission_request` label in both maps ("Permission");
  - **a card body** saying who (agent, or person by connection), what (`summary`, then the tool and
    its arguments in plain words, collapsible), from which task (a link), and the missing action;
  - **three buttons:** Approve, Approve and always allow, Deny;
  - **after a decision,** the recorded `result` (done, refused with its detail, failed);
  - **expired requests:** past `expiresAt`, the card says so, and approving is disabled.

- [ ] Steps: test, implement, typecheck, commit.

### Task 5.4: Outside connections and the consent screen (after 4.0)

**Files:**
- Modify: `ui-new/src/auth/McpConnect.tsx` (consent and `AssistantConnectionsPage`),
  `ui-new/src/apps/assistant/AssistantConnection.tsx`, `assistant-model.ts`, `ui-new/src/api/mcp.ts`
- Test: beside the changed files

**Interfaces:**
- Consumes: the extended `mcpConsentSchema`, `McpConnection` and `updateMcpConnectionSchema` (4.0);
  `PATCH /mcp/connections/:id`.
- Produces:
  - **Consent:** "Acts as: me / agent …" (only agents the person may configure) and a level. The
    default is manager, or what the old checkbox gives, keeping the checkbox's meaning for the scope
    ceiling.
  - **The connections list** shows each connection's "acts as" and level, editable in place, with
    overrides as in 5.2.

- [ ] Steps: test, implement, typecheck, commit.

---

## After wave 2: project manager

- **Turn `PAPERCLIP_UNIFIED_RUN_MCP` on by default** and retire `/api/mcp/project-tools`. That's a
  small agent; it touches the run code.
- **Check a real run on a local dev instance:** TES with an "M7 test" agent, never Bob, and the run
  finishing through the MCP tools.
- **The regression on `feat/step-4a`,** once step 3a's suite is ready.
- **Update the docs** (repo-map, hard-fork plan), then the user approves, then merge into `main`.

### Wave 1 status (2026-11-17)

**Regression runs wait for [step 3a](hard-fork-plan.md#3a-renovate-the-test-suite)** (renovating
the test suite). Building continues (decided 2026-11-18): agents run typechecks, their own new test
files one at a time, and `ui-new` unit tests, but no broad server suites. Handed off to a new
manager session on server1: [step-4a-handoff.md](step-4a-handoff.md).

All four branches are merged into `feat/step-4a`. Each agent's new tests passed. **The regression
runs were stopped at the user's request** (they're working on the test suite separately), so these
are still to do before `feat/step-4a` goes to `main`:

- Run the existing server tests on `feat/step-4a`: agent 1's grep list (149 files:
  `ls server/src/__tests__ | grep -iE "authoriz|access|permission|issue"`) plus the 69 hiring and
  assignment files, and agent 3's 226 heartbeat, recovery and completion files. **Expect fixture
  failures:** tests that insert agents without `permissions.access` now get `worker`; the fix is
  `access: { level: "manager" }` in the fixture.
- Re-run alone: `heartbeat-native-restart-suspension.test.ts` (2 of 115 failed) and
  `heartbeat/runtime-selection.test.ts` (6 of 82 failed), both dormant native paths that failed in an
  overloaded run. Skip with a note if they're real and dormant.
- Swap agent 2's route-policy stub (`server/src/mcp/catalog/route-policy.ts`) for the real
  `AGENT_ROUTE_POLICY` import.

Found in wave 1, to settle:

- **New agents that should hire (decided 2026-11-18, not built yet):** agents created after 0491
  start at `worker`, so a new CEO couldn't hire. Rule: a new agent with the CEO role starts at
  `manager` with the `agents:create` override; any new agent created with `canCreateAgents: true`
  gets the `agents:create` override.
- **The skill and the switch ship together:** the rewritten `paperclip` skill assumes the
  `paperclip` MCP server, which is off by default (`PAPERCLIP_UNIFIED_RUN_MCP`). Flip the default
  before `feat/step-4a` reaches `main`.
- **Continuing runs wake again:** agent 3 added a wake after a run ends with
  `report_progress` + `continue: true` (once per run, at most 10 in a row, then normal repair).
- **No checkout tool:** the skill relies on the harness checking out the run's task.
- `CONNECTION_INTENT_AGENT_GUIDANCE` (`packages/shared`) still tells every agent to use
  `search_api`/`call_api`, which are admin-only now.
- **One source of truth is narrower than the spec:** agents still use `principal_permission_grants`
  for keys with no access action (`tools:*`, `inbox:manage`, `skills:*`,
  `tasks:manage_active_checkouts`, `agents:read`, `agents:suggest-changes`).
- `mcp_oauth_grants` already has `agent_id` and purpose `"agent"`; wave 2 settles how they relate to
  the new `act_as_agent_id`.
- Agent-side interaction checks in `agent-interaction-policy.ts` are redundant after 0491; remove in
  a cleanup.

Carried over from wave 1, to fold into the spec when wave 2 is planned:

- `paperclip_search_api` needs `api:raw` (not `tasks:read`): it only lists what `call_api` can
  reach. The run tools and `call_api` are not requestable.
- `call_api` operation ids are `"METHOD /path"`; the OpenAPI document has no `operationId`s.
- After agent 1 merges, agent 2 adds rename and recolour to `paperclip_manage_labels` (it creates
  and deletes only until `PATCH /labels/:labelId` exists).
