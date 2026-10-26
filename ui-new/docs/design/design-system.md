# Capsule Stack design system

The visual language for `ui-new`. It merges two directions from the Paperclip Style Lab: **Daylight
Stack** (raised cards, a white selection pill, the project header with rising disc stacks) and
**Capsule** (vertical gradient capsules for status, three bars for priority, outline label pills, a
breathing capsule for "running").

- [tokens.css](tokens.css) holds every color, gradient, radius and font as CSS custom properties.
  Copy it into `ui-new` when building; don't retype values.
- [style-guide.html](style-guide.html) shows the tokens and components in both themes. Open it in a
  browser straight from disk.
- [boards.md](boards.md) lists every screen and which components it uses. The board sources in
  [boards/](boards/) are the reference for exact markup and spacing.

Where this document and a board disagree, the board wins, and this document should be fixed.

## Principles

- **One interface, no switches.** The design settles each choice instead of hiding variants behind
  flags (see [CLAUDE.md](../../../CLAUDE.md#intentions)). The board tweaks for theme, display face
  and grain exist to compare options, not as user settings, except light and dark.
- **Dark by default, light supported.** Every screen is drawn dark. Light uses the same components
  with different token values.
- **Color means state.** Gradients are reserved for status, kinds of request, agents and live
  activity. Everything else is neutral. A new feature should not introduce a new hue.
- **Calm until something needs you.** Menus, popovers and suggestions start closed. Helper text is
  short or moved into a tooltip. Bright markers are kept for things that need attention.

## Themes and tokens

Put `dark` or `light` on the app root, plus `f-hanken`. All boards define the identical set below.

### Surfaces and text

| Token | Use |
| --- | --- |
| `--ground` | Page background, inset fields, footers of dialogs |
| `--card` | Cards, menus, popovers, modals |
| `--card-edge` | Card border (transparent in light, where the shadow does the work) |
| `--well` | Tinted wells inside cards, segmented-control and tab tracks, hover on menu items |
| `--sel`, `--sel-shadow` | The raised pill for the selected tab, segment or nav item; tooltip background |
| `--hover`, `--row-hover` | Hover on nav and ghost buttons; hover on list rows |
| `--line`, `--row-line` | Dividers between sections; dividers between rows |
| `--edge`, `--dashed` | Control borders (buttons, inputs, menus); dashed "add" and scheduled outlines |
| `--code` | Code blocks, prompts and raw output |
| `--text`, `--body`, `--muted` | Headings and values; paragraphs; metadata, captions, placeholders |
| `--primary`, `--on-primary` | Primary buttons, the "You" avatar, switch on |

### Tones

Each tone is a background with a matching foreground: `--run-*` (running, links, focus), `--violet-*`
(proposals, suggestions), `--amber-*` (waiting on you, approvals), `--red-*` (blocked, failed,
destructive), `--green-*` (done, merged, suggested tasks), `--cyan-*` (questions). Use them for
tinted pills, alerts and selected options, never for large areas.

### Status gradients

| Name | Token | Means |
| --- | --- | --- |
| Ion | `--g-ion` | In progress, running, live |
| Orchid | `--g-orchid` | In review; proposals |
| Ember | `--g-ember` | Todo, waiting on you; approvals |
| Flare | `--g-flare` | Blocked, failed |
| Ash | `--g-ash` | Backlog, idle (changes with the theme) |
| Lagoon | `--g-lagoon` | Done, healthy; suggested tasks |
| Tide | `--g-tide` | Questions |

Capsules run top to bottom (180deg). Avatar discs and markers use the same stops at 160deg. Gradients
may carry the grain overlay (`.grain`, fed by one `#grain` SVG filter per page).

### Other

`--pri-on`, `--pri-off` (priority bars and switch off), `--ash-a`, `--ash-b` (Ash stops), `--scrim`
(behind modals), `--disc-shadow` (disc stacks), `--knob-off` (switch knob when off),
`--grain-blend` and `--grain-op`.

## Type

| Role | Face and size | Example |
| --- | --- | --- |
| Page title | Display 800, 34px, line-height 1, tracking `--dtrack` | Project and agent names in the header card |
| Card title | Display 800, 22px | "Last 7 days", "Today" |
| Section title | Display 800, 15px, tracking -.01em | "Open work", "Subtasks" |
| Request title | Display 800, 19px (17px compact) | "OK to backfill 2022–2024 from Coinalyze?" |
| Dialog title field | Display 800, 22px | New task title |
| Body | Hanken Grotesk 400–500, 14px, line-height 1.4–1.55 | Descriptions, request bodies |
| Control text | Hanken Grotesk 600–800, 13px | Buttons, pills, tabs |
| Meta | Hanken Grotesk 500–600, 12px, `--muted` | Timestamps, counts, captions |
| IDs and code | Fragment Mono, 12–13px | `TRA-41`, run numbers, timers, prompts |

The display face is Hanken Grotesk (`--display`). Bricolage Grotesque was the runner-up and only exists
as a board tweak. Bold weights mark the selected item: a selected tab or nav item goes from 600 to 800.

## Shape, spacing and layout

- **Radii:** pills 999px (buttons, chips, capsules, tabs, nav items); cards, menus and request cards
  18px; inner wells, options and tooltips 14px; inputs 12px; full dialogs 24px; heatmap cells 6px.
- **Control heights:** 28px (segments), 30–32px (compact buttons, pills in headers), 36–38px (main
  buttons, nav items, icon buttons), 44px (menu items with a description).
- **App shell:** a 248px left nav, then the main column with 24px side gutters. Page header card at
  the top (14px from the top edge), then content cards 16px apart.
- **Cards:** 16–22px padding. List rows are at least 50px tall with `--row-line` between them.
- **Boards are 1440px wide** and drawn at that width only. Responsive behavior is still to be
  designed; keep layouts in grids and flex rows with `minmax(0, 1fr)` so they can shrink. The
  [build plan](../build-plan.md#desktop-first-ready-for-mobile) lists the rest of what keeps mobile
  cheap to add later.

## Elevation and layers

- `--shadow` lifts cards. `--shadow-lg` is for anything floating: menus, popovers, tooltips, dialogs.
- The page header's links, buttons and tabs sit at `z-index: 1` (so the whole header card can be a
  link to the dashboard). **Anything that overlays the page needs an explicit z-index above that.**
  This caused the "header shows through the dialog" bug on boards 6, 7 and 7b. Use:
  - `--z-tooltip` (20) for tooltips,
  - `--z-popover` (30) for menus and popovers, with an invisible full-page click-catcher one below,
  - `--z-overlay` (50) for the scrim behind dialogs.

## Status system

- **Task status** is a capsule: 7×18px in pills, 6×16px at the start of a row, 8×20px in group
  headers. Pill = capsule + label + muted count on `--ground`.
- **Priority** is three rising bars (4px wide; 7, 10 and 14px tall). High fills all three with
  `--pri-on`, Medium two, Low one; Critical fills all three in red.
- **Running** uses the Ion capsule with the `.live` breathing animation, in a `--run-bg` pill, and a
  2px Ion ring around the agent's avatar. Respect `prefers-reduced-motion`.
- **Labels** are outline pills with a small gradient dot.
- **Blocked** time and cells use a red diagonal hatch; paused uses a grey hatch.

## Components

Board numbers refer to [boards.md](boards.md).

| Component | Spec | Boards |
| --- | --- | --- |
| Left nav | 248px. Company switcher, search and new-task buttons; Inbox; projects (disc avatar, count); agents (live ring when running); you and settings at the bottom. Selected item uses the `--sel` pill. | All except 15, 30, 34 |
| Page header card | `.ph`: breadcrumb, display title (links to the dashboard; a "Project dashboard" pill appears on hover), key numbers, agent avatars, and the section tabs in a `--well` track below a divider. | 1–7, 7b, 9–11, 16, 17, 31, 32 |
| Section tabs and segmented control | Pill track on `--well`, 3–4px padding, selected item raised with `--sel` and weight 800. Tabs use `aria-current`, segments `aria-pressed`. | Most boards |
| Buttons | Primary: `--primary` fill, 800. Secondary: `--edge` outline. Danger: red outline. Quiet: text only. Icon: 36px circle. Compact versions are 32px. | All |
| Text fields | Bordered, `--ground` fill, 12–14px radius, 2px `--run-fg` focus ring. Titles use the display face. | 7b, 10, 11, 21–29 |
| Settings rows | `.frow`: 220px label column with help text, control on the right; `.chead` card header; `.cfoot` actions. | 10, 11, 21–29 |
| Switch | 36×20px pill, 14px knob; on = `--primary`, off = `--pri-off`. `role="switch"`. | 9–11, 21–29 |
| Options | Bordered rows with a radio or checkbox; the chosen one gets `--run-bg` and a `--run-fg` border. | 14, 15, 7b |
| Menus and listboxes | `--card`, `--edge` border, 18px radius (16px for small listboxes), 6px padding, `--shadow-lg`. Open 6–8px below the trigger, aligned to its nearer edge; footer menus open upward. Items 38px (44px with a description), 12px radius. | 7b |
| Popover | A request or detail card floated under a pill button, 500px wide, `role="dialog"`, closes on outside click, ✕ or "Not now". | 31–33 |
| Tooltip | `--sel` background, `--edge` border, 14px radius, 280px wide; on hover and focus; never interactive. | 31–33 |
| Group card | Card per status: header with capsule, title and count; task rows with ID, title, state pill, priority bars, avatar. Groups can collapse. | 1, 4 |
| Task panel | Opens docked beside the list (2, 3, 5) or as a modal over the project (6, 7) with Details, Activity and Docs and files sections. Docked, it takes its own grid column and looks like a card (`--shadow`, 18px radius). The list keeps its full row width: one sideways scroll moves every group card (`.dock-x`), and the Name column stays pinned (`.pin-col`) unless the pin in the column headings turns it off. | 2, 3, 5, 6, 7 |
| New task dialog | Status, priority, labels and "More fields" on top; bordered title and description; attachments; one assignment row (assignee capsule with model and effort, reviewer, + for approver and watchdog); small pills for work mode, workspace and review policy beside the create button. | 7b |
| Request card | `.rq`: kind stripe on the left, top row (kind tag, tags, subject, time left), ask line, title, body, kind-specific response (options, chips, diff, code, meter), "what happens next" note, actions. Kinds: question (Tide), proposal (Orchid), approval (Ember), suggested tasks (Lagoon). Answered cards settle into a quieter style. | 15 (the full catalog), 3, 6, 8, 12–14, 16–18, 31–33 |
| Run modal | 24px-radius dialog over a scrim: run header and stats, tabs (transcript, what the agent was sent, output), tool calls, thinking, diffs, raw log. | 16, 17, 18 |
| Agent chat | Endless conversation with the agent, live reply with caret, activity timeline on the right. | 12, 13, 18 |
| Workload | Today lanes (run bars on an hour grid with a "now" line), heatmap (5-step Ion scale, blocked and paused hatches), "who's waiting on whom" chains, open-work bars, row markers with tooltips. | 31, 32, 33 |
| Avatars | ClipLab 3D avatars; the agent's status picks the pose; 17 palettes. Gradient initials discs stand in at small sizes. | 34 (reference), 8, 19 |
| Disc stacks and meters | Rising disc columns for counts by status; budget and progress meters as thin rounded bars; run steps as overlapping discs. | 1, 8 (disc stacks); 8, 25, 31–33 (meters) |

## Interaction rules

- Menus, popovers and suggestions **start closed**. One menu is open at a time; picking an item,
  clicking outside or pressing Escape closes it. A menu that offers several picks (like assignee,
  model and effort) stays open until "Done".
- Suggestions from Paperclip are **never shown inline by default**. They sit behind a small violet
  pill ("1 suggestion") that opens them as a popover.
- **Detail on demand:** secondary explanations go into tooltips (workload markers, chain summaries),
  not under every item.
- **Focus** is a 2px `--run-fg` ring (outline or inset box-shadow). Every interactive element is a
  real `button` or `a`.
- **Motion** is limited to the breathing capsule, 120–150ms hover lifts and fades, and the avatar
  poses. All of it stops under `prefers-reduced-motion`.

## Writing

- Sentence case everywhere; plain words ("Waiting on you", "Open work", "Not now").
- Agents are named by role ("Quant Researcher"); the signed-in person is "You".
- IDs, run numbers, timers and code are in Fragment Mono.
- Numbers lead: "16 open", "2 running", "$142 of $300".

## Accessibility

- Patterns the boards use: `role="switch"` with `aria-checked`, `role="menu"` and `menuitemcheckbox`,
  `role="listbox"` and `option` with `aria-selected`, `role="dialog"` for popovers and modals,
  `aria-pressed` on segments, `aria-current="page"` on nav and tabs, `aria-expanded` and
  `aria-haspopup` on triggers.
- Decorative capsules, bars and SVGs are `aria-hidden`; their meaning is in visible text or an
  `aria-label` (a priority's label, a marker's summary).
- Color is never the only signal: statuses carry labels, blocked cells carry a hatch as well as red.
