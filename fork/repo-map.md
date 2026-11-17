# Repo map

A map of the whole repo for finding your way around: what each area is, where features live, which
tests cover what, and how much each area matters to this setup (one instance, Claude agents on
`claude_local`, the `ui-new` board).

Measured 2026-11-17 at `955c81d2f` (one commit after `upstream-freeze`). Sizes are approximate:
non-test TypeScript/JavaScript lines and files (`find` + `wc`, tests are `*.test.*`, `*.spec.*`,
`__tests__/`, `test/`, `e2e/`). For the path of one `claude_local` run from wake to finish in depth,
see [claude-local-run.md](claude-local-run.md); this map only points at it.

Upstream keeps its own capability maps in [maps/](../maps/README.md) (feature map + agent access
map, per capability). They're upstream's and may drift, but they're a good second index.

## Contents

- [Labels](#labels)
- [1. Top level](#1-top-level)
- [2. The server in depth](#2-the-server-in-depth)
- [3. Where features live](#3-where-features-live)
- [4. Dormant code wired into shared core: the seams](#4-dormant-code-wired-into-shared-core-the-seams)
- [5. Tests](#5-tests)
- [6. Experimental flags](#6-experimental-flags)

## Labels

| Label | Meaning | Rule |
| --- | --- | --- |
| **Ours** | Used, and the owner will change it | Change freely; keep its tests passing |
| **Shared core** | Used, but tangled with dormant features | Change carefully; expect dormant imports and tests nearby |
| **Dormant** | Not used by this setup | Leave alone. A test broken by a shared change gets skipped with a note (hard-fork [step 3](hard-fork-plan.md#3-leave-unused-code-until-it-gets-in-the-way)) |

A "?" after a label means a borderline call; the note says why.

## 1. Top level

### Apps and packages

| Path | What it is | Src files / lines | Test files | Label |
| --- | --- | --- | --- | --- |
| [server/](../server/) | Express API + orchestration (heartbeat, runs, issues, everything) | 2,233 / ~717k (`server/src`) | ~2,330 | **Shared core** (see [§2](#2-the-server-in-depth)) |
| [ui-new/](../ui-new/README.md) | The new SolidJS board | 692 / ~160k | 296 (vitest + Playwright) | **Ours** |
| [ui/](../ui/) | Old React board, not deployed; reference for API use | 2,266 / ~496k | 998 | **Dormant** (reference) |
| [cli/](../cli/) | `paperclipai` CLI: onboard, run, doctor, worktree, db-backup, routines, mcp, managed-agent | 106 / ~30k | 68 | **Dormant?** The deploy runs `server/dist-runtime/index.mjs`, not the CLI; dev uses `pnpm dev` |
| [packages/db/](../packages/db/) | Drizzle schema (192 files in `schema/`), 490 migrations, clients, backup, embedded-Postgres test helper | 234 / ~23k | 88 | **Shared core**: schema holds dormant tables too; migrations are ours from `0491` |
| [packages/shared/](../packages/shared/) | Types, validators, constants, API paths, feature catalog, experimental-flag schema | 280 / ~53k | 109 | **Shared core**: `ui-new` imports its types |
| [packages/adapter-utils/](../packages/adapter-utils/) | Adapter helpers: wake-prompt renderer and child-process runner (`server-utils.ts`, 5.1k), `acpx-engine/` (ACP) | 85 / ~39k | 93 | **Shared core**: `server-utils.ts` is ours; `acpx-engine/` dormant |
| [packages/adapters/claude-local/](../packages/adapters/claude-local/) | The `claude_local` adapter: `execute.ts` (1.5k), `claude-config.ts` (MCP config), `prompt-cache.ts` (skill bundle), `parse.ts` | 28 / ~7.8k | 24 | **Ours** (its `acp.ts` and `setup-token-*` are dormant paths) |
| [packages/adapters/*](../packages/adapters/) (11 others) | codex-local 9.8k, hermes 4.5k, gemini-local, grok-local, cursor-local, opencode-local, pi-local, kimi-local, openclaw-gateway, cursor-cloud, hermes-gateway | 179 / ~34k | 94 | **Dormant**, but the server's adapter registry imports every one ([seams](#4-dormant-code-wired-into-shared-core-the-seams)) |
| [packages/paperclip-runner/](../packages/paperclip-runner/) | The Paperclip Runner: Rust daemon `runner/` (~117k lines .rs), TS drivers/protocol/SDK `src/`, PRP schemas `protocol/` | 677 / ~171k TS + ~117k Rust | 466 | **Dormant** |
| [packages/plugins/sdk/](../packages/plugins/sdk/) | Plugin SDK; the server's plugin host imports it in 53 files | 29 / ~16k | 23 | **Shared core** (no plugin is needed, but types run through core routes) |
| [packages/plugins/*](../packages/plugins/) (rest) | sandbox-providers (9 providers, ~19k), plugin-llm-wiki (~14k), examples, workspace-diff, fake-sandbox, create-paperclip-plugin | 148 / ~42k | 72 | **Dormant** |
| [packages/mcp-server/](../packages/mcp-server/) | Standalone stdio MCP server, ~40 tools over REST (`tools.ts`, 691) | 7 / ~0.9k | 1 | **Dormant**; a reference for step 4's tool set |
| [packages/skills-catalog/](../packages/skills-catalog/), [teams-catalog/](../packages/teams-catalog/) | App-shipped skill and team catalogs (server imports them in 3 files) | 14 / ~2.3k | 7 | **Dormant** |
| [packages/google-sheets-mcp-server/](../packages/google-sheets-mcp-server/), [kv-demo-mcp-server/](../packages/kv-demo-mcp-server/), [paperclip-eval-kernel/](../packages/paperclip-eval-kernel/), [tailscale-https-broker/](../packages/tailscale-https-broker/) | Demo/aux packages; nothing in `server/src` or `cli/src` imports them | 44 / ~5.2k | 22 | **Dormant** |

### Content, tooling and docs

| Path | What it is | Label |
| --- | --- | --- |
| [skills/](../skills/) | Bundled runtime skills. `paperclip` (809-line SKILL.md + references), `paperclip-board`, `paperclip-create-agent`, `paperclip-converting-plans-to-tasks`, `para-memory-files` are copied into every company's skill library; `agentmail`, `slack`, `complain`, `suggestion-box` are not core | **Ours** (the five core skills); rest **Dormant** |
| [tests/](../tests/) | Cross-package suites: Playwright `e2e/` (old UI), `runner-e2e/`, `runner-acceptance/`, `restart-chaos/`, `release-smoke/`, `perf/`, `storybook-visual/`… (~2,200 files) | Mostly **Dormant** ([§5](#5-tests)) |
| [scripts/](../scripts/) | Repo tooling: `run-vitest-stable.mjs`, `local-verify.mjs` (`pnpm verify`), `agent-preflight.mjs`, migration/release/check scripts (284 files, ~52k lines) | **Shared core** (dev tooling); release scripts dormant |
| [deploy/](../deploy/README.md) | Our server1 deployment: Dockerfile on upstream's image + `ui-new`, Compose, `deploy.sh`, image patches | **Ours** |
| [fork/](.) | Hard-fork docs: [plan](hard-fork-plan.md), [bug list](upstream-fixes.md), [upstream watch ledger](upstream-watch.md), sync reports, this map | **Ours** |
| [Dockerfile](../Dockerfile) | Upstream's full image build (builds the Rust Runner and agent CLIs) | **Shared core?** Step 2 starts from it |
| [docker/](../docker/) | Upstream's other images and smoke stacks (runner image, daytona, openclaw, hermes, quadlet, ECS) | **Dormant** |
| [patches/](../patches/) | pnpm patches for deps: `embedded-postgres`, `postgres`, `brace-expansion` (used); acpx, ACP agents, chat adapters (dormant) | **Shared core** |
| [doc/](../doc/) | Upstream's product and ops docs (~790 files): `DEVELOPING.md`, `DATABASE.md`, `test-infrastructure.md`, `AGENT-LIFECYCLE.md`, `public-mcp.md`, plans | Reference; can be stale |
| [docs/](../docs/) | Upstream's public docs site (Mintlify, 140 files) | **Dormant** |
| [maps/](../maps/README.md) | Upstream's feature map and agent access map (36 areas each) | Reference |
| [rules/](../rules/) | Upstream's review rules (`*.mdc`): module boundaries, heartbeat execution boundaries, migrations | Reference |
| [AGENTS.md](../AGENTS.md), [CLAUDE.md](../CLAUDE.md), [FORK.md](../FORK.md), [FORK-PATCHES.md](../FORK-PATCHES.md) | Repo instructions | **Ours** |
| `evals/` (promptfoo), `tools/agent-shim/` (Go), `integrations/assistant-plugins/`, `releases/`, `skills-releases/`, `announcements/`, `report/`, `screenshots/`, `.github/` | Upstream release, eval and CI material | **Dormant** |

## 2. The server in depth

`server/src` at a glance:

| Folder | Files / lines | What |
| --- | --- | --- |
| [services/](../server/src/services/) | 1,863 / ~585k | Everything with logic. 1,025 flat files (~349k) plus subfolders below |
| [routes/](../server/src/routes/) | 106 / ~85k | Express routers, mounted in [routes/index.ts](../server/src/routes/index.ts) and [app.ts](../server/src/app.ts) (1.5k) |
| [modules/](../server/src/modules/README.md) | 63 / ~13.5k | Layered feature modules (domain → application → adapters): `wake-queue`, `run-dispatch`, `active-run-watchdog`, `agent-lifecycle`, `execution-admission`, `external-agents` |
| [middleware/](../server/src/middleware/) | 28 / ~4.3k | `auth.ts` (actor resolution: board session, run JWT, API keys), `agent-run-authentication.ts`, `board-mutation-guard.ts`, cloud tenant middleware (dormant) |
| [realtime/](../server/src/realtime/) | 9 / ~2.5k | `live-events-ws.ts` (board live events), `plugin-api-ws.ts`, `runner-prp-ws.ts` (Runner, dormant) |
| [adapters/](../server/src/adapters/) | 17 / ~2.7k | Adapter registry ([registry.ts](../server/src/adapters/registry.ts), 1.3k: `getServerAdapter`), process/http adapters |
| `auth/`, `secrets/`, `storage/`, `lib/` | ~6.4k | Better Auth setup, secret providers (local encrypted, AWS), blob storage (local disk, S3), small helpers |
| [index.ts](../server/src/index.ts) (2.5k) | | Startup: DB, migrations, schedulers (heartbeat timers, routines tick), ~15 native-runtime background workers |
| `google-workspace-rest-tools/`, `vendor/paperclip-runner/` | ~3.8k | Google Workspace connector tools (dormant); the shim through which the server loads the Runner package |

`services/` subfolders: `native-runtime/` (289 files, 88k), `chat-channels/` (212, 49k), `heartbeat/`
(60, 42k), `tool-access/` (82, 21k), `recovery/` (45, 16.5k), `connectors/` (51, 6.6k), `public-mcp/`
(40, 4k), `voice/` (30, 3.2k), `photon/` (8, 2.1k), `runtime-exposure/` (6, 1.5k), `posthog-direct/`,
`grok-bot/`.

### Subsystems

Sizes are services + routes, non-test. "Giant" files (over ~3k lines) are bold. All paths under
`server/src/` unless noted.

| Subsystem | What it does | Key files | Size | Depends on | Label |
| --- | --- | --- | --- | --- | --- |
| **Tasks / issues** | Issue CRUD, comments, checkout, assignment, blockers, relations, thread interactions (question/confirm/suggest cards), execution policy, tree pause/resume, watchdogs | **`routes/issues.ts` (21.5k)**, **`services/issues.ts` (15k)**, **`issue-thread-interactions.ts` (6k)**, `task-watchdogs.ts`, `issue-tree-control.ts`, `issue-execution-policy.ts`, `issue-comment-wakeup.ts`, `issue-assignment-wakeup.ts`, `issue-visibility.ts` | ~54 files, ~34k + 22k routes | heartbeat, activity, live events, recovery, conversations | **Shared core**: used daily, but both giants import native-runtime (7 and 10 modules) |
| **Heartbeat and wakes** | Wake requests → queued `heartbeat_runs` → claim → admission/budget/pause gates → run lifecycle; timers | **`heartbeat.ts` (4.9k)**, `heartbeat/` (**`queue.ts` 5.9k**, **`workspaces.ts` 3.8k**, **`run-preparation.ts` 3.3k**, **`recovery.ts` 3.3k**, **`run-lifecycle.ts` 3.2k**, `retries.ts`, `run-state.ts`, `run-control.ts`, `run-completion.ts`, `runtime-selection.ts`, `runtime-execution.ts`), `modules/wake-queue`, `modules/run-dispatch`, `modules/active-run-watchdog`, `idle-*.ts`, `queued-*.ts` | ~62k | issues, adapters, recovery, environments, budgets, native-runtime | **Shared core**: every run passes through; the most tangled area (28 of 60 `heartbeat/` files import native-runtime) |
| **Run execution and recovery** | Cancellation, process settlement, liveness, continuation after interruption, recovery holds, ownership sweeps, run logs | **`recovery/service.ts` (7k)**, `recovery/` (44 files), `heartbeat/recovery.ts`, `heartbeat/process-settlement.ts`, `heartbeat/legacy-process-settlement.ts`, `recovery/legacy-*.ts`, `execution-recovery-resolution.ts`, `fresh-continuation-fallback.ts`, `run-log-store.ts`, `run-cancellation.ts` | ~27k | heartbeat, issues | **Shared core**; the `native-*` and `explicit-native-continuation.ts` parts are **Dormant** |
| **Adapters and prompt assembly** | Adapter registry; the wake payload; the prompt the adapter renders | `adapters/registry.ts`, `heartbeat/run-preparation.ts` (`buildPaperclipWakePayload`), `heartbeat/task-context.ts`, `heartbeat/execution-configuration.ts`, `packages/adapter-utils/src/server-utils.ts` (`renderPaperclipWakePrompt`, `selectPaperclipPromptSections`), `packages/adapters/claude-local/src/server/execute.ts` | ~3k server + adapter packages | heartbeat, company skills, tool access | **Ours** for the `claude_local` path (steps 4–5); other adapters in the registry **Dormant** |
| **Agent chat (conversation mode)** | Chat is an issue with `conversationAgentId/UserId/State`, kept out of work queues; Conference Room spawns `claude` directly | `agent-conversations.ts`, `conversation-*.ts`, `durable-chat-wakeup.ts`, `agent-chat-messages.ts`, `heartbeat/conversation-events.ts`, `routes/issues.ts` (`/companies/:id/chats…`, ~line 19898), `routes/board-chat.ts` | ~3k + parts of issues/heartbeat | issues, heartbeat, recovery | **Ours** (step 6 replaces it) |
| **Fast responses** | Quick acknowledgement from a fast model before an agent's turn | `fast-responses.ts`, `fast-response-provider.ts` | ~1.7k | chat, issues | **Shared core?** Behind `enableFastResponses` (off) |
| **Questions and decisions to the board** | Approvals, decisions and queues, attention feed, inbox dismissals, question answers delivered back to a run | **`attention.ts` (3.3k)**, `question-response-delivery.ts`, `decision-queues.ts`, `decisions.ts`, `approvals.ts`, `board-auth.ts`; routes `approvals.ts`, `attention.ts`, `decision*.ts`, `inbox-*.ts` | 43 files, ~11k | issues, activity | **Ours** (`question-response-delivery.ts` imports the Runner shim) |
| **Documents and artifacts** | Issue documents, revisions, annotations, artifact docs, workspace file resources, attachments, blob storage | `documents.ts`, `document-annotations.ts`, `company-artifacts.ts`, `workspace-file-resources.ts`, `routes/file-resources.ts`, `routes/assets.ts`, attachment routes in `routes/issues.ts`, `storage/` | ~7k | issues, storage | **Ours** |
| **Projects, workspaces, git** | Projects and repos, execution workspaces (per-task worktrees), workspace runtime services, git restore/recovery, GitHub | **`workspace-runtime.ts` (9.4k)**, **`execution-workspaces.ts` (5.6k)**, `projects.ts`, `workspace-operations.ts`, `git-workspace-restoration.ts`, `workspace-recovery.ts`, `routes/projects.ts`, `routes/execution-workspaces.ts` | 101 files, ~43k (of which ~7.8k `remote-workspace*`) | environments, tool access, plugins | **Shared core**: local worktrees are ours, tangled with remote/isolated/plugin workspaces |
| **Routines** | Scheduled and manual routines that create tasks and wake agents | **`routines.ts` (3.4k)**, `cron.ts`, `routine-*.ts`, `routes/routines.ts`; tick from `index.ts` | ~4.5k | issues, heartbeat | **Ours** |
| **Agents** | Agent CRUD, config, permissions, instructions, avatars, hiring, runner choice | **`routes/agents.ts` (8k)**, `agent-*.ts` (~55 files), `agents.ts`, `modules/agent-lifecycle`, `agent-runner-selection.ts`, `built-in-agents.ts` (2.2k, dormant) | ~20k | heartbeat, adapters, skills | **Shared core** (`routes/agents.ts` has 27 dormant imports) |
| **Goals, activity, dashboard** | Goals; activity log (`logActivity` → live events); dashboard counts | `goals.ts`, `activity-log.ts`, `activity.ts`, `dashboard*.ts`, `live-events.ts` | ~1.5k | — | **Ours** (clean, no dormant imports) |
| **Status cards** | Board status cards generated by hidden tasks | `status-cards.ts`, `status-card-*.ts`, `routes/status-cards.ts` | ~1.9k | issues, heartbeat | **Ours?** Behind `enableStatusCards`; no dormant imports |
| **Cases** | Case boards and handoffs | `case-*.ts` (14), `routes/cases.ts`, `cases-disabled.ts` | ~3.7k | issues, Runner shim | **Dormant?** Behind `enableCases` (off); ui-new has a cases folder |
| **Company skills** | Company skill library, bundled skills sync, per-run skill entries | **`company-skills.ts` (7.6k)**, `skill-*.ts`, `routes/company-skills.ts` | ~13k | companies | **Shared core** (ours to slim in step 4; imports `managed-skill-content`) |
| **Companies and instance** | Company CRUD, instance settings (flags), onboarding, search | `companies.ts`, `instance-settings.ts`, `company-search.ts`, `onboarding-*.ts`, routes `companies.ts`, `instance-settings.ts` | ~6k | cloud-instance (dormant overlay) | **Shared core** |
| **Company portability, catalogs, feedback, telemetry** | Import/export, teams/skills catalogs, feedback sharing, PostHog/Sentry | **`company-portability.ts` (6.6k)**, `teams-catalog.ts`, `feedback.ts`, `telemetry.ts`, `sentry.ts`, `posthog-direct/` | ~12k | — | **Dormant** |
| **Auth and access** | Board sessions (Better Auth), API keys, run JWTs, memberships, authorization, invites, board/first-admin claim | **`authorization.ts` (3.2k)**, `access.ts`, `middleware/auth.ts`, `agent-auth-jwt.ts`, `auth/`, **`routes/access.ts` (4.7k)**, `routes/authz.ts` | ~12k | — | **Ours** (cloud tenant actors, `device-login-service.ts`, `setup-token-session.ts` are **Dormant**) |
| **Secrets** | Company secrets, providers, secret proposals | **`secrets.ts` (5.9k)**, `secret-*.ts`, `secrets/`, `routes/secrets.ts` | ~9k | connectors (Tailscale) | **Shared core** (local provider used; AWS dormant) |
| **Costs and budgets** | Cost events, budgets and enforcement, usage receipts, quotas | `budgets.ts`, `usage-receipts.ts`, `costs.ts`, `budget-*.ts`, `routes/costs.ts` | 19 files, ~4.5k | heartbeat (`createRunUsageRecorder`) | **Ours** |
| **Tool access and connections** | Tool connections, profiles, assignments; run-scoped MCP gateways; connection intents; AI connections | **`tool-gateway.ts` (14.3k)**, **`tool-access.ts` (5k)**, `tool-access-policy.ts`, `tool-access/` (82 files), `connection-intents.ts`, `ai-connections.ts`, `mcp-http.ts`, **`routes/tool-access.ts` (3.1k)**, `routes/tool-gateway.ts` | ~58k | heartbeat (`buildPaperclipRuntimeMcpServers` runs every run) | **Shared core**: called on every `claude_local` run but returns nothing without assigned connections; most of it **Dormant** for us |
| **Connectors** | App connectors: Slack, Tailscale, Vercel, 1Password… | `connectors/` (51 files) | ~6.6k | tool access | **Dormant** |
| **OpenAPI catalog** | The REST API's OpenAPI document (`GET /openapi.json`); feeds the Runner's `search_api`/`call_api` | **`routes/openapi.ts` (14k)** | 14k | — | **Shared core?** Step 4 plans `search_api`/`call_api` for MCP, which would reuse it |
| **Project tools MCP** | In-process MCP endpoint for "Paperclip projects" tools on `claude_local` runs | `routes/project-tools.ts`, `services/project-tools.ts` (tool list from the Runner's semantic catalog) | ~120 | Runner shim | **Ours** (step 4's starting point) |
| **Public MCP** | `/mcp/paperclip` for outside assistants over OAuth; Dot/Grok runner MCPs | `routes/public-mcp.ts`, `public-mcp/` | ~4.3k | — | **Dormant?** Behind `enablePublicMcp` (off); step 4's "same tools for people" may borrow from it |
| **Plugins host** | Plugin workers, loader, registry, host services, jobs, plugin UI and API websocket | **`plugin-worker-manager.ts` (4.3k)**, **`plugin-host-services.ts` (3.8k)**, `plugin-loader.ts`, `plugin-*.ts` (48), **`routes/plugins.ts` (3.3k)**, `routes/plugin-ui-static.ts` | ~27k | many core routes import `PluginWorkerManager` | **Shared core** (mostly unused, but threaded through approvals, costs, attention, workspaces routes) |
| **Environments** | Environment drivers (local, sandbox, plugin), run leases, custom images, execution targets | **`environment-runtime.ts` (4.8k)**, `environments.ts`, `environment-run-orchestrator.ts`, `environment-execution-target.ts`, `environment-custom-images.ts`, `routes/environments.ts` | ~16k | heartbeat `workspace-preparation.ts` | **Dormant**, except the local driver path every run takes (orchestrator → `createLocalEnvironmentDriver` → `kind:"local"`), which is **Shared core** |
| **Remote, sandbox, cloud** | Remote workspaces and transport, isolated task dirs, Paperclip Cloud connector/identity, Railway, Vercel, Tailscale exposure | `remote-*.ts` (30), `cloud-*.ts` (14), `sandbox-*.ts`, `isolated-*.ts`, `paperclip-cloud-connector.ts`, `runtime-exposure/`, `routes/cloud.ts` | ~17k | — | **Dormant** |
| **Native runtime (Runner)** | Server side of the Paperclip Runner: session executor, PRP coordinator, semantic tool authority, recovery, provider packs, workspace sync | **`native-runtime/native-session-executor.ts` (19.5k)**, **`paperclip-runner-tool-authority.ts` (3.5k)**, `runtime-mode.ts` (the dispatch decision), `realtime/runner-prp-ws.ts`, `routes/native-run-mcp.ts` | 289 files, ~88k | everything | **Dormant** ([seams](#4-dormant-code-wired-into-shared-core-the-seams)) |
| **Claude Managed** | Anthropic managed-agent profiles, run as a Runner provider | `managed-agent-profiles.ts`, `routes/managed-agent-profiles.ts`, `heartbeat/runtime-selection.ts` (loads the profile), `packages/db/src/schema/managed_agent_profiles.ts`, Rust `claude_managed_provider.rs` | ~0.5k server | Runner | **Dormant** |
| **External chat channels** | Slack, Teams, Discord, Telegram, GitHub review bots, iMessage, email channels | `chat-channels/` (212 files), **`chat-channels.ts` (3.7k)**, **`chat-sdk-runtime.ts` (3.3k)**, `chat-*.ts` (~92), `email-channels.ts`, `chat-question-forms.ts`, `routes/chat-channels.ts` | ~83k | heartbeat, issues | **Dormant** (wired into heartbeat; see seams) |
| **Other integrations** | Voice (Speko), Photon, Grok bot, Muse, Dot, browser-use, Google Workspace tools, AgentMail, smoke lab, customer success | `voice/`, `photon/`, `grok-bot/`, `modules/external-agents/`, `browser-use.ts`, `google-workspace-rest-tools/`, `smoke-lab.ts` | ~17k | — | **Dormant** |

## 3. Where features live

| Feature | Where | Notes |
| --- | --- | --- |
| Create / update a task | `POST /companies/:companyId/issues` and `PATCH /issues/:id` in [routes/issues.ts](../server/src/routes/issues.ts) → `issueService` in [services/issues.ts](../server/src/services/issues.ts) | Both call `queueIssueAssignmentWakeup` ([issue-assignment-wakeup.ts](../server/src/services/issue-assignment-wakeup.ts)) |
| Post a comment, wake the assignee | `POST /issues/:id/comments` in `routes/issues.ts` → `shouldWakeAssigneeForIssueComment` ([issue-comment-wakeup.ts](../server/src/services/issue-comment-wakeup.ts)) → `heartbeat.wakeup` | |
| Wake → run | `heartbeat.wakeup` = `trackWakeup` → `enqueueWakeup` ([heartbeat/queue.ts](../server/src/services/heartbeat/queue.ts)) inserts `agent_wakeup_requests` + queued `heartbeat_runs`, admits via [modules/wake-queue](../server/src/modules/wake-queue/) → `startNextQueuedRunForAgent` → `executeRun` in [heartbeat.ts](../server/src/services/heartbeat.ts) | Timers and resumes: `tickTimers`, `resumeQueuedRuns`, scheduler loop in [index.ts](../server/src/index.ts) |
| Legacy vs Runner decision | `resolveHeartbeatNativeRuntimeMode` ([native-runtime/runtime-mode.ts](../server/src/services/native-runtime/runtime-mode.ts)), called from `heartbeat.ts`; persisted on the run as `runtimeMode` | Any agent whose `adapterType` isn't `paperclip_runner` runs legacy, whatever `enableNativeRunner` says |
| Run execution | [heartbeat/runtime-selection.ts](../server/src/services/heartbeat/runtime-selection.ts) → [heartbeat/runtime-execution.ts](../server/src/services/heartbeat/runtime-execution.ts): legacy branch calls `adapter.execute()`; native branch calls `executePaperclipNativeSession` | In depth: [claude-local-run.md](claude-local-run.md) |
| Run prompt pieces | Wake payload: `buildPaperclipWakePayload` ([heartbeat/run-preparation.ts](../server/src/services/heartbeat/run-preparation.ts)), via `prepareHeartbeatTaskContext` ([heartbeat/task-context.ts](../server/src/services/heartbeat/task-context.ts)), merged in [heartbeat/execution-configuration.ts](../server/src/services/heartbeat/execution-configuration.ts). Rendering: `renderPaperclipWakePrompt` / `selectPaperclipPromptSections` ([adapter-utils server-utils.ts](../packages/adapter-utils/src/server-utils.ts)). Joining: [claude-local execute.ts](../packages/adapters/claude-local/src/server/execute.ts) (~line 934) | Agent instructions via `--append-system-prompt-file`; step 5 replaces this |
| `paperclip` skill → agents | [skills/paperclip/](../skills/paperclip/SKILL.md) → `ensureBundledSkills` / `PAPERCLIP_CORE_SKILL_KEYS` in [company-skills.ts](../server/src/services/company-skills.ts) (copied into each company library as `paperclipai/paperclip/<slug>`) → `listRuntimeSkillEntries` → `paperclipRuntimeSkills` in adapter config → claude-local [prompt-cache.ts](../packages/adapters/claude-local/src/server/prompt-cache.ts) writes `<bundle>/.claude/skills/` → `--add-dir <bundle>` | Also served at `/api/skills/paperclip` for invites ([routes/access.ts](../server/src/routes/access.ts)) |
| Run token / `PAPERCLIP_API_KEY` | Minted: `createLocalAgentJwt` ([agent-auth-jwt.ts](../server/src/agent-auth-jwt.ts)) from `heartbeat/runtime-execution.ts` (legacy runs only; needs `PAPERCLIP_AGENT_JWT_SECRET` or `BETTER_AUTH_SECRET`). Injected: claude-local `execute.ts` sets `env.PAPERCLIP_API_KEY`. Verified: `actorMiddleware` in [middleware/auth.ts](../server/src/middleware/auth.ts) → `verifyLocalAgentJwt`, run binding in [middleware/agent-run-authentication.ts](../server/src/middleware/agent-run-authentication.ts) | Separate `runtime-tools-token.ts` token for `/mcp/runtime-tools`. The Runner mints its own in `paperclip-runner-tool-authority.ts` |
| MCP config for a run | `createAdapterRuntimeMcpAccess` / `buildPaperclipRuntimeMcpServers` (`heartbeat/run-preparation.ts`) → `ctx.runtimeMcp` → `writePaperclipClaudeMcpConfig` ([claude-config.ts](../packages/adapters/claude-local/src/server/claude-config.ts)) → `--mcp-config … --strict-mcp-config` | |
| MCP: project tools | `POST /api/mcp/project-tools`: [routes/project-tools.ts](../server/src/routes/project-tools.ts), [services/project-tools.ts](../server/src/services/project-tools.ts) | Added to `claude_local` runs with an issue and a run JWT |
| MCP: runtime tools | `/mcp/runtime-tools` in [routes/connection-intents.ts](../server/src/routes/connection-intents.ts) | Adapters with `native_mcp` delivery, including `claude_local` |
| MCP: connection gateways | `/mcp/gateways/:id`: [routes/tool-gateway.ts](../server/src/routes/tool-gateway.ts), [services/tool-gateway.ts](../server/src/services/tool-gateway.ts) | Only when the agent has assigned connections |
| MCP: public | `/mcp/paperclip`: [routes/public-mcp.ts](../server/src/routes/public-mcp.ts), [services/public-mcp/](../server/src/services/public-mcp/), [doc/public-mcp.md](../doc/public-mcp.md) | Mounted only when configured; `enablePublicMcp` |
| MCP: Runner runs | `/mcp/native-runs/:runId`: [routes/native-run-mcp.ts](../server/src/routes/native-run-mcp.ts) | Dormant |
| MCP: standalone | [packages/mcp-server](../packages/mcp-server/) (stdio, `PAPERCLIP_API_URL`/`PAPERCLIP_API_KEY`) | Nothing in the server uses it |
| Approvals / requests | [routes/approvals.ts](../server/src/routes/approvals.ts), [services/approvals.ts](../server/src/services/approvals.ts); thread interaction cards in [issue-thread-interactions.ts](../server/src/services/issue-thread-interactions.ts); answers back to runs in [question-response-delivery.ts](../server/src/services/question-response-delivery.ts); decisions in `decisions.ts`, `decision-queues.ts` | ui-new: [ui-new/src/requests](../ui-new/src/requests/), [proposal](../ui-new/docs/proposals/unifying-requests.md) |
| Attention feed / inbox | [services/attention.ts](../server/src/services/attention.ts), [routes/attention.ts](../server/src/routes/attention.ts), `routes/inbox-*.ts` | ui-new: [ui-new/src/inbox](../ui-new/src/inbox/) |
| Chat (hidden-task chat) | Issue columns `conversationAgentId/UserId/State/…` ([db schema issues.ts](../packages/db/src/schema/issues.ts), ~line 32); `isConversation` in [agent-conversations.ts](../server/src/services/agent-conversations.ts); queue exclusion `executionIssueCondition` in [issue-visibility.ts](../server/src/services/issue-visibility.ts); routes `/companies/:id/chats…` in `routes/issues.ts` | Not `hiddenAt`: that's a separate flag used by status-card tasks. [Decision 8](../ui-new/docs/decisions.md#8-agent-chats-are-tasks-underneath) |
| Conference Room | [routes/board-chat.ts](../server/src/routes/board-chat.ts): spawns `claude` directly, no heartbeat run | `enableConferenceRoomChat` |
| Routines / schedules | [services/routines.ts](../server/src/services/routines.ts) (`tickScheduledTriggers`, `dispatchRoutineRun` → `queueIssueAssignmentWakeup`), [cron.ts](../server/src/services/cron.ts), tick called from `index.ts` | ui-new: [ui-new/src/recurring](../ui-new/src/recurring/) |
| Live events | Publish: `publishLiveEvent` ([services/live-events.ts](../server/src/services/live-events.ts), in-process EventEmitter), mostly via `publishActivity` in [activity-log.ts](../server/src/services/activity-log.ts). Serve: `/api/companies/:id/events/ws` in [realtime/live-events-ws.ts](../server/src/realtime/live-events-ws.ts) + [live-event-delivery.ts](../server/src/realtime/live-event-delivery.ts) | Single process; no pg NOTIFY |
| Run logs / transcripts | [run-log-store.ts](../server/src/services/run-log-store.ts), `heartbeat-run-events.ts`, claude-local [parse.ts](../packages/adapters/claude-local/src/server/parse.ts) | [Decision 15](../ui-new/docs/decisions.md#15-run-transcripts-use-the-adapter-packages-parsers-at-runtime) |
| Budgets | [budgets.ts](../server/src/services/budgets.ts), usage recorder in `heartbeat/runtime-execution.ts` | Hard-stop auto-pause is an invariant (AGENTS.md) |
| Hiring and runner choice | `agent-runner-selection.ts` (`agentRunnerAvailability`, picks `paperclip_runner` vs `claude_local`), `modules/agent-lifecycle`, `routes/agents.ts` | See [surprises](#notes-and-surprises) |
| Migrations | [packages/db/src/migrations](../packages/db/src/migrations/) (last upstream `0490_nappy_chat.sql`; ours start at `0491`), runner `packages/db/src/migrate.ts`, schema `packages/db/src/schema/` | [doc/DATABASE.md](../doc/DATABASE.md): edit schema → `pnpm db:generate` |
| Experimental flags | Schema `instanceExperimentalSettingsSchema` in [packages/shared/src/validators/instance.ts](../packages/shared/src/validators/instance.ts); catalog [feature-catalog.ts](../packages/shared/src/feature-catalog.ts); server read via `getExperimental()` in [services/instance-settings.ts](../server/src/services/instance-settings.ts) (managed overlay in `cloud-instance.ts`) | [§6](#6-experimental-flags) |
| Startup and background workers | [index.ts](../server/src/index.ts), [app.ts](../server/src/app.ts), [http/server.ts](../server/src/http/server.ts) | Registers native-runtime workers and the PRP websocket unconditionally |

## 4. Dormant code wired into shared core: the seams

About **196 non-test files** outside `native-runtime/` import the Runner side (`native-runtime/*`,
the `vendor/paperclip-runner` shim, `runner-prp`, or `tool-gateway`). The main seams:

| Shared-core area | Dormant code it reaches | Where |
| --- | --- | --- |
| Startup | Runner workers, PRP websocket, managed-agent routes | `index.ts` (~15 `register*Work`/cleanup hooks), `app.ts`, `http/server.ts` (`setupRunnerPrpWebSocketServer`, always on) |
| Heartbeat | Native lifecycle, run projection, result commits, environments, Dot broker | `heartbeat.ts` (~30 native-runtime imports, `resolveHeartbeatNativeRuntimeMode`); 28 of 60 `heartbeat/` files; `heartbeat/native-lifecycle.ts`, `live-runner-adoption.ts`, `remote-workspace-source.ts`, `external-provider.ts` |
| Heartbeat ↔ external chat | Chat delivery and publications | `heartbeat.ts`, `heartbeat/queue.ts`, `heartbeat/recovery.ts`, `heartbeat/task-context.ts`, `services/issues.ts` import `chat-completion-delivery`; `heartbeat/run-completion.ts` imports `chat-run-publications`; `heartbeat/run-preparation.ts` imports `voice/speko-agent-tools` and `chat-channels/github/review-instructions` |
| Wake queue / dispatch modules | Native admission holds, workspace sync, cancellation | `modules/wake-queue/adapters/postgres.ts`, `queued-comment-postgres.ts`; `modules/run-dispatch/adapters/postgres.ts` (5 native imports), `workspace-busy-wait.ts` |
| Recovery | Native restart recovery, runner ownership, remote transport | `recovery/service.ts` (13 dormant imports), 6 of 44 `recovery/` files, `task-interruption-presentation.ts`, `execution-recovery-resolution.ts` |
| Issues | Native continuation/monitor delivery, question bridge, environments | `services/issues.ts` (7 native imports), `routes/issues.ts` (10 native imports + `runner-prp-ws`, `environment-runtime`, `runner-goals`), `issue-thread-interactions.ts` (`cloud-instance`, `native-review-participant`) |
| Agents | Runner selection, provider profiles, managed resources | `routes/agents.ts` (27 dormant imports), `agent-runner-selection.ts`, `built-in-agents.ts` |
| Adapter registry | Every adapter package, provider profiles, acpx probes | `adapters/registry.ts` |
| Tool authority / MCP | Runner semantic tool catalog | `services/project-tools.ts` imports `CAPABILITY_SEMANTIC_TOOL_CATALOG` from `vendor/paperclip-runner`; `routes/openapi.ts` feeds `native-runtime/runner-api-catalog.ts`; `heartbeat/run-preparation.ts` uses `tool-gateway` |
| Workspaces | Native session resume, remote/isolated workspace sources, plugin workspaces, Tailscale exposure | `execution-workspaces.ts`, `workspace-runtime.ts`, `routes/projects.ts` |
| Environments | Local driver path | `heartbeat/workspace-preparation.ts` → `environment-run-orchestrator.ts` → `environment-runtime.ts` (`createLocalEnvironmentDriver`) → `environment-execution-target.ts` |
| Auth | Cloud tenant actors | `middleware/auth.ts` (`resolveCloudTenantActor`), `routes/access.ts` (`cloud-runtime-identity`), `services/access.ts` (chat and voice notifications) |
| Companies / settings | Cloud instance overlay, managed config, public MCP mirrors | `companies.ts`, `instance-settings.ts`, `company-skills.ts` (`managed-skill-content`) |
| Plugins | `PluginWorkerManager` in core routes | `routes/approvals.ts`, `costs.ts`, `attention.ts`, `adapters.ts`, `issue-tree-control.ts`, `instance-settings.ts`, `company-skills.ts`, `execution-workspaces.ts` |

### Notes and surprises

- **`claude_local` agents never take the Runner path**, whatever `enableNativeRunner` says:
  `runtime-mode.ts` sends any agent whose `adapterType` isn't `paperclip_runner` down the legacy
  branch. But a new Claude hire can be stored as `adapterType: "paperclip_runner"` (Claude over
  ACP) when the Runner is available, since `agentRunnerAvailability` defaults to the Runner
  (`agent-runner-selection.ts`). So "does this agent use `claude --print`?" is answered by its
  `adapterType`, not by the flag; the flag only stops *new* Runner runs. This refines the hard-fork
  plan's "an ordinary `claude_local` hire runs on the Runner".
- **`tool-gateway.ts` (14k) isn't Runner-only**: it serves connection gateways for any run with
  assigned connections. The Runner's semantic tools live in `native-runtime/paperclip-runner-tool-authority.ts`.
- **The project-tools MCP (ours) takes its tool list from the Runner package** via the vendor shim,
  so removing the Runner means moving that catalog first.
- **External chat is wired into heartbeat** (completion delivery, publications, retry authority),
  not just the Runner.
- **Every run goes through the environment orchestrator**, even plain local runs.
- **The legacy path is a minority in the busiest files**: `heartbeat.ts`, `routes/issues.ts` and
  `recovery/service.ts` each carry the native path alongside it.

## 5. Tests

### Where they live

| Area | Location | Rough count | Label |
| --- | --- | --- | --- |
| Server (most) | [server/src/\_\_tests\_\_/](../server/src/__tests__/README.md) | ~1,370 test files + helpers | mixed |
| Server, colocated | `server/src/services/**/*.test.ts`: top-level services ~320, `heartbeat/` 49, `recovery/` 14, `modules/*/__tests__` ~30 | ~430 | mixed |
| Native runtime | `server/src/services/native-runtime/*.test.ts` | 276 | **Dormant** |
| Chat channels, public MCP, connectors | `services/chat-channels/` 35, `public-mcp/` 19, `connectors/` 14, `google-workspace-rest-tools/` 19 | ~87 | **Dormant** |
| Packages | shared 109, adapter-utils 93, db 86, plugins 89 (sandbox-providers 54), adapters 118 (claude-local 24) | ~500 | adapters other than claude-local and sandbox-providers **Dormant** |
| Runner package | `packages/paperclip-runner/test/` + colocated | ~460 | **Dormant** (not a root vitest project) |
| ui-new | `ui-new/src/**/*.test.ts(x)` (vitest, jsdom), `ui-new/e2e/` (Playwright, mocked API) | ~281 + 8 specs | **Ours** |
| Old UI | `ui/` | 998 | **Dormant** |
| CLI | `cli/src/**` | 66 | **Dormant?** |
| Cross-package | `tests/e2e/` (65 Playwright specs, old UI), `tests/runner-e2e/` (~720 tests), `runner-acceptance/`, `runner-recovery/`, `restart-chaos/`, `release-smoke/`, `canary-onboarding/`, `storybook-visual/`, `perf/`, `speko-*` | ~1,000 | **Dormant** (old UI, Runner, release); `restart-chaos/` mixed |
| Scripts | `scripts/__tests__/`, `scripts/*.test.mjs`, `server/scripts/*.test.mjs` | ~105 | Shared |

### Server tests by area (`server/src/__tests__`, by file-name keyword; groups overlap)

| Core group | Count | Dormant group | Count |
| --- | --- | --- | --- |
| `heartbeat-*` | ~110 | `native*` | ~63 |
| `issue(s)-*` | ~100 | `runner*` | ~25 |
| auth / access / invite / permission | ~95 | `environment*` (mixed) | ~50 |
| workspace | ~95 | `cloud*` | ~26 |
| `agent(s)-*` | ~94 | `managed*` (mixed) | ~22 |
| skill | ~62 | `remote*` | ~15 |
| `plugin(s)-*` | ~52 | `sandbox*` | ~14 |
| git / github | ~39 | slack / teams / photon / chat-channel | ~15 |
| idle / sleep | ~39 | voice / speko | ~9 |
| company | ~36 | muse / dot / grok / antigravity | ~18 |
| `tool-*` | ~34 | other adapters (codex, cursor, gemini, kimi, opencode, pi, openclaw) | ~26 |
| chat (agent chat + channels) | ~34 | public-mcp | ~3 |
| decision / interaction / question | ~30 | | |
| attention / inbox | ~22 | | |
| projects | ~20 | | |
| cost / budget | ~18 | | |
| routine | ~14 | | |
| document / approval | ~14 | | |

About 220–260 files in `__tests__` belong to dormant areas by name, plus the 276 in
`native-runtime/` and ~87 in dormant service folders.

### Embedded Postgres

- About **850 server test files** need a real Postgres. They use
  `getEmbeddedPostgresTestSupport()` / `startEmbeddedPostgresTestDatabase()` from
  [packages/db/src/test-embedded-postgres.ts](../packages/db/src/test-embedded-postgres.ts), re-exported
  by `server/src/__tests__/helpers/embedded-postgres.ts`. The `*.postgres.test.ts` suffix is rare
  (~10 files), so find them by the import, not the name.
- Each test gets a throwaway data dir and a safe loopback port; nothing to start by hand. Suites
  skip only when the platform is unsupported.
- Env: `PAPERCLIP_TEST_POSTGRES_ADMIN_URL` (use an existing server), `PAPERCLIP_EMBEDDED_POSTGRES_PORT`,
  `PAPERCLIP_TEST_POSTGRES_TEMPLATE=0` (no template cache). See [doc/test-infrastructure.md](../doc/test-infrastructure.md).

### Running a targeted set

```bash
# server (uses server/vitest.config.ts: node, forks, one worker, 15s per test)
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/routines-service.test.ts
corepack pnpm --filter @paperclipai/server exec vitest run src/services/heartbeat/
# or from the root (root vitest.config.ts has projects for server, ui, cli, shared, db, adapters…)
corepack pnpm exec vitest run server/src/__tests__/issues-service.test.ts
# a package
corepack pnpm --filter @paperclipai/adapter-claude-local exec vitest run
# ui-new
corepack pnpm --filter @paperclipai/ui-new test
corepack pnpm --filter @paperclipai/ui-new test:e2e
# list without running
corepack pnpm --filter @paperclipai/server exec vitest list src/__tests__/ | head
```

- `server/package.json` has no test script; use `exec vitest`. Server setup file:
  `src/__tests__/setup-supertest.ts` (creates an isolated test home).
- `pnpm verify` ([scripts/local-verify.mjs](../scripts/local-verify.mjs)) picks affected tests
  against the merge base with `origin/master`. In the hard fork that's upstream, so pass
  `--base main`. Exit 2 means it wants broader verification.
- Full suite: `pnpm test` (`scripts/run-vitest-stable.mjs`); not for routine use.
- Dormant-area tests broken by a shared change: skip with a note (`describe.skip` + why), per
  [step 3](hard-fork-plan.md#3-leave-unused-code-until-it-gets-in-the-way).

## 6. Experimental flags

Schema: [packages/shared/src/validators/instance.ts](../packages/shared/src/validators/instance.ts)
(50 booleans). Server read: `getExperimental()` in
[services/instance-settings.ts](../server/src/services/instance-settings.ts). What `ui-new` does with
each: [decision 12](../ui-new/docs/decisions.md#12-what-happens-to-each-experimental-flag) and
[generated/flags.md](../ui-new/docs/inventory/generated/flags.md). "UI only" means no server read
besides the settings service. Paths are under `server/src/`.

| Flag | Default | Read on the server | Feature label |
| --- | --- | --- | --- |
| `enableAgentChat` | true (forced) | `routes/issues.ts`, `heartbeat.ts`, `issues.ts`, `agent-chat-messages.ts`, `chat-completion-delivery.ts`, `task-retry.ts`, `recovery/service.ts`, `heartbeat/{run-control,queue}.ts`, `wake-queue` | Ours |
| `enableStatusCards` | false | `routes/status-cards.ts`, `status-card-evaluation.ts`, `heartbeat/task-context.ts` | Ours? |
| `enableBetaSkills` | false | `routes/agents.ts`, `heartbeat/execution-configuration.ts`, `plugin-agent-runtime-state.ts` | Shared |
| `enableIsolatedWorkspaces` | false | `heartbeat.ts`, `heartbeat/queue.ts`, `execution-workspaces.ts`, `issues.ts`, `email-channels.ts`, `paperclip-runner-tool-authority.ts` | Shared? (per-task workspaces) |
| `enableIsolatedWorkspacesByDefault` | false | `execution-workspaces.ts`, `heartbeat.ts` | Shared? |
| `enableWorkspaceBranchReconcileForward` | true | `execution-workspaces.ts`, `workspace-runtime.ts`, `heartbeat/{runtime-execution,workspace-preparation}.ts` | Shared |
| `enableWorkspaceDirtyQuarantineRepair` | true | same four files | Shared |
| `enableExternalObjects` | false | `index.ts`, `routes/{issues,projects}.ts`, `heartbeat/runtime-execution.ts`, `paperclip-runner-tool-authority.ts` | Shared? |
| `enableFastResponses` | false | `fast-responses.ts` | Shared? |
| `enableSimplifiedEnglishInteractions` | false | `heartbeat/task-context.ts` (prompt instruction) | Ours (prompt) |
| `enableFirstTaskPlanProposal` | false | `routes/issues.ts` | Ours? |
| `enableConferenceRoomChat` | false | `routes/board-chat.ts`, `heartbeat/task-context.ts` | Dormant? (no ui-new surface) |
| `enableCases` | false | `routes/cases.ts`, `case-handoff*.ts`, `cases-disabled.ts`, `workflows.ts`, `heartbeat/{queue,task-context}.ts`, `native-case-tools.ts` | Dormant? |
| `enableSummaries` | false | `routes/summary-slots.ts` | Dormant? |
| `enableServerInfoDebugView`, `autoRestartDevServerWhenIdle` | false | `routes/health.ts` | Dev tools |
| `enableWorktreeRunExecution` | false | `heartbeat.ts` | Dev tools |
| `enableNativeRunner` | **true** | `heartbeat.ts` (dispatch), `app.ts`, `routes/agents.ts`, `company-portability.ts`, `external-bot-authority.ts`, `muse-identity.ts`, `public-mcp/oauth.ts` | Dormant (only affects `paperclip_runner` agents) |
| `enableManagedSandboxOnly` | false | 16 files: `routes/{agents,projects,environments}.ts`, `agent-runner-selection.ts`, `environments.ts`, `heartbeat/environment-selection.ts`… | Dormant |
| `remoteWorkspaceStorageEnabled` | true | `heartbeat/workspace-preparation.ts` | Dormant (native sandboxes) |
| `enableSandboxDuplexBridge` | false | `environment-runtime.ts`, `environment-execution-target.ts`, `native-github-access.ts` | Dormant |
| `enableOwnerInstanceAdmin` | false | `middleware/auth.ts`, `authorization.ts`, `cloud-tenant-authority.ts` | Dormant (cloud) |
| `enablePublicMcp` | false | `routes/agents.ts`, `heartbeat.ts`, `external-bot-authority.ts`, `plugin-agent-runtime-state.ts`, `public-mcp/*` | Dormant? (step 4 may reuse) |
| `enableMcpTasks` | false | `tool-gateway.ts`, `idle-sleep-safety.ts` | Dormant |
| `enableOpenAiDot`, `enableGrokBot`, `enableMuse` | false | `routes/agents.ts`, `heartbeat.ts`, `external-bot-authority.ts`, `company-portability.ts`, `muse-identity.ts`, `app.ts` | Dormant |
| `enableChatConnectors` | false | 16 files: `routes/{chat-channels,slack-tools,voice-sessions}.ts`, `connection-intents.ts`, `voice/*`, `connectors/slack/*` | Dormant |
| `enableGitHubReviewBots` | false | `routes/chat-channels.ts`, `connection-intents.ts` | Dormant |
| `enableMemoryConnectors` | false | `routes/tool-access.ts`, `tool-access/connections/setup-policy.ts` | Dormant |
| `enablePaperclipNotebook`, `enableGoogleWorkspaceConnector` | false | via connector `experimentalFeatureKey` (`tool-gateway.ts`, `connection-intents.ts`) | Dormant |
| `enableAiConnectionRouters` | false | `routes/agents.ts`, `ai-connection-router.ts` | Dormant |
| `enableBuiltInAgents` | false | `routes/built-in-agents.ts` | Dormant |
| `enableSmokeLab` | false | `smoke-lab.ts` | Dormant |
| `enableRunnerPreviewIngress`, `enableMcpAggregators`, `enableApps` | deprecated | none | Dormant (compat) |
| `enableEnvironments`, `enableStreamlinedLeftNavigation`, `enableStreamlinedUi`, `enableCombinedInboxTasks`, `enableArtifactsV1`, `enableClassicTaskInterface`, `enableLegacyComposerSubmit`, `enableIssuePlanDecompositions`, `enableExperimentalFileViewer`, `enableDecisions`, `enableGoalsSidebarLink`, `enablePaperclipDeveloperMode` | mixed | UI only | Old-UI toggles; ui-new settled each in decision 12 |
