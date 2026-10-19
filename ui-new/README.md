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

## Layout

```
src/
  index.tsx        mounts the app
  App.tsx          router and layout shell
  api/client.ts    small fetch wrapper for /api
  routes/          one component per page
  styles.css       design tokens (light and dark) and base styles
```

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
