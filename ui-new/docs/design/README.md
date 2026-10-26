# Redesign handoff

The approved design for `ui-new`, snapshotted from the design canvas so it can be built from the repo.
The canvas stays where design work happens; this folder is the version the code is built against.

| File | What it is |
| --- | --- |
| [boards.md](boards.md) | Every screen: what it's for, its states, and the capabilities it covers |
| [design-system.md](design-system.md) | Capsule Stack: tokens, type, layout, status system, components, interaction rules |
| [tokens.css](tokens.css) | The tokens as CSS custom properties, ready to copy into `ui-new` |
| [style-guide.html](style-guide.html) | The tokens and components drawn in both themes; open it in a browser from disk |
| [boards/](boards/) | The 35 board sources and the canvas index (`canvas.json`) |

## Source

- Canvas: "Paperclip Redesign · Capsule Stack", [private link](https://claude.ai/artifact/KNuRysLCSPp4PXroYT2xXB)
- Snapshot: version `1792883383-89e5`, October 24, 2026
- Style origin: "Paperclip Style Lab", [private link](https://claude.ai/artifact/XdZgQsFkwnvQnZDwzqpWSS)
  (directions A and C, merged). The boards have moved on since; where they differ, the boards win.

## Reading a board file

Each `*.dc.html` file is one screen. The canvas runtime it needs (`support.js`) isn't included, so the
files don't render on their own. Open the canvas to see them, and read the files for exact markup,
spacing and behavior. The format maps closely onto SolidJS:

| In the board | In SolidJS |
| --- | --- |
| `{{name}}` and `{{item.field}}` | A prop, signal or memo |
| `<sc-for list="{{items}}" as="item">` | `<For each={items()}>` |
| `<sc-if value="{{open}}">` | `<Show when={open()}>` |
| `onClick="{{toggle}}"` | An event handler |
| `this.state` and `this.setState()` | Signals or a store |
| `renderVals()` | Derived values; its literals are sample data |
| `data-props` | The board's tweaks: theme, display face, grain, and states like `range` or `section` |

Notes:

- The CSS in each `<helmet>` starts with the tokens and then the component classes. Boards were
  restyled in place, so a class is sometimes defined twice. The **last** rule is the one drawn.
- Sample data is made up. Real data comes from the API: each capability ID in
  [boards.md](boards.md) links, through the [checklist](../inventory/capabilities.md), to an area
  guide that lists the requests behind it.
- Agent avatars are images embedded in the files: the four project agents in every project page's
  header, many more on board 8, and the full set on board 34. That's why boards 8 and 34 are large.

## Suggested build order

1. **Tokens and base:** [tokens.css](tokens.css), fonts, the `.card`, `.disp`, `.live` and grain
   basics.
2. **Shell:** left nav, page header card with tabs, the section rail used by settings.
3. **Shared components:** buttons, fields, switches, segmented controls, menus, popovers, tooltips,
   status capsules and priority bars, the request card.
4. **Screens:** tasks (1–7b), then project (8–11, 31), inbox and requests (14), runs (16), agents and
   chat (12, 19, 20), settings (21–30).

## Open questions

- **Panel or modal.** A task opens beside the list on boards 2, 3 and 5, and as a modal on boards 6
  and 7. Which one is the default, and when is the other used? The
  [build plan](../build-plan.md#decisions-to-make-early) recommends one (decision B).

## Still to design

More boards are on the way. Development starts on the current ones without waiting for them; the
[build plan](../build-plan.md#design-still-coming) says how it handles the gaps.

- **Capabilities with no board yet.** These have an empty "New home" in the
  [checklist](../inventory/capabilities.md):
  - The command palette, keyboard shortcuts, search, toasts.
  - Goals (a task property and a project setting; lists are on hold, see
    [decision 14](../decisions.md#14-lists-need-their-own-storage-so-theyre-on-hold)), routines (now
    recurring tasks), cases.
  - New project and new agent.
  - Workspaces, skills, connectors, activity.
  - Onboarding and sign-in.
- **Settings drawn only as an outline.** Board 30 lists sections with no board of their own:
  - Organization: Environments, Import and export, plugin sections such as Linear sync.
  - Agent: Profile, Skills, Tools and channels, Secrets and variables, Budget, Permissions and trust,
    API keys, History.
  - App: Account, Organizations, Admins, Plugins.
- **Mobile layouts**, possibly. Every board is drawn at 1440px only. The screens that set the structure
  help most if they come first: the shell and navigation, the task list, the task panel and modal, the
  Inbox, and the agent chat.

## Refreshing the snapshot

When the canvas changes:

1. Download the boards and `canvas.json` again and replace [boards/](boards/).
2. Update the version and date above.
3. Update [boards.md](boards.md) and [design-system.md](design-system.md) where screens or components
   changed.
4. If the theme blocks changed, update [tokens.css](tokens.css). Every board defines the same set, so a
   diff of one board's `.light` and `.dark` blocks is enough.
5. Record any new API gaps in [decisions.md](../decisions.md).
