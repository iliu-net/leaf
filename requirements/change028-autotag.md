# Change 028 — Auto-tagging

## Summary

Notes are automatically tagged based on word→tag rules defined in a special
`_tagcloud` note. When a note is saved locally, its body text is scanned
against these rules. Matching tags are written to the `auto-tags` frontmatter
key, merged with `user-tags` for display, and serialised into the stored
content so they survive sync.

The feature is **opt-out per note** (`!*` in `user-tags`) and **only fires on
local save** — sync-received notes carry their author's tags without
re-scanning.

---

## Motivation

Manual tagging is friction. Users who follow consistent naming conventions
(project codes, client names, invoice numbers) shouldn't need to type tags
for every note. This also enables organisational conventions — a team can
share the `_tagcloud` note to enforce a shared tagging taxonomy.

---

## `_tagcloud` note format

A regular user note with id `_tagcloud`. Custom frontmatter keys are tag
names; bracket-array values are case-insensitive word-boundary trigger words.

```
---
title: Tag Cloud
finance: [invoice, receipt, budget, tax]
work: [meeting, presentation, deadline]
development: [bug, feature, refactor, deploy]
---
```

The body is ignored — only frontmatter custom fields define rules.

---

## Tag merge rules

Auto-tags and user-tags are merged at display time (View panel). The merge
follows these rules:

| User-tags contains | Effect |
|---|---|
| *(nothing)* | Auto-tags are shown as-is |
| `important` | Auto-tags `∪` user-tags |
| `!work` | `work` is dropped from auto-tags; silently ignored if absent |
| `!*` | All auto-tags discarded; only non-negated user-tags survive |

Negated tags (`!tag`) are **not** persisted to `auto-tags` — they only
influence the final merged set in the View panel. The `auto-tags` key in
frontmatter always contains all matches.

---

## When scanning happens

| Trigger | Scan? | Rationale |
|---|---|---|
| Local save (autosave / Ctrl+S) | Yes | Content originates here |
| Sync-receive CREATE/UPDATE | No | Remote author already tagged it |
| Note opened for viewing | No | Read-only, no write needed |
| `_tagcloud` edited | On next save of each note | Lazy — notes rescanned when next saved |

---

## Disabling auto-tagging

**Per note:** Add `!*` to `user-tags`. On the next save, `auto-tags` is
removed from the frontmatter entirely. No scan runs.

**Globally:** Delete the `_tagcloud` note or remove all its custom fields.
The scan finds zero rules and removes stale `auto-tags` from saved notes.

---

## Files created

| File | Purpose |
|---|---|
| `src/ts/autotag.ts` | Core engine: rule loading, content scanning, tag merging, and the `applyAutotags()` orchestrator |

## Files modified

| File | Change |
|---|---|
| `src/ts/notes.ts` | `saveNote()` calls `applyAutotags()` before the content-comparison guard so auto-tag changes (including removals from `!*`) are not skipped |
| `src/ts/render-fm.ts` | `renderFrontmatterTable()` now calls `mergeTags(userTags, autoTags)` instead of showing only `user-tags` |

---

## Architecture

```
saveNote(id, content)
  │
  ├─ applyAutotags(id, content)       ← autotag.ts
  │    │
  │    ├─ id === '_tagcloud' ? → skip (no self-tagging)
  │    │
  │    ├─ parseFrontmatter → user-tags includes '!*' ?
  │    │    yes → remove 'auto-tags' key, return
  │    │
  │    ├─ loadRules()                  ← cached; reads _tagcloud from IndexedDB
  │    │    └─ parseFrontmatter → custom keys → Rule[] (RegExp per word)
  │    │
  │    ├─ scanContent(body, rules)     ← \b word-boundary match, case-insensitive
  │    │    └─ → sorted deduplicated tag[]
  │    │
  │    └─ updateFrontmatter(content, { 'auto-tags': tags })
  │
  ├─ dbGetNote(id) → existing.content === content ?
  │    yes → return { ok: false }
  │
  └─ dbSaveNote(id, content) → publish('saved')
```

### Rule cache

`loadRules()` caches parsed `Rule[]` by `_tagcloud`'s `updated_at:current`
composite key. Cache is transparent — callers just `await loadRules()` and
get the latest without tracking invalidation themselves.

### Frontmatter key lifecycle

```
No _tagcloud exists  →  auto-tags key absent from all notes
_tagcloud created    →  auto-tags appear on next save of each note
!* added to note     →  auto-tags key removed on next save
!* removed           →  auto-tags re-populated on next save
_tagcloud edited     →  cache invalidated; new rules applied on next save
```

---

## Exports (autotag.ts)

| Export | Kind | Purpose |
|---|---|---|
| `loadRules()` | async | Load and cache rules from `_tagcloud` |
| `scanContent(body, rules)` | sync | Scan body text, return matched tag names |
| `mergeTags(userTags, autoTags)` | sync | Merge for display (handles `!*`, `!tag`) |
| `isAutotagDisabled(userTags)` | sync | `true` if `!*` is present |
| `applyAutotags(id, content)` | async | Orchestrator: scan + update frontmatter |
| `clearRulesCache()` | sync | Invalidate cache (testing / forced refresh) |
| `Rule` | type | `{ pattern: RegExp; tag: string }` |

---

## Future work

- **Tag sidebar mode** — browse notes grouped by tag (already planned,
  separate feature)
- **Regex patterns** — allow `pattern:` prefix in `_tagcloud` words for
  power-user matching beyond simple word boundaries
- **Bulk rescan** — explicit "Recompute all auto-tags" action after
  editing `_tagcloud`, instead of lazy per-note scan
