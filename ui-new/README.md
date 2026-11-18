# ui-new

Paperclip's board UI, in SolidJS. It replaced upstream's React UI (`ui/`, removed on 2026-11-17).

It is a standalone Vite app. It talks to the Paperclip server over `/api` and imports API types from `@paperclipai/shared`. The server serves its production build (`dist/`) at `/`.

## Running it

```bash
# terminal 1, repo root: start the Paperclip server (API on :3100)
pnpm dev

# terminal 2: start this UI
pnpm --filter @paperclipai/ui-new dev    # or: cd ui-new && pnpm dev
```

Open http://localhost:5174. The server on :3100 serves only the API in development, plus this app's last production build if `dist/` has one.

To point at a different server: `PAPERCLIP_API_URL=http://host:port pnpm dev`.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server on :5174, proxying `/api` (including websockets) to the server |
| `pnpm build` | Production build to `dist/` |
| `pnpm preview` | Serve the production build on :3102 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest, once (`pnpm test:watch` to keep it running) |
| `pnpm test:e2e` | The Playwright smoke suite in `e2e/`, against a mocked API (below) |

## Smoke suite (Playwright)

`e2e/` holds one spec per area, each journey run at desktop size (1366×900) and phone size
(390×844): sign-in and the company list (`auth`), moving around the shell, the command palette and
New task (`shell`), the task list, panel, inline status, comments, an agent's question and the run
modal (`tasks`), Inbox triage (`inbox`), a project's dashboard and Docs (`project`), an agent's chat
(`agent`) and a settings save with its unsaved-change dot (`settings`).

```bash
corepack pnpm --filter @paperclipai/ui-new test:e2e                 # mocked, headless, ~30 s
corepack pnpm --filter @paperclipai/ui-new test:e2e e2e/tasks.spec.ts --project=phone
corepack pnpm --filter @paperclipai/ui-new test:e2e --ui            # Playwright's UI, to step through
E2E_LIVE=1 corepack pnpm --filter @paperclipai/ui-new test:e2e      # live: read-only, against :3100
```

Playwright builds the app and serves it with `vite preview` on :5184 (`playwright.config.ts`); stop
anything else on that port first. `E2E_DEV=1` uses the Vite dev server instead (no build, but about
five times slower, since every page load compiles modules), and `E2E_REUSE_SERVER=1` uses whatever
already listens on :5184. `@playwright/test` comes from the workspace root, and the browser is the
Chromium headless shell in `~/.cache/ms-playwright`. A failure leaves a screenshot and a trace in
`e2e/.results/` (`corepack pnpm exec playwright show-trace <trace.zip>`) and a report in `e2e/.report/`.

**Mocked (the default).** No Paperclip server is needed: `e2e/fixtures/` answers every `/api`
request, and the app's proxy points at a closed port, so nothing can reach a real server.

- `fixtures/world.ts` is the data: a signed-in user, two companies (MSE and MOT), agents, projects,
  tasks, comments, a run, two agent questions, a document, a budget. Builders (`issue()`, `agent()`,
  `project()`…) are typed with `@paperclipai/shared`, so an upstream type change fails
  `typecheck`, which also checks `e2e/`.
- `fixtures/handlers.ts` answers each request from a fresh copy of that data per test (`db`), and
  answers writes the way the server would (a PATCH changes the task, a comment is added), so the
  page moves on after a save.
- `fixtures/mock-api.ts` routes the requests: every write is recorded (`api.writes`,
  `await api.waitForWrite("POST", "/issues/…/comments")` returns it with its parsed `body`), the
  live-events socket is a quiet fake (`api.emit(event)` pushes one), and anything outside localhost
  is refused.
- `fixtures/test.ts` is the `test` the specs import. A test **fails** if the page asked for
  something no handler answers (the failure names each request, answered `501` meanwhile) or threw
  an uncaught error.

To add a fixture: run the spec, read the `requests the fake API has no fixture for` list, find each
request's response type in `src/api/*` (and `@paperclipai/shared`), and add a handler to
`installDefaultHandlers` in its API area, with any new records in `world.ts`. A single test can
override one instead: `api.get("/companies/:companyId/labels", () => [...])` (later registrations
win; `reply(404, {...})` sets a status). Throwaway names start with "M7 test", as on the real
instance. Assert on roles, accessible names and visible text rather than CSS classes, and wait on
what the page shows, not on time.

**Live (`E2E_LIVE=1`).** Runs only `e2e/live.spec.ts`: the read-only journeys (companies, Inbox,
tasks and a task's panel, a project and its Docs, an agent, settings) in the test company TES,
against the server on :3100 (or `PAPERCLIP_API_URL`). Reads go to the server; every write is still
answered by the fake API and never sent. It skips when no server answers or TES can't be read. On an
authenticated server, save a signed-in state first (`corepack pnpm exec playwright codegen
--save-storage=/tmp/tes.json http://localhost:5174`, sign in, close) and pass
`E2E_LIVE_STORAGE_STATE=/tmp/tes.json`.

## Layout

```
src/
  index.tsx        mounts the app: fonts, tokens, base styles, theme
  App.tsx          query client and routes
  api/             fetch wrapper (client.ts), one module per API area, query keys
  lib/             query client, session gate, company selection, live-events socket and toasts,
                   shared company queries, the commands context, keyboard shortcuts, theme
  layout/          breakpoints (the only place they're defined), the shell grid, the left nav,
                   the phone's floating dock and its Tasks switcher sheet, the side panel
  shell/           the command palette and the shortcuts cheatsheet
  tasks/           the new-task dialog and its payload rules (new-task.ts)
  ui/              shared components: buttons, status capsules and pills, fields, switch,
                   segmented control, menu, popover, tooltip, dialog, avatars, grain, layers,
                   page header with tabs and section rail, toasts
  routes/          one component per page, each with its own CSS file
  styles/          tokens.css (copied verbatim from docs/design/tokens.css), fonts, base styles
  test/            test setup (jsdom stand-ins)
e2e/               the Playwright smoke suite and its fake API (fixtures/)
```

Tests sit next to the code as `*.test.ts(x)`: view models and logic as plain unit tests, key
components rendered in jsdom with `@solidjs/testing-library`. The config is the `test` block in
`vite.config.ts`. They aren't part of the root `pnpm test`, whose project list is upstream's.

Components respond to their own width with `@container` queries; the viewport breakpoints in
`layout/breakpoints.ts` set `data-viewport` on `<html>` for the few things that change with the
window (the shell, and layers turning into sheets on a phone). Menus, popovers, dialogs and the panel
each go through one wrapper, so their phone behavior lives in one place. `/style-guide` shows every
component in both themes.

`@/` is an alias for `src/`.

## The old UI as reference

The old React UI showed how the server API is used: endpoints, payloads, and realtime and websocket handling. It's in git at `upstream-freeze`: `git show upstream-freeze:ui/src/api/<file>` is the most useful place to start, and [docs/inventory/](docs/inventory/README.md) catalogues its pages and requests. Import types from `@paperclipai/shared` with `import type` rather than redefining them, so server type changes show up as type errors here.

## Changing the API

Since the hard fork (2026-11-17, [FORK.md](../FORK.md)) the server is ours: when `ui-new` needs
something the API doesn't have, change the server instead of designing around the gap. Server
changes only reach server1 once the deployment builds from source (hard-fork plan step 2).

If `pnpm-lock.yaml` conflicts when merging a branch, don't resolve it by hand: take one side and
regenerate it with `corepack pnpm install`, then `git add pnpm-lock.yaml`.
