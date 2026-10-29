# Settings and admin (Tier 2)

Tier 2: port mostly as-is. One section per area, lighter than the Tier 1 guides: what each page is for,
its main sections, and the resources it calls. Exact requests per page are in
[generated/pages.md](../generated/pages.md); resource groups below are summarized from it.

Many settings pages can be hidden by an operator with `PAPERCLIP_HIDDEN_SETTINGS`
(`HiddenSettingsPageGate` in [generated/routes.md](../generated/routes.md)). Nothing is hidden by default.

## Company settings

| Page | Route (under `/:co`) | What it does |
| --- | --- | --- |
| General (`CompanySettings`) | `/company/settings` | Organization name, description, logo; "require board approval for new hires"; interaction governance (who may resolve agent requests); agent observability (where managed Codex and Claude Code runs send OpenTelemetry logs and traces, with a test); instance general settings for admins; archive the company. |
| Connections (`CompanyConnections`) | `/company/settings/connections` | Decision model connection; prompt injection prevention (an optional model check on tool results, with a regex fallback, a model picker and a test); fast-response model (flag `enableFastResponses`). Each has a setup test. |
| Members (`CompanyAccess`) | `/company/settings/members` (`?tab=invites`) | Members and roles; invites (create, list); join requests. |
| Secrets (`Secrets`) | `/company/settings/secrets` | Company secrets (create, edit, delete, remote import); secret providers and provider configs (e.g. AWS) with discovery and health; user secret definitions; your own user secrets; secret proposals from agents. |
| Export (`CompanyExport`) | `/company/export/*` | Export the company (agents, projects and more) with preview and fidelity report. |
| Import (`CompanyImport`) | `/company/import` | Import a company package or transfer: preview, create or merge, background job progress. Hidden on cloud-managed instances. |
| Plugin settings pages (`CompanySettingsPluginPage`) | `/company/settings/:settingsRoutePath/*` | Settings pages contributed by plugins. |
| Join requests (`JoinRequestQueue`) | `/inbox/requests` | Approve or reject requests to join the company. |

Resources: `PATCH /api/companies/:companyId`, `/logo`, `/archive`, `/decision-model` (+ `/test`),
`/observability` (`GET|PUT|DELETE`, + `/test`), `/prompt-injection-prevention` (`GET|PUT`, + `/models`,
`/test`), `/fast-response` (+ `/models`, `/test`), `/members`, `/invites`, `/join-requests`, `/secrets*`,
`/secret-providers*`, `/secret-provider-configs*`, `/user-secret-definitions`, `/me/user-secrets`,
`/secret-proposals`, `/exports` (+ `/preview`), `/export/fidelity`, company import (`/preview`, jobs,
`/api/companies/import/transfers`), `GET|PATCH /api/instance/settings`.

Notes: since the 2026-10-22 upstream sync, decision model setup is always on Connections (before, it
was on General unless fast responses were on), and General shows agent observability in its place.
Decision charges appear under Activity → Costs.

## Instance settings

Instance-wide (all companies on this server); visible to instance admins.

| Page | Route (under `/:co`) | What it does |
| --- | --- | --- |
| Profile (`ProfileSettings`) | `/company/settings/instance/profile` | Your name, avatar and account details. |
| Environments (`CompanyEnvironments`) | `/company/settings/instance/environments` (+ `/new`, `/:environmentId/edit`) | Execution environments (local, sandboxes, custom images): create, edit, probe, delete; custom image setup sessions; terminal access to an environment. |
| Access (`InstanceAccess`) | `/company/settings/instance/access` | Instance admin users: add, set roles. |
| Experimental (`InstanceExperimentalSettings`) | `/company/settings/instance/experimental` | The experimental flags ([generated/flags.md](../generated/flags.md)). |
| Plugins (`PluginManager`, `PluginSettings`) | `/company/settings/instance/plugins` (+ `/:pluginId`) | Install, enable, configure and remove plugins; example plugins. |
| Adapters (`AdapterManager`) | `/company/settings/instance/adapters` | Agent harnesses (adapters): install from npm, enable/disable, update, remove. |
| Plugin pages (`PluginPage`) | `/plugins/:pluginId`, `/:pluginRoutePath/*` | Full pages contributed by plugins. |

Resources: `/api/users/me`, `/api/auth/*`, `/api/companies/:companyId/environments*`,
`/environment-custom-image-setup-sessions`, `/api/admin/users`, `GET|PATCH /api/instance/settings*`,
`/api/plugins*`, `/api/adapters*`, `/api/plugins/ui-contributions`.

