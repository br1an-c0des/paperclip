---
name: para-memory-files
description: >
  Use a file-based PARA memory system to store, retrieve, and organize durable
  knowledge across sessions. Trigger on saving facts, daily notes, entity
  records, weekly synthesis, recall, tacit user patterns, or plan memory.
---

# PARA Memory Files

Persistent, file-based memory organized by Tiago Forte's PARA method. Three layers: a knowledge graph, daily notes, and tacit knowledge. All paths are relative to `$AGENT_HOME`.

## Three Memory Layers

### Layer 1: Knowledge Graph (`$AGENT_HOME/life/` -- PARA)

Entity-based storage. Each entity gets a folder with two tiers:

1. `summary.md` -- quick context, load first.
2. `items.yaml` -- atomic facts, load on demand.

```text
$AGENT_HOME/life/
  projects/          # Active work with clear goals/deadlines
    <name>/
      summary.md
      items.yaml
  areas/             # Ongoing responsibilities, no end date
    people/<name>/
    companies/<name>/
  resources/         # Reference material, topics of interest
    <topic>/
  archives/          # Inactive items from the other three
  index.md
```

**PARA rules:**

- **Projects** -- active work with a goal or deadline. Move to archives when complete.
- **Areas** -- ongoing (people, companies, responsibilities). No end date.
- **Resources** -- reference material, topics of interest.
- **Archives** -- inactive items from any category.

**Fact rules:**

- Save durable facts immediately to `items.yaml`.
- Weekly: rewrite `summary.md` from active facts.
- Never delete facts. Supersede instead (`status: superseded`, add `superseded_by`).
- When an entity goes inactive, move its folder to `$AGENT_HOME/life/archives/`.

**When to create an entity:**

- Mentioned 3+ times, OR
- Direct relationship to the user (family, coworker, partner, client), OR
- Significant project or company in the user's life.
- Otherwise, note it in daily notes.

For the atomic fact YAML schema and memory decay rules, see [references/schemas.md](references/schemas.md).

### Layer 2: Daily Notes (`$AGENT_HOME/memory/YYYY-MM-DD.md`)

Raw timeline of events -- the "when" layer.

- Write continuously during conversations.
- Extract durable facts to Layer 1 during heartbeats.

### Layer 3: Tacit Knowledge (`$AGENT_HOME/MEMORY.md`)

How the user operates -- patterns, preferences, lessons learned.

- Not facts about the world; facts about the user.
- Update whenever you learn new operating patterns.

## Write It Down -- No Mental Notes

Memory does not survive session restarts. Files do.

- Want to remember something -> WRITE IT TO A FILE.
- "Remember this" -> update `$AGENT_HOME/memory/YYYY-MM-DD.md` or the relevant entity file.
- Learn a lesson -> update AGENTS.md, TOOLS.md, or the relevant skill file.
- Make a mistake -> document it so future-you does not repeat it.
- On-disk text files are always better than holding it in temporary context.

## Memory Recall -- Summaries First, Then Search

Read before you search. The layout is built for it:

1. `$AGENT_HOME/life/index.md` -- which entities exist.
2. The entity's `summary.md` -- quick context. Open `items.yaml` only when you need the atomic facts.
3. `$AGENT_HOME/MEMORY.md` -- how the user operates.

When you don't know where something lives, search the files with `rg` (`grep -r` if `rg` is missing):

```bash
rg -i "christmas" "$AGENT_HOME"                  # Keyword, case-insensitive
rg -il "acme" "$AGENT_HOME"                      # List matching files only
rg -i "deadline" "$AGENT_HOME/life/projects"     # One PARA area
rg -i -C 2 "jeff" "$AGENT_HOME/memory"           # Daily notes, with 2 lines of context
grep -ril "acme" "$AGENT_HOME"                   # Fallback when rg is missing
```

Search matches words, not meaning. If nothing turns up, try synonyms, partial names, and dates (`2026-03`) before concluding there is no memory of it. Cold facts drop out of `summary.md` but stay in `items.yaml`, so a search still finds them. Skip facts marked `status: superseded` unless you need the history.

## Planning

Keep plans in timestamped files in `plans/` at the project root (outside personal memory so other agents can access them). Search them with `rg -i "<topic>" plans/`. Plans go stale -- if a newer plan exists, do not confuse yourself with an older version. If you notice staleness, update the file to note what it is supersededBy.
