# Upgrading ui-new to Solid 2.0

Nov 19, 2026 · briefing and proposal · not scheduled

## Summary

Solid 2.0 shipped as stable on **Nov 17, 2026** (`solid-js@2.0.0`, "The Long Hold"). As of Nov 19 it's
at 2.0.3, three patch releases in two days. Solid Router 2.0.0 and the new Vite plugin
(`@solidjs/vite-plugin` 3.0.1) are stable too. Solid 1.x is still maintained: 1.9.20 came out today,
on npm as `solid-js@v1-latest`.

ui-new is a large Solid 1.9 app: 696 source files, about 198k lines, and 287 unit test files.
Upgrading touches almost all of it. Most of the edits are mechanical. Two changes aren't, and they hold
most of the risk:

1. **Writes are batched until the next microtask.** After `setX(1)`, `x()` still returns the old value
   until the batch flushes.
2. **TanStack Solid Query 6 suspends on `query.data`.** Reading `data` before it has loaded now
   suspends to the nearest `<Loading>` boundary instead of returning `undefined`. ui-new's
   `query.data ?? []` + `isPending` pattern appears in roughly 300 files.

**Recommendation: don't upgrade yet.** Three of our dependencies aren't ready:

- Kobalte has only an alpha for Solid 2, pinned to an old release candidate.
- TanStack Solid Query 6 is still a release candidate.
- `lucide-solid` has no Solid 2 version at all.

Solid itself is two days into stable. In the meantime, do the prep work that's safe on 1.x (below).
Revisit when Solid Query 6 is stable and we've decided what to do about Kobalte. When we upgrade, do it
on one feature branch, all at once, run through `/pm` with agents split by area.

## What changed in Solid 2.0

