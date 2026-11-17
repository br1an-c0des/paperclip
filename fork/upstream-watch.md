# Upstream watch ledger

The record the [`upstream-watch` skill](../.claude/skills/upstream-watch/SKILL.md) keeps: the last
upstream commit reviewed, and the decision on each candidate, so nothing is reviewed twice. Since the
hard fork ([hard-fork-plan.md](hard-fork-plan.md#watching-upstream)), upstream comes into `main` only
by cherry-pick from these reviews.

- **Freeze point:** `79c8cf8b6` (tag `upstream-freeze`, 2026-11-17)
- **Last reviewed:** `79c8cf8b6` (the freeze; no review yet)
- **Last checked:** 2026-11-17

Decisions: **taken** (with our commit), **skipped** (with the reason), **port later** (a good idea
whose code doesn't fit; becomes a task or a build plan entry), **pending** (reported, not decided).

## Reviews

None yet.
