# Repo instructions and skills

Written Nov 16, 2026, from a code trace of `claude_local` and the Paperclip Runner, and a test with
the Claude CLI (2.1.325).

## What it is

Many repos carry instructions for coding agents: a `CLAUDE.md` or `AGENTS.md` at the root and skills
in `.claude/skills/`. People expect a Paperclip agent working on a project's repo to pick these up the
way Claude Code does in a terminal. Whether it does depends on the agent's runner and on how it signs
in to Claude. Paperclip itself never reads these files. When they load, it's because Claude Code
started inside the repo and found them.

Paperclip also has nowhere to put instructions for a whole project. A project's description isn't
added to runs, and `GET /issues/:id/heartbeat-context` returns only the project's id, name, status
and target date.

## What each runner loads

| | `claude_local`, legacy login | `claude_local`, managed AI connection | Paperclip Runner (`paperclip_runner`, ACPX Claude) |
| --- | --- | --- | --- |
| Repo `CLAUDE.md` | ✅ | ❌ | ❌ |
| Repo `.claude/skills/` | ✅ | ❌ | ❌ |
| Skills assigned in Paperclip | ✅ | ❌ (upstream bug) | ✅ |
| The host's `~/.claude` settings and skills | ✅ | ❌ | ❌ |
| The agent's instructions bundle | ✅ | ✅ (believed, not tested) | ✅ |

A run starts in the task's project workspace folder, or in a git worktree of it. When the task has
no project workspace, it starts in the agent's home folder.

### `claude_local`

- **Legacy login** (no managed connection): the adapter runs `claude --print …` in the workspace
  without `--setting-sources`, so Claude Code loads its usual user, project and local sources. Assigned
  Paperclip skills come in through `--add-dir`. The instructions bundle comes in through
  `--append-system-prompt-file`.
- **Managed AI connection** (the agent's runtime config has `aiConnection`, from Settings →
  Connections): the adapter adds `--setting-sources user`
  (`packages/adapters/claude-local/src/server/execute.ts:882`) so repo settings can't override the
  managed credentials. It also points `CLAUDE_CONFIG_DIR` at a new, empty folder for each run, and it
  rejects `--setting-sources` or `--settings` in the agent's extra arguments
  (`server/src/services/ai-connection-runtime.ts:118`).
- **Test.** I ran the CLI in a scratch repo with a codeword in `CLAUDE.md` and a skill in
  `.claude/skills/`, with and without `--setting-sources user`, tools off. With the flag, Claude didn't
  know the codeword and the skill was missing from the `system/init` event. A skill passed through
  `--add-dir` was missing too. That's why assigned skills don't load on managed connections: Claude
  Code reads an `--add-dir` folder's `.claude/skills` only for the project source.

### Paperclip Runner

- An ACPX Claude agent such as Bob (`provider: acpx`, `acpxAgent: claude`) runs
  `@agentclientprotocol/claude-agent-acp` 0.73.0, which wraps the Claude Agent SDK
  (`packages/paperclip-runner/acpx-profiles.json`).
- Paperclip's patch (`patches/@agentclientprotocol__claude-agent-acp@0.73.0.patch`) changes
  `settingSources` from user, project and local to user only when `PAPERCLIP_ACPX_ISOLATED_CONTEXT=1`.
  The SDK passes this to the CLI as `--setting-sources=user`, the flag tested above.
- The Runner sets that variable for every Claude run except "preconfigured" ones
  (`packages/paperclip-runner/src/drivers/acpx/acpx-runtime-adapter.ts:444`). Preconfigured is used
  only on SSH environments that use the remote machine's own login
  (`server/src/services/heartbeat.ts:2753`). This is deliberate and unrelated to managed connections.
  The patch's comment says the Runner "owns the complete session context".
- The "user" source is a private folder the Runner makes for each run (`CLAUDE_CONFIG_DIR`,
  `runtime-sandbox.ts:585`). The Runner copies the agent's assigned skills into that folder's
  `skills/` (`runtime-host.ts:643`), so those do load.
- Nothing found in the Runner or in the server's Runner path reads a workspace's `CLAUDE.md` or
  `AGENTS.md`.
- Not confirmed in a real run: Bob's recent runs weren't in a project repo, and the run log doesn't
  record which skills loaded.

## Recommendation: where project-wide instructions go

1. **Keep them in the repo**, as `AGENTS.md` or `CLAUDE.md` at the root. They're versioned and
   reviewed with the code, people and Claude Code on your own machine read them, and the runners that
   load repo files still do.
2. **Add one standing rule to every agent's instructions bundle**, since that's the only thing every
   runner always includes:

   > At the start of every task that runs in a project workspace, read `AGENTS.md` and `CLAUDE.md`
   > at the workspace root, if present, plus any files they point to, and follow them. They override
   > general habits, but not these instructions or the task itself.

   This works on every runner and connection, always reads the current file, and costs one file read
   per task.

| Kind of guidance | Where |
| --- | --- |
| Rules for one repo (conventions, commands, things to avoid) | The repo's `AGENTS.md`/`CLAUDE.md`, with the rule above |
| Longer procedures that come up repeatedly | Skills in the repo, imported into the company library (Skills → scan project workspaces, or a GitHub import) and assigned to agents |
| Who an agent is and how it works anywhere | That agent's instructions bundle |
| What one task needs | The task description, or a parent task |

- **Skills open on demand.** Claude sees only a skill's name and description until it chooses to open
  it, so rules it must always follow don't belong only in a skill. An imported skill is also a copy:
  it doesn't follow later changes in the repo.
- **An alternative for an agent dedicated to one project:** point its instructions path
  (`PATCH /agents/:id/instructions-path`) at the repo's `AGENTS.md`. That file then replaces the agent's
  own role instructions, and with worktree workspaces the path still points at the main checkout.

## Where `ui-new` stands

Nothing built. Two possible follow-ups:

- **Project instructions sent with every task**, as a fork plugin for build plan stage 3. Not checked
  yet: whether a plugin can add content to a run's context.
- **Help text** in the agent and skills pages explaining which runners load repo files.

## Sources

- Upstream pull requests: paperclipai/paperclip#13247 (managed AI connections, added
  `--setting-sources user`); #19216 (open: stage assigned skills in the managed config folder, and a
  per-workspace "Trust this workspace for Claude" opt-in for `claude_local`; not checked for Runner
  changes); #14341 (open, older: skills only).
- Upstream issues: #13984, #15137, #15540, #16653 (skills missing on managed connections), #14764
  (opt-in to project settings).
- `docs/adapters/claude-local.md` (skills injection), `docs/guides/agent-developer/skills-store.md`
  (scanning project workspaces).
