# Outside agents

Written Oct 28, 2026, while deciding audit decision D2
([decisions.md 39](../decisions.md#39-decisions-from-the-m7-audit)).

## What it is

Most agents in Paperclip are **built-in**: Paperclip starts the process itself (`claude_local`,
`codex_local`, `opencode_local`, `hermes_local`, …), so it controls the workspace, sees the
transcript, counts tokens and enforces budgets.

An **outside agent** runs on its own, somewhere else, and joins the company through an invite. When
there's work, Paperclip wakes it by calling its URL; the agent does the work and reports back through
the Paperclip API with a key it was given on approval. The adapters for this are `hermes_gateway`,
`openclaw_gateway` and `http`.

This follows from upstream's first product principle: "Unopinionated about how you run your agents…
OpenClaw bots, Python scripts, Node scripts, Claude Code sessions, Codex instances — we don't care…
The minimum contract is just 'be callable.'" (`doc/PRODUCT.md`).

## When it helps

- **You already have an agent with its own memory and character.** A Hermes or OpenClaw bot built up
  over months has its own skills, memory and persona files (OpenClaw's `SOUL.md`). Inviting it gives
  that agent a job on your board without rebuilding it as a Claude Code agent.
- **The work needs a different machine.** A GPU box for training, a Mac for iOS builds, a machine
  inside a network with data you don't want the Paperclip host to reach. The agent stays there; only
  task traffic crosses.
- **A separate trust boundary.** Paperclip never holds the agent's model keys. The agent holds only a
  scoped Paperclip key, and Paperclip only its gateway key. This suits agents that belong to someone
  else: vendor support bots, partner systems, contractors (upstream issue #2759 asks that such agents
  "NOT access internal KB/memory").
- **Agents that aren't coding CLIs.** A Python bot, a cloud function or another vendor's agent
  platform can join through the `http` adapter, which upstream's docs recommend when the "agent runs
  as an external service".
- **It configures itself.** The agent reads the invite's `onboarding.txt` and submits its own URL,
  token and settings, so you don't type gateway configuration by hand.

## When it doesn't

- **You see less.** The `http` adapter's docs say not to use it "if you need stdout capture and
  real-time run viewing". Transcripts, token counts and costs are only what the agent reports. The
  old UI's Dot option makes you tick "Allow externally billed provider", because "Paperclip cannot
  enforce a provider spend ceiling".
- **Paperclip can't manage it.** No worktrees or execution workspaces, no runtime services, no syncing
  of skills or instructions as for local agents. It can't restart a dead agent: "`hermes_gateway`
  does not start Hermes".
- **Networking both ways.** The agent must reach Paperclip (`npx paperclipai allowed-hostname <host>`,
  HTTPS for anything off-machine), and Paperclip must reach the agent's gateway.
- **Rough edges** (open upstream issues as of Oct 28, 2026):
  - #14135: Hermes gateway runs start but stay "reconnecting" forever; reproduced by other
    self-hosters.
  - #14313: saving an OpenClaw agent's settings wrote `***REDACTED***` over its gateway token and broke
    every later run.
  - #11440: an outside agent can't be a fresh company's first CEO. A commenter created a throwaway
    CEO, approved their Hermes agent, then swapped the roles in the database.
  - #4675 (open since April): creating an OpenClaw agent directly is hidden in the old UI's agent
    picker; the invite is the only way in.

## Examples

| Situation | Better choice |
| --- | --- |
| You run Claude Code or Codex on this machine to write code | Built-in: transcripts, budgets, worktrees |
| A Hermes agent on your home server with months of memory should take research tasks | Invite it |
| A teammate's company has a support bot that should open tasks on your board, without access to your server | Invite it (an agent-only invite, then approval) |
| A nightly data job on a GPU box should report its progress as a task | Invite it, through `http` or a gateway |
| You want a strict monthly spend cap per agent | Built-in: an outside agent's costs are only what it reports |

## Example flow: a Hermes agent on another machine on your tailnet

1. **On the agent's machine**, start Hermes's API server with a gateway key:
   `API_SERVER_KEY=… API_SERVER_ENABLED=true hermes gateway run`, listening on, say,
   `http://hermes-box:8642`.
2. **In Paperclip:** Agents → New agent → **Invite an outside agent** → Hermes (or Other). Paperclip
   creates an agent-only invite (`POST /companies/:id/invites` with `allowedJoinTypes: "agent"`) and
   shows a prompt with a Copy button: "You're invited to join a Paperclip company as an agent…",
   listing the onboarding document's URLs, a connectivity check (`GET <base-url>/api/health`), and
   what to do if Paperclip isn't reachable.
3. **Paste the prompt into Hermes.** Hermes reads `onboarding.txt` and sends a **join request** with
   its name, a short summary of what it can do, `adapterType: "hermes_gateway"`, and its gateway URL
   and key (`agentDefaultsPayload.apiBaseUrl`, `apiKey`).
4. **The join request appears in your Inbox:** "Hermes Engineer wants to join as an agent", with its
   capabilities and where Paperclip will reach it. Approve or reject it.
5. **On approval** Paperclip creates the agent, and Hermes claims its one-time Paperclip API key with
   the claim secret it got when it sent the request, then stores it. Keep the two keys apart: the
   gateway key authenticates Paperclip → Hermes, the Paperclip key Hermes → Paperclip.
6. **From then on it's an ordinary agent:** it appears in Agents and takes assigned tasks. When a task
   wakes it, Paperclip calls Hermes's gateway, and Hermes reports back through the API.

## The old UI's picker

The old UI's "Invite an external agent" link (under the name in New agent) offers five choices:

| Choice | What it does | Behind a setting |
| --- | --- | --- |
| Dot ("Your Dot in ChatGPT") | Pairs OpenAI's ChatGPT agent, with live connection checks | `enableOpenAiDot`, `enablePublicMcp` |
| Grok Bot | Sets up an existing bot in xAI's Grok | `enableGrokBot`, `enablePublicMcp`, `enableNativeRunner` |
| Muse ("Your personal Muse at muse.ai") | Pairs a personal Muse agent; adds a Muse connection panel to the agent | `enableMuse`, `enableNativeRunner` |
| Hermes | The plain invite, for an existing Hermes agent | None |
| Other ("Any agent that can connect to Paperclip") | The plain invite, for any agent | None |

## In ui-new

Decided Oct 28, 2026 (D2, option c): build the plain invite (Hermes and Other) in New agent, with the
copyable prompt and a waiting state that points to the Inbox; drop Dot, Grok and Muse while their
settings are off. Approving join requests in the Inbox is part of M7 slice B. Before that, `ui-new`
could accept an agent invite and list agent invites in Members, but not create one.

## History

- March 2026: invites, join requests and `onboarding.txt`, first for OpenClaw.
- #6183 (May 17, 2026): moved agent invites from company settings into the add-agent dialog and made
  the wording general rather than OpenClaw-only: "the broader bring-your-own-agent flow".
- #13011 (Sep 8, 2026): kept it as a link beside the new-agent wizard.
- #14862 (Oct 1, 2026): animated, copyable setup prompts.
- #15581, #15722, #16274, #16338 (Oct 8–14, 2026): Dot, Grok and Muse layered on top, each behind a
  setting.

## Sources

- Upstream docs: `doc/PRODUCT.md`, `doc/HERMES_GATEWAY_ONBOARDING.md`, `doc/OPENCLAW_ONBOARDING.md`,
  `docs/adapters/http.md`, `docs/agents-runtime.md`, `docs/guides/board-operator/managing-agents.md`.
- The prompt text: `ui/src/lib/agent-onboarding-prompt.ts`.
- The old dialog: `ui/src/components/new-agent/ExternalAgentInviteDialog.tsx` and
  `ExternalAgentInviteContent.tsx`.
- Upstream issues #2759, #4675, #11440, #14135, #14313; pull requests #6183, #13011, #15581.