Sources: the official [migration guide](https://github.com/solidjs/solid/blob/main/documentation/solid-2.0/MIGRATION.md)
and the [2.0 RFCs](https://github.com/solidjs/solid/tree/main/documentation/solid-2.0) it links to.
The release notes link a docs version at
[docs.solidjs.com/migration/from-solid-1](https://docs.solidjs.com/migration/from-solid-1).

### The new model

- **Async in the reactive graph.** A memo can return a Promise or an async iterator. Downstream
  reads suspend until it resolves, and race conditions are handled for you. `createResource` is gone:
  use an async `createMemo`, or `createStore(fn)` for collections.
- **`<Loading>` and `<Errored>`** replace `Suspense` and `ErrorBoundary`.
  - `isPending(() => expr)` reports "a change is on its way" after the first load.
  - `latest(fn)` peeks at in-flight values.
  - `refresh(x)` replaces `refetch`.
- **Mutations:** `action(fn*)`, `createOptimistic` and `createOptimisticStore` (optimistic writes
  that revert when the action settles), plus `affects`, `until` and `resolve`.
- **Batching by default.** Every write waits for the next microtask; `flush()` applies writes now.
  `batch` is removed.
- **Split effects.**
  - `createEffect(compute, apply)`: the compute half tracks dependencies, and the apply half does the
    side effect and returns its cleanup.
  - The `on()` helper and `createComputed` are removed.
  - `onMount` becomes `onSettled`.
  - `createMemo` loses its initial-value argument.
- **Stricter dev diagnostics.**
  - Writing a signal inside an owned scope (a memo, the compute half of an effect, a component body)
    **throws in dev**.
  - Reading props or signals at the top of a component body warns.
  - Each diagnostic reports a stable code, a source location and a fix.
- **Ownership changes.** A nested `createRoot` is now owned by its parent. Ref callbacks run without
  an owner, so `onCleanup` inside a ref no longer works.

### Renames and removals that affect us

| 1.x | 2.0 |
| --- | --- |
| `solid-js/web` | `@solidjs/web` (and `jsxImportSource: "@solidjs/web"`; JSX types come from there) |
| `solid-js/store` | `solid-js` |
| `Suspense` / `ErrorBoundary` | `Loading` / `Errored` |
| `Index` | `<For keyed={false}>` |
| `classList={{…}}` | `class={["a", { b: cond }]}` (`classList` on a DOM element is a compile error) |
| `<Ctx.Provider value>` | `<Ctx value>`; `useContext` on a context without a default throws instead of returning `undefined` |
| `splitProps` / `mergeProps` | `omit` / `merge` |
| `unwrap` | `snapshot` |
| `produce(...)` | the default: store setters take a draft |
| `setStore("a", "b", v)` path setters | draft writes: `setStore(s => { s.a.b = v })` |
| `batch` | removed (`flush()` when you need writes applied now) |
| `on()` | removed (the compute half of a split effect does its job) |
| `createComputed` | `createMemo`, a split effect, or `createSignal(fn)` |
| `createResource` | an async `createMemo` + `<Loading>` |
| `on:` / `oncapture:` / `attr:` / `bool:` / `use:` | removed: use camelCase handlers, ref callbacks, and ref directive factories |
| `<Dynamic>` | still works but deprecated; use the `dynamic(source)` factory |

### Solid Router 2.0: a new API

Router 2.0 is a redesign, not just a port
([changelog](https://github.com/solidjs/solid-router/blob/main/CHANGELOG.md)):

- **`<Router>`, `<Route>`, `<MemoryRouter>` and `createMemoryHistory` are removed.** Routes become
  config objects passed to `createRouter({ routes, history })`. The instance it returns is the
  provider component, and it exposes a typed `paths` proxy.
- **`<A>` and `<Navigate>` are removed.** Links are plain `<a href>` elements. The router marks them
  with `aria-current="page"`, `data-active` and `data-pending`, so link styling moves to CSS
  attribute selectors. `<Navigate>` becomes `useNavigate()` or a redirect in a preload.
- **New, optional features:** scroll restoration on by default, typed search params (Standard
  Schema), and lazily loaded route subtrees.

### TanStack Solid Query 6 (still a release candidate)

6.0.0-rc.6 (Nov 18) requires stable Solid 2. It's a ground-up rewrite onto Solid 2's async model
([changelog](https://github.com/TanStack/query/blob/main/packages/solid-query/CHANGELOG.md),
[rewrite PR](https://github.com/TanStack/query/pull/11308)):

- **`data` is non-optional and suspends.** Reading it before it has loaded suspends into the nearest
  `<Loading>`, and an error goes to `<Errored>`. During a refetch, the previous data stays on screen.
- **`create*` becomes `use*`:** `createQuery` → `useQuery`, and likewise for mutations, queries and
  infinite queries.
- **`mutateAsync` is removed**, because `mutate` now returns a promise.
- **The `suspense` option is removed.** The query's `reconcile` option becomes a key (default `'id'`).
- **Its docs aren't updated yet.** The Solid guides still show v5 and `Suspense`.

### Upgrade tools

- [`solid-migration-assistant`](https://www.npmjs.com/package/solid-migration-assistant) is a
  read-only analyzer that prints every 1.x pattern it finds, with locations. It's written by Dev
  Agrawal, targets **2.0.0-rc.0**, and runs a native Codemod binary. I didn't run it: the counts below
  come from grep.
- There's no official codemod. The edits below are regular enough that we'd write our own scripts
  (with ts-morph or `@babel/parser`, which ui-new already has).

## Where ui-new stands

Counts are from grep over `ui-new/src` (non-test files unless noted), Nov 19.

### Dependencies

| Package | Ours | Solid 2 version | Status |
| --- | --- | --- | --- |
| `solid-js` | 1.9.17 | 2.0.3 (+ `@solidjs/web` 2.0.3) | stable, 2 days old |
| `@solidjs/router` | 1.0 | 2.0.0 | stable; new API |
| `vite-plugin-solid` | 2.11 | `@solidjs/vite-plugin` 3.0.1 (new Rust/OXC compiler; Vite 8, which we already run) | stable |
| `@tanstack/solid-query` | 5.104 | 6.0.0-rc.6 | **release candidate** |
| `@solidjs/testing-library` | 0.8.10 | 1.0.0-rc.2 (Oct 21) | **release candidate** |
| `@kobalte/core` | 0.13.14 | 2.0.0-alpha.4, peer-pinned to `2.0.0-rc.16`; upgrade issue [#653](https://github.com/kobaltedev/kobalte/issues/653) still open | **blocker** |
| `lucide-solid` | 1.61 | none (peer `solid-js ^1.4.7`; its source uses `splitProps` and imports `solid-js/web`) | **blocker, easy to work around** |
| `react` / `react-dom` | 19 | unaffected; plugin areas mount their own React roots | check `plugins/react/runtime.ts` |

### Exposure, by kind of change

**Mechanical (scriptable):**

| Change | Sites |
| --- | --- |
| `classList` → `class` | 222 lines, 129 files |
| `createQuery`/`createMutation`/… → `use*` | 660 calls |
| Kobalte imports, all wrapped in `src/ui` (Tooltip, Popover, Menu, Switch, Dialog) plus Tabs in `RunModal` | 8 files |
| `lucide-solid` imports | 251 files |
| `JSX.*` type references (move to `@solidjs/web`) | 183 lines, 89 files |
| `solid-js/store` imports | 33 files |
| `.Provider` | 16 lines, 11 files |
| `batch(` (remove, then check behavior) | 33 lines, 10 files |
| `mutateAsync` | 17 |
| `onMount` → `onSettled` | 21 |
| `<Index>` → `<For keyed={false}>` | 8 lines, 5 files |
| `splitProps` | 7 |
| `solid-js/web` imports | 6 |
| `unwrap` / `produce` | 5 / 5 |
| `<Suspense>` | 3 |
| `<Dynamic>` | 3 (still works) |
| `createResource` (`CatalogRows.tsx`) | 1 |
| `on:keydown` (`RunFind.tsx`) | 1 |

**Per-site judgment:**

- **292 `createEffect` calls in 138 files.**
  - 91 already use `on()` and convert cleanly.
  - The other ~200 need someone to separate what the effect tracks from what it does.
  - 49 files register `onCleanup` alongside their effects; that cleanup moves to the apply half.
- **248 path-style store setter calls** over 50 stores in 32 files become draft writes.
- **`createComputed` in `lib/clock.ts`.** `useNow` relies on it to start the clock before the first
  read. That needs a new design (perhaps `createMemo` with the `unobserved` callback).
- **About 93 top-level prop reads:**
  - 34 `createSignal(props.x)`, which become `createSignal(() => props.x)` where the value should
    follow the prop;
  - about 59 `const x = props.y` at the top of a component body.

  Today these only warn, but each is a place where a value may not update.
- **20 ref callbacks.** Check each for owned work such as `onCleanup`.

**Router:**

- 327 `<A>` uses in 119 files become `<a>`. The 17 `activeClass`/`end` uses, and the CSS behind active
  links, move to `[aria-current]` and `[data-active]` selectors.
- `<Navigate>` is used in 26 files.
- The route tree in `App.tsx` (228 lines) becomes a `createRouter` config.
- 16 test files use `MemoryRouter`/`createMemoryHistory`; they move to the `memoryHistory` adapter.
- `useNavigate`, `useParams`, `useSearchParams` and `useLocation` (about 140 imports) mostly stay as
  they are.

**Semantic (where bugs will hide):**

- **Data loading.**
  - There are about 1,480 `.data` reads, 506 `.isPending`, 280 `.isError` and 58 `.isLoading`
    against 198 queries.
  - Today, almost every view reads `query.data ?? fallback` and shows its own loading state.
  - Under Solid Query 6, the first `data` read with no `<Loading>` above it suspends whatever is
    above it. So each page needs a decision about where its `<Loading>` and `<Errored>` boundaries go.
  - The 3 existing `<Suspense>` boundaries already hit a v5 version of this problem (see the comment in
    `tasks/composer/MentionTextArea.tsx`).
  - This is a redesign of how every page loads data, not a find-and-replace. It's the largest and least
    predictable part of the upgrade.
- **Microtask batching.**
  - Any handler that writes a signal and then reads it, or reads the DOM, sees the old value.
  - Typecheck won't catch it; only tests and use will.
  - 408 `fireEvent` calls in tests assert after a synchronous write. Expect many tests to need
    `await` or `flush()`, depending on what testing-library 1.0 does on its own.
- **Writes in owned scopes throw in dev.**
  - 1.x let you write a signal in a memo, a component body or an effect without complaint; 2.0
    throws in dev.
  - Some of the 1,257 `createSignal` call sites are written from those places.
  - These turn up at runtime, one at a time, through the dev diagnostics.

### What helps

- Each library sits behind a single seam:
  - Kobalte is wrapped in `src/ui`;
  - queries go through `queryKeys` and a shared `queryClient`;
  - API calls go through `src/api`.
- ui-new has a Playwright smoke suite (8 specs, mocked API) that doesn't depend on the framework, plus
  `E2E_LIVE=1` read-only runs.
- The SolidJS skill and `/pm` setup already handle splitting work by area across agents.

## Proposal

### Now: prep that's safe on Solid 1.x

Each item below works on 1.9, shrinks the later upgrade, and can go to `main` on its own.

1. **Decide about Kobalte.** Either wait for Kobalte 2 to reach beta, or replace our 6 primitives
   with our own, built on the platform: `<dialog>` for Dialog, the Popover API for
   Popover/Tooltip/Menu, and plain components for Switch and Tabs. A half-day spike on Dialog and
   Menu would show what replacing costs: focus handling, keyboard navigation, and typeahead in Menu.
   Replacing removes the biggest blocker, and the wrappers keep it to `src/ui` plus `RunModal`.
2. **Own the icon component.** Replace `lucide-solid` with a small local `Icon` that renders from the
   framework-free `lucide` package's icon data, written so it works on both 1.x and 2.0. The 251
   import sites change by script.
3. **Remove the one-offs that already have 1.x replacements:**
   - `createResource` in `CatalogRows`;
   - `on:keydown` in `RunFind`;
   - `createComputed` in `clock.ts`;
   - `<Navigate>` → `useNavigate()` in the route component (26 files).
4. **Decide where loading boundaries go**, written up in `decisions.md`:
   - where `<Loading>`/`<Errored>` sit per page (shell, page, section);
   - how a section shows "refreshing" (`isPending`);
   - which views must never blank (lists that hold their data through a refetch).

   This is the design call the upgrade needs, and it can be made now, against today's pages.
5. **Check the assumptions** before committing to dates:
   - run `solid-migration-assistant` once in a scratch copy;
   - on a throwaway branch, port one data-heavy page (Tasks or TaskFiles) end to end on Solid 2 +
     Router 2 + Query 6 rc.

   The result gives a real per-page cost for the data layer.

### Then: the upgrade, when its conditions are met

**When:**

- `@tanstack/solid-query` 6 is stable;
- Kobalte is replaced, or Kobalte 2 is at least beta;
- `@solidjs/testing-library` 1.0 is stable, or its RC has held up in the spike;
- Solid 2.0.x has had a few quiet weeks.

Watch npm `dist-tags` for these; it could fit the weekly upstream watch.

**How:** one branch, `feat/solid-2`. A single app can't run Solid 1 and Solid 2 side by side, so this
can't land a piece at a time. Phases:

1. **Toolchain.** Bump the packages above, switch to `@solidjs/vite-plugin`, set
   `jsxImportSource: "@solidjs/web"`, and get typecheck running.
2. **Scripted pass.** Do every row in the "Mechanical (scriptable)" table, plus `create*` → `use*`
   and `mutateAsync`. These are scripts reviewed as diffs, not done by hand.
3. **Effects and stores, by area.**
   - Split the 292 effects, starting with the 91 that use `on()`.
   - Convert the 248 path setters to drafts.
   - Fix top-level reads and refs.

   Agents divide by folder (tasks, agents, projects, settings, …).
4. **Router 2.**
   - Move `App.tsx` to a `createRouter` config.
   - Change `<A>` to `<a>` and active-link styling to `[aria-current]`/`[data-active]`.
   - Move the tests to `memoryHistory`.
5. **Data loading.** Place boundaries by the decision from prep item 4 and rewrite each page's loading
   and error states. This is the long phase.
6. **Tests and checks.**
   - Get the 287 unit test files passing under async batching.
   - Get the Playwright suite green.
   - Fix every dev diagnostic.
   - Walk every page against the dev instance.
   - Go through the capabilities checklist, so nothing is lost by accident.

**Size:**

- Phases 1–4 are large but predictable: a few days each with agents working in parallel.
- Phase 5 depends on the boundary design and the spike, and could take as long as everything else
  combined.

A rough total is 2–4 weeks of `/pm`-managed work. The spike should replace that guess with a real
number.

### What we get for it

- **Less loading code.** Async in the graph, plus Query 6's suspending `data`, should remove much of
  the hand-written loading and error branching across about 300 files.
- **Cleaner optimistic updates.** `action` and the optimistic primitives replace the
  mutate-then-invalidate code in mutations.
- **Data items keep their identity across refetches**, with fine-grained updates inside them.
- **Earlier warnings.** The dev diagnostics flag reactive mistakes at the line that makes them, which
  suits work done by agents.
- **Typed routes** (the `paths` proxy, typed search params) and scroll restoration.
- **Staying current.** The Solid ecosystem (`@solid-primitives` is already on 2.x) will move off 1.x
  over the next year.

None of this is urgent: 1.x is maintained, and ui-new works. The cost of waiting is low, and the cost
of going now is mostly paid in workarounds for libraries that aren't ready.
