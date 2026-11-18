# Step 4a handoff (2026-11-18)

For the manager session that takes over step 4a (Paperclip over MCP, with agent permissions) on
server1. The first manager session designed it, planned it, ran wave 0 and wave 1, and merged them
into `feat/step-4a`. This page is where that stands and what's next. Read it with:

1. [CLAUDE.md](../CLAUDE.md): the repo's rules (hard fork, branches, migrations, testing).
2. [step-4a-mcp-and-permissions.md](step-4a-mcp-and-permissions.md): the approved design.
3. [step-4a-plan.md](step-4a-plan.md): the implementation plan. Its **Wave 1 status** and **Wave 2**
   sections list what's open.
4. [.claude/skills/pm/SKILL.md](../.claude/skills/pm/SKILL.md): how the manager role works here
   (propose each agent first, 3–5 at most, agents build and the manager reviews and merges). Written
   for `ui-new`, but the same pattern ran this step.

## Branches

All pushed to `origin` on 2026-11-18.

| Branch | Tip | What |
| --- | --- | --- |
| `feat/step-4a` | `39028db27e` | Integration branch, cut from `main` at `63de421372`. Wave 0 and wave 1 merged with `--no-ff`. Merges into `main` only after the full regression passes and the user approves. |
| `step4a/contracts` | `948a8328c1` | Wave 0: shared access model, catalog types, run disposition. Merged. |
| `step4a/mcp` | `68d94b9464` | Agent 2: the MCP endpoint and tool catalog. Merged. |
| `step4a/runs` | `37f0621efb` | Agent 3: completion rule, run MCP switch, the `paperclip` skill rewrite. Merged. |
| `step4a/permissions` | `1a336833c6` | Agent 1: access enforcement, route policy, temporary grants, migration 0491, `PATCH /labels/:labelId`. Merged. |

`feat/step-4a` doesn't have `main`'s commits since `63de421372`: the step 4a doc updates and step
3a's test-suite work (another session). Merge `main` into it (never rebase) before wave 2 if you want
the newest docs and 3a's test changes there.

## What's built (on `feat/step-4a`)

**Wave 0, contracts.**
- `packages/shared/src/agent-access.ts`: `AGENT_ACCESS_ACTIONS` (13), `AGENT_ACCESS_LEVELS`
  (`read_only`, `worker`, `manager`, `admin`), `AGENT_ACCESS_LEVEL_ACTIONS`, `resolveAgentAccess`,
  `capAgentAccess`, `hasAgentAccess`, `agentAccessSchema`, and the default-level constants.
- `packages/shared/src/run-disposition.ts` and `permission-request.ts`; `"permission_request"` is in
  `APPROVAL_TYPES`.
- `server/src/mcp/catalog/types.ts` (`McpCaller`, `CatalogDispatch`, `PaperclipTool`) and
  `tool-names.ts` (25 names).
- `server/src/services/heartbeat/run-disposition.ts`: `recordRunDisposition` (the first one wins,
  stored in `heartbeat_runs.result_json.paperclipDisposition`) and `readRunDisposition`.

**Agent 1, permissions core.**
- `server/src/services/agent-access.ts`:
  - `loadAgentAccess(db, agentId)`;
  - `grantTemporaryAccess(db, { companyId, principal, action, resource, expiresAt, reason, usesLeft? })`;
  - `consumeTemporaryAccess(db, { companyId, principal, action, resource })`;
  - `withAccessOverride`, `isAgentAccessAction`.
- Table `temporary_access_grants`.
- `authorization.ts`:
  - `decide` checks the level and overrides, then temporary grants, then denies with
    `reason: "access_level"` and a `missingAction`;
  - `accessDeniedBody()` gives the 403 body `{ error, code: "access_denied", missingAction, requestable }`.
- **"Own" tasks:** the assignee or creator is the agent or in its reporting subtree, on the task or
  any ancestor. A worker may assign a subtask of its own task.
- **Route policy:**
  - `server/src/middleware/agent-route-policy.ts` and `agent-route-policy-table.ts`
    (`AGENT_ROUTE_POLICY`, `matchAgentRoutePolicy`, `agentRouteRequirement`);
  - mounted as `api.use(agentRoutePolicy(db))` **inside** the `api` Router, so in-process dispatch
    goes through it;
  - 609 write routes tagged: 96 `route_checks`, 306 `api:raw`, the rest by action;
  - a test fails on any untagged `/api` write in the OpenAPI document.
