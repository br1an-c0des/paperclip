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
| 2 | Requests and outside connections | 4.x | planned after wave 1 merges |
| 2 | `ui-new` | 5.x | planned after wave 1 merges |

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

## Wave 2 (planned after wave 1 merges)

- **Agent 4, requests and outside connections:** `permission_request` creation on a requestable
  denial and replay through a one-use temporary grant (spec section 7); the public MCP resolving
  OAuth grants to `oauth_person` / `oauth_agent` callers and serving the catalog
  (`createPaperclipCatalog(catalogDeps(db))`; there's no `PAPERCLIP_CATALOG` constant); carrying
  over every public tool (spec section 4); "act as" and level on grants and the consent screen;
  retiring `capabilities.ts`/`expanded-capabilities.ts` lists. Also: refuse direct creation of
  `permission_request` approvals through `POST` approvals (today `createApprovalSchema` accepts the
  type from anyone who can create approvals); and make sure the public MCP's in-process dispatch
  passes through the agent route policy, as the catalog's does.
- **Agent 5, `ui-new`:** the Permissions section (level and overrides), outside-connection settings,
  the Inbox permission request card (spec section 8), a label for `permission_request` in the
  approval label maps (`ui-new/src/inbox/row-model.ts:110`, `ui-new/src/requests/request-model.ts:617`),
  and **renaming and recolouring labels** through `PATCH /labels/:labelId` (added by agent 1 on the
  user's request, 2026-11-17).
- **Project manager:** flip `PAPERCLIP_UNIFIED_RUN_MCP` on by default, retire
  `/api/mcp/project-tools`, the local-instance run check, docs.

Carried over from wave 1, to fold into the spec when wave 2 is planned:

- `paperclip_search_api` needs `api:raw` (not `tasks:read`): it only lists what `call_api` can
  reach. The run tools and `call_api` are not requestable.
- `call_api` operation ids are `"METHOD /path"`; the OpenAPI document has no `operationId`s.
- After agent 1 merges, agent 2 adds rename and recolour to `paperclip_manage_labels` (it creates
  and deletes only until `PATCH /labels/:labelId` exists).