Notes: the instance "General" settings render inside company General for admins. Environments use a
terminal WebSocket (`pages/CompanyEnvironments.tsx`).

## Skills

| Page | Route (under `/:co`) | What it does |
| --- | --- | --- |
| Library (`CompanySkills`) | `/skills/*` | Company skill library in folders; install from the catalog; import; scan projects for skills; browse a project's skills; assign to agents. |
| Sources (`SkillSources`) | `/skills/sources` (+ `/:sourceId`) | Skill sources (git repositories): add, preview, discover, adopt a project's repository, edit, remove. |
| Studio (`SkillStudio`) | `/skills/studio` (+ `/new`, `/:skillId`) | Author and edit skills; test them with test-run templates (runs a real agent task); review interactions the test produces. In the streamlined shell, `/skills/studio` itself now shows the library filtered to authored skills (`CompanySkills`); `/new` and `/:skillId` still open the studio. |

Resources: `/api/companies/:companyId/skills*` (`/catalog`, `/import`, `/install-catalog`,
`/scan-projects`, `/browse-project`), `/skill-sources*`, `/skill-test-run-templates`, `/folders*`.
Upstream recipe: `maps/feature-map/skills.md`. Flag `enableBetaSkills`.

## Apps and tools ("Connectors")

| Page | Route (under `/:co`) | What it does |
| --- | --- | --- |
| Browse (`Browse`) | `/apps` | App gallery and your connections: tool connections, MCP connections, AI connections and pools, chat endpoints, email inboxes. |
| Connect (`AppsConnect`, `AppNotConnected`) | `/apps/byo`, `/apps/connect`, `/apps/app/:applicationId` | Connect an app: OAuth, API key, MCP server, "bring your own"; browser-use cloud grants; email inbox setup. |
| App detail (`AppDetail`) | `/apps/:connectionId/:tab` | One connection: tools, which agents may use it, policies and profiles, review requests, settings. |
| Review (`AppsReview`) | `/apps/review` | Pending ask-first app calls: approve once, always allow, decline. |
| Assistant connection (`AssistantConnection`) | `/apps/assistant-connection` | Inbound access: connect an outside assistant (Claude, Codex, OpenCode, a browser or headless client) to Paperclip's MCP endpoint; list and revoke those connections. |
| Gateways (`GatewaysList`, `GatewayDetail`) | `/apps/gateways`, `/apps/gateways/:gatewayId/:tab` | Tool gateways: create, tokens, audit log. |
| Advanced (`AdvancedToolsRoute`, profile routes) | `/apps/advanced/:tab`, `/apps/advanced/profiles/*` | Tool profiles (which tools a run gets), custom apps and MCP servers, smoke lab (flag `enableSmokeLab`). |
| Chat endpoints (`ChatEndpointSetup`, `ChatEndpointDetail`) | `/apps/chat/connect`, `/apps/chat/:endpointId/:tab` | Slack, GitHub and voice/phone chat connectors: setup, identity linking, reviews, voice history. Flag `enableChatConnectors`. |

Resources: `/api/companies/:companyId/tools/*`, `/api/tool-connections*`, `/api/tool-profiles*`,
`/api/tool-gateway/*`, `/ai-connections*`, `/ai-connection-pools*`, `/mcp/*`, `/chat-endpoints*`,
`/slack/endpoints*`, `/email/*`, `/browser-use-cloud/grants`, `/connection-intents*`, `/smoke-lab/*`.
Upstream recipes: `maps/feature-map/connection-setup.md`, `gateways-profiles.md`, `chat-channels.md`,
`app-permissions.md`.

Note: this area is large (AppsConnect and AppDetail reach about 61 requests each). "Port mostly as-is"
still means a substantial amount of UI.

## Activity and costs

| Page | Route (under `/:co`) | What it does |
| --- | --- | --- |
| Activity hub (`AuditHub`, `CompanyActivity`) | `/activity`, `/activity/runs|costs|budgets|timeline|commentary` | Activity log (with a case filter when `enableCases` is on); runs list (filter by agent); costs by agent, model, provider, biller, project and user, finance events and summaries, quota windows, subscriptions, data quality; budgets (policies, incidents); timeline; agent commentary (suggestions and complaints agents submit while working, filtered and paged by 50, each with a shareable link); agent actions audit with CSV export; decision-model call history. |