- **Migration `0491_agent_access.sql`:**
  - every existing agent gets `permissions.access` at `manager`, carrying over hiring,
    configure-others and assignment grants and the actor-side interaction switches turned off;
  - `mcp_oauth_grants` gets `act_as_agent_id`, `access_level` and `access_overrides`;
  - existing grants get a level from their consent (configure → admin, write → manager, else
    read-only).
- **`PATCH /agents/:id/permissions`** takes `access`, from people only. The agent grant keys that
  became actions return 410 `agent_grant_retired`.
- **`PATCH /labels/:labelId`** (rename and recolour, added on the user's request): a clash returns
  409 `label_name_taken`, and it's logged as `label.updated`.

**Agent 2, MCP endpoint and catalog.**
- **`POST /api/mcp/paperclip`:**
  - stateless JSON-RPC (`server/src/routes/paperclip-mcp.ts`, `server/src/mcp/server.ts`);
  - takes run tokens and agent API keys (`resolveMcpCaller`);
  - `GET` returns 405.
- **`createCatalogDispatch(api, caller, { parentLocals, middleware })`** re-enters the API in-process
  as the caller. A non-2xx answer throws `McpToolError { status, code, missingAction?, requestable? }`.
- **The catalog is `createPaperclipCatalog(catalogDeps(db))`;** there's no `PAPERCLIP_CATALOG`
  constant.
- **25 tools:**
  - a worker run sees 19, plus 4 marked "Needs approval.";
  - about 3k tokens for the definitions;
  - action, `needsRun` and `requestable` per tool are in agent 2's report, summarised in the plan's
    "Carried over" list.
- **The route-policy stub:** `server/src/mcp/catalog/route-policy.ts` still uses a local empty table.
  **Swap it for the real import** (a follow-up below).

**Agent 3, runs.**
- **The completion rule:** `settleRunDisposition` in `run-completion.ts`.
  - A run is covered by a recorded disposition, or by its task ending `done`, `in_review` or
    `blocked` by any route (recorded as `task_state`).
  - Otherwise it goes to the existing missing-disposition recovery.
  - Exempt: chat turns, runs without a task, wakes on a done or cancelled task.
  - The final `result_json` write keeps `paperclipDisposition`.
  - Recovery (`legacy-continuation.ts`, `service.ts`, `run-result-read.ts`) agrees with the rule.
- **Addition beyond the plan:** a run ending "continuing" (`report_progress` with `continue: true`)
  queues one continuation wake. That's once per run, and after 10 in a row the run goes to the normal
  repair.
- **`PAPERCLIP_UNIFIED_RUN_MCP=1`** gives a run one `paperclip` server at `/api/mcp/paperclip`
  (`server/src/services/heartbeat/paperclip-run-mcp.ts`). It's **off by default**.
- **`skills/paperclip/SKILL.md`** is rewritten without curl: 809 lines down to 91.
  `paperclip-skill-tools.test.ts` checks every tool name. When the switch is on, the ACP prompt's API
  note points at the tools.

## Decided since the plan was written

| Decision | Where it stands |
| --- | --- |
| Add `PATCH /labels/:labelId` for renaming | Built (agent 1) |
| Label renaming in `ui-new` | Wave 2, agent 5 (in the plan) |
| A new CEO starts at `manager` with `agents:create`; any new agent created with `canCreateAgents: true` gets `agents:create` | Decided 2026-11-18, **not built**: a follow-up below |
| Building continues while step 3a renovates the test suite: typechecks, each agent's own new test files one at a time, and `ui-new` unit tests; no broad server suites | Decided 2026-11-18 |
| Step 4a moves to a manager session on server1 | This handoff |

Calls the wave 1 agents made, to fold into the spec when wave 2 is planned (also in the plan):
- `paperclip_search_api` needs `api:raw`, like `call_api`. The run tools and `call_api` aren't
  requestable.
- `call_api` operation ids are `"METHOD /path"`; the OpenAPI document has no `operationId`s.
- The interaction switches: 4 of the 6 actor-side ones fold into actions. `canCommentOnOtherTasks`
  and `canMentionAgents` stay as switches.
- **"One source of truth" is narrower than the spec:** agents still use
  `principal_permission_grants` for keys with no access action (`tools:*`, `inbox:manage`,
  `skills:*`, `tasks:manage_active_checkouts`, `agents:read`, `agents:suggest-changes`).
- The task-watchdog scope stays computed per request, not a temporary grant.

## What's next, in order

1. **Follow-ups, one small agent:**
   - swap the route-policy stub for `AGENT_ROUTE_POLICY`;
   - rename and recolour in `paperclip_manage_labels`, through `PATCH /labels/:labelId`;
   - the new-CEO rule above, in agent creation and hiring;
   - `CONNECTION_INTENT_AGENT_GUIDANCE` (`packages/shared`) stops telling every agent to use
     `search_api`/`call_api`, which are admin-only now.
2. **Plan wave 2 in detail** in the plan (tasks 4.x and 5.x, in the same style as wave 1) and fold the
   agents' calls into the spec. Scope is in the plan's Wave 2 section:
   - **Agent 4, requests and outside connections:**
     - `permission_request` on a requestable denial, and replay through a one-use temporary grant;
     - refuse direct creation of that approval type;
     - the public MCP serving the catalog for OAuth callers ("as me" and "as agent"), with every
       public tool carried over and a level on grants and the consent screen;
     - settle `mcp_oauth_grants.agent_id` / purpose `"agent"` against the new `act_as_agent_id`;
     - make the public MCP's dispatch pass through the route policy.
   - **Agent 5, `ui-new`:**
     - the Permissions section (level and overrides);
     - outside-connection settings;
     - the Inbox permission request card and a `permission_request` label;
     - label rename and recolour.
3. **Propose and run wave 2,** then merge.
4. **When step 3a's faster suite is ready, the regression on `feat/step-4a`:**
   - agent 1's lists (149 access, permission and issue files, plus 69 hiring and assignment files);
   - agent 3's 226 heartbeat, recovery and completion files;
   - two dormant native tests to re-run alone (`heartbeat-native-restart-suspension`,
     `heartbeat/runtime-selection`).
   
   Expect fixture failures from agents inserted without `permissions.access` (now `worker`): give
   them `access: { level: "manager" }`.
5. **Before `main`:**
   - turn `PAPERCLIP_UNIFIED_RUN_MCP` on by default, since the new skill needs it, and retire
     `/api/mcp/project-tools`;
   - check on a local dev instance (company TES, "M7 test" agents, never Bob) that a real run works
     through the MCP tools and finishes;
   - update [repo-map.md](repo-map.md) and the hard-fork plan;
   - the user approves, then merge `--no-ff` into `main`.
6. **Deploying to server1's real instance is on hold** until the user asks. Migration 0491 needs a
   database backup first.

## Working on server1

- server1 **is the real instance.** `~/paperclip` is the deploy checkout and `~/paperclip-data` its
  data, behind the `paperclip-server-1` and `paperclip-db-1` containers. Don't build, test or run dev
  servers there, and don't touch ports 3100 or 3200. Use a separate clone.
- **Node:** nvm has Node 26 as the default, but the repo wants Node 24 (`.nvmrc`), and Node 26
  doesn't ship corepack. `nvm install 24` (or `nvm use 24` in the clone) gives `corepack pnpm`.
- **Already installed:** Claude Code (signed in) and `gh` (signed in as the repo owner), so agents can
  push.
- **Resource limits:** systemd user scopes with the memory and CPU controllers work there
  (`systemd-run --user --scope -p MemoryMax=… -p CPUQuota=…`). The machine has 20 CPUs and 14 GB of
  memory, shared with the real instance.
- **A fresh clone or worktree** needs `corepack pnpm install` and
  `corepack pnpm --filter @paperclipai/plugin-sdk build`, or the server dies with "does not provide an
  export named …".
- **A local dev instance** for the final check would need its own ports and data folder, away from
  the real one, or happen on the desktop instead.

## Lessons from wave 1

- **Briefs that worked:**
  - the base check (`git merge-base --is-ancestor feat/step-4a HEAD || git reset --hard feat/step-4a`,
    since worktrees can start from `master`);
  - the files the agent owns, and those it must not touch;
  - the plan's tasks by number;
  - "commit, don't push or merge";
  - a report listing exports, deviations and the checks run.
- **Don't let agents run broad suites.** The full suite takes about 7.6 hours on the desktop, and the
  agents' 150–230-file runs hit 50-minute timeouts and starved the machine. Name the test files they
  may run.
- **Relay facts between parallel agents** with a message while they run: agent 2's dispatch finding
  changed where agent 1 mounted the policy.
- **Merging without a checkout:**
  `git merge-tree --write-tree feat/step-4a <branch>`, then `git commit-tree` with both parents and
  `git branch -f`. This keeps the main checkout, where the dev servers run, untouched.
- **The desktop's finished worktrees** are under `.claude/worktrees/agent-*`. They can be removed
  (`git worktree unlock` first if locked) now the branches are pushed.
