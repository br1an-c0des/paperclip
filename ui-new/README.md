# ui-new

An experimental SolidJS board UI for Paperclip, built alongside the existing React UI in `../ui`.

It is a standalone Vite app. It talks to the Paperclip server over the same `/api` the React UI uses and imports API types from `@paperclipai/shared`.

## Running it

```bash
# terminal 1, repo root: start the Paperclip server (API on :3100)
pnpm dev

# terminal 2: start this UI
pnpm --filter @paperclipai/ui-new dev    # or: cd ui-new && pnpm dev
```

Open http://localhost:5174. The existing React UI keeps running at its usual address, so you can compare the two side by side.

To point at a different server: `PAPERCLIP_API_URL=http://host:port pnpm dev`.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server on :5174, proxying `/api` (including websockets) to the server |
| `pnpm build` | Production build to `dist/` |
| `pnpm preview` | Serve the production build on :3102 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest, once (`pnpm test:watch` to keep it running) |

## Layout

```
src/
  index.tsx        mounts the app: fonts, tokens, base styles, theme
  App.tsx          query client and routes
  api/             fetch wrapper (client.ts), one module per API area, query keys
  lib/             query client, session gate, company selection, live-events socket, theme
  layout/          breakpoints (the only place they're defined), the shell grid, the side panel
  ui/              shared components: buttons, status capsules and pills, fields, switch,
                   segmented control, menu, popover, tooltip, dialog, avatars, grain, layers
  routes/          one component per page, each with its own CSS file
  styles/          tokens.css (copied verbatim from docs/design/tokens.css), fonts, base styles
  test/            test setup (jsdom stand-ins)
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

## Using the existing UI as reference

`../ui/src` is the source of truth for how the server API is used: endpoints, payloads, and realtime and websocket handling. `../ui/src/api/` is the most useful place to start. Import types from `@paperclipai/shared` with `import type` rather than redefining them, so type changes upstream show up as type errors here after a merge.

## Staying merge-friendly with upstream

This fork tracks `paperclipai/paperclip` and is UI-only: build on the existing API rather than changing server, database or package code. Any change to an upstream file is recorded in [FORK-PATCHES.md](../FORK-PATCHES.md), and server fixes go upstream as pull requests ([FORK.md](../FORK.md#contributing-fixes-upstream)). Syncing with upstream is described in [FORK.md](../FORK.md#staying-in-sync-with-upstream).

If `pnpm-lock.yaml` conflicts during a merge, don't resolve it by hand. Take upstream's version and regenerate it:

```bash
git checkout --theirs pnpm-lock.yaml   # "theirs" = master when merging master into new-ui
pnpm install
git add pnpm-lock.yaml
```