Resources: `/api/companies/:companyId/activity`, `/heartbeat-runs`, `/costs/*`, `/budgets/*`,
`/budget-incidents`, `/audit/agent-actions` (+ `.csv`), `/decision-model/history`,
`/agent-commentary` (+ `/:id`).
Upstream recipes: `maps/feature-map/activity.md`, `budgets-costs.md`.

Note: an agent's runs, costs and budget link here filtered to the agent ([agents](agents.md)).

## Status cards

Behind `enableStatusCards` (turning it on also turns on `enableSummaries`); the server gates the API
too. Added upstream on 2026-07-24 (#10101, #10202, #10205).

| Page | Route (under `/:co`) | What it does |
| --- | --- | --- |
| Status cards (`StatusCards`) | `/status` | A board of cards, each a standing question in plain language ("Keep an eye on the ID and Cloud projects…") with an agent-written summary kept current as matching tasks change. Tiles show the summary, freshness and state (setting up, updating, stale, paused by the daily token cap or outside active hours, error, keeping the last good summary); archived cards below with Restore. New card: one prompt and a summarizer agent. Detail drawer: the summary, update history (trigger, the tasks that fed it, cost), earlier summaries, and a dry run of the compiled query's current matches. Settings: prompt, agent, refresh (manual, interval, reactive), daily token cap, active hours, recompile the query. Actions: update now, archive, restore, delete. |

Resources: `GET|POST /api/companies/:companyId/status-cards` (`?archived=`), `GET|PATCH|DELETE
/api/status-cards/:id`, `GET /api/status-cards/:id/updates`, `/summary-revisions`, `/dry-run`,
`POST /api/status-cards/:id/refresh`, `/recompile`.
Old UI: `ui/src/pages/StatusCards/`, `ui/src/api/statusCards.ts`, `ui/src/lib/status-card-state.ts`.

## User profile

Not behind a setting. Added upstream on 2026-04-20 (#4088). The old UI links it only from the
account menu's View profile (`/u/me`, `ui/src/lib/userProfileLinks.ts`).

| Page | Route (under `/:co`) | What it does |
| --- | --- | --- |
| User profile (`UserProfile`) | `/u/:userSlug` (`me` for yourself) | A person's identity (name, avatar, email, role, joined), headline numbers (all-time tokens, completed, open assigned, 7-day actions) with 7-day, 30-day and all-time windows (touched, created, completed, open assigned, comments, actions, cost, tokens), a 14-day chart of activity, completions and spend, recent tasks, recent activity, agent attribution (tokens agents spent on tasks linked to the person) and provider mix. |

Resources: `GET /api/companies/:companyId/users/:userSlug/profile` (`UserProfileResponse`).

## Companies and onboarding

| Page | Route | What it does |
| --- | --- | --- |
| Companies (`Companies`) | `/:co/companies` | Your organizations: open, rename, delete. |
| Onboarding (`OnboardingRoutePage` → `OnboardingWizard`) | `/onboarding`, `/:co/onboarding` | First-run setup: create a company and its first agent (harness, model, account, environment), then leave with a first task. Resumable. |

Resources: `GET|PATCH|DELETE /api/companies/:companyId`, plus the creation requests from the
[agents](agents.md) and [projects](projects.md) guides. Upstream recipe: `maps/feature-map/onboarding.md`.

## Sign-in and connect flows (outside a company)

| Page | Route | What it does |
| --- | --- | --- |
| Sign in (`Auth`) | `/auth` | Email/password sign-in and sign-up (authenticated mode). |
| Board claim (`BoardClaim`) | `/board-claim/:token` | Claim ownership of a fresh instance. |
| CLI auth (`CliAuth`) | `/cli-auth/:id` | Approve a CLI login challenge. |
| Invite (`InviteLanding`) | `/invite/:token` | Accept an invite, signing up if needed. |
| MCP connect (`McpConnect`) | `/mcp-connect/:id`, `/dot-connect/:id`, `/mcp-device`, `/assistant-connections` | Approve an MCP client or device pairing. |
| Chat identity (`ChatIdentityConfirm`) | `/chat-identity/confirm` | Link a Slack or other chat identity to your account. |
| Cloud OAuth handoff (`PaperclipCloudOAuthHandoff`) | `/oauth-handoff` | Return point for Paperclip Cloud sign-in. |

Resources: `/api/auth/*`, `/api/board-claim/*`, `/api/cli-auth/challenges/*`, `/api/invites/*`,
`/api/chat-identity-links/*`, `/api/health`.

Note: these pages sit outside the company layout and should stay simple, standalone pages in `ui-new`.
