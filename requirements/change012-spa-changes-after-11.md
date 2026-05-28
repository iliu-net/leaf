# Timestamp & Author Field Consolidation

## Motivation

The SPA and server had inconsistent timestamp units: the server wire protocol uses
unix seconds, while the client stored milliseconds from `Date.now()`.  Server
timestamps (`created_at`, `updated_at`, `deleted_at`) were typed in `api.ts` but
never wired through to the database layer.  Author fields (`deleted_by`,
`renamed_by`) were similarly typed but dropped in transit.

Three separate date formatters lived in `meta-panel.ts`, `render-fm.ts`, and
`history-view.ts` — all doing the same thing with different unit assumptions.

## Requirements

### R1 — Single timestamp unit everywhere

All timestamps stored in IndexedDB (`NoteRecord.created_at`, `.updated_at`,
and tombstone effective `deleted_at`) SHALL be unix seconds.

`Date.now()` SHALL NOT appear in any data-layer module (`db.ts`, `sync.ts`,
`trash-service.ts`).  A single helper `nowSec()` in `utils.ts` provides the
current timestamp in seconds.

### R2 — Server timestamps flow through to IndexedDB

`dbApplyServerChange()` SHALL accept `serverCreatedAt` and `serverUpdatedAt`
parameters and use them as the authoritative timestamp when present.
Fallback to the existing record's value, then to `nowSec()`.

The sync layer (`sync.ts`) SHALL extract `created_at`, `updated_at`, and
`deleted_at` from `SyncResponseObj` and pass them to `dbApplyServerChange()`.

### R3 — Author fields flow through for all operation types

| Operation | Server field | Stored as |
|-----------|-------------|-----------|
| CREATE / UPDATE | `author` | `updated_by` |
| CREATE / UPDATE | `created_by` | `created_by` |
| DELETE | `deleted_by` | `updated_by` |
| RENAME | `renamed_by` | `updated_by` |

The sync layer SHALL route the correct field per operation type.  The DELETE
and RENAME branches of `dbApplyServerChange()` SHALL update `updated_by`
rather than leaving the prior editor's name.

### R4 — Single timestamp formatter

There SHALL be exactly one `formatTimestamp(ts)` function, exported from
`utils.ts`, consumed by `meta-panel.ts`, `render-fm.ts`, and `history-view.ts`.

The function SHALL accept a unix-seconds timestamp and return a human-readable
string.  It SHALL read `timestamp_format` from `SpaConfig` to determine the
output format.

### R5 — PHP `date()` token support in `timestamp_format`

When `timestamp_format` is a non-null string, it SHALL be interpreted as a
PHP `date()` format string.  Supported tokens:

```
Y y m n d j H G h g i s A a
```

Unrecognized characters SHALL pass through literally (dashes, colons, spaces).
When `timestamp_format` is `null`, the function SHALL fall back to
`Date.toLocaleString()`.

### R6 — `relativeTime()` centralized

The relative-time helper from `trash-view.ts` SHALL move to `utils.ts`, accept
a unix-seconds timestamp, and return strings like `"3 hours ago"`.

### R7 — Purge cutoff in seconds

`dbPurgeDeletedNotes()` SHALL compute its cutoff as `nowSec() - ttlDays * 86400`.

### R8 — No migration required

The SPA may wipe local data and re-sync from the server.  No Dexie schema
version bump or timestamp-unit detection is needed.

## Affected modules

| File | Change |
|------|--------|
| `utils.ts` | Added `nowSec()`, `formatTimestamp()`, `relativeTime()` |
| `db.ts` | All `Date.now()` → `nowSec()`; `dbApplyServerChange` gains `serverCreatedAt`/`serverUpdatedAt`; DELETE/RENAME branches update `updated_by` |
| `sync.ts` | `applyServerChanges` extracts and routes `created_at`, `updated_at`, `deleted_at`, `deleted_by`, `renamed_by` |
| `trash-service.ts` | `Date.now()` → `nowSec()` in server restore path |
| `meta-panel.ts` | Deleted local `formatTimestamp`, imports from `utils` |
| `render-fm.ts` | Deleted inline `fmt`, imports `formatTimestamp` from `utils` |
| `history-view.ts` | Deleted local `formatDate`, imports `formatTimestamp` from `utils` |
| `trash-view.ts` | Deleted local `relativeTime`, imports from `utils` |

## Unaffected modules

`api.ts`, `config.ts`, `notes.ts`, `frontmatter.ts`, `app.ts`, `auth.ts`,
`ui.ts`, `app-trash.ts`, `app-files.ts`, `app-auth.ts`, `editor.ts`,
`view-panel.ts`, `sidebar-chrome.ts`, `tree.ts`, `change-bus.ts`,
`markdown.ts`, `diff.ts` — all pass timestamps as opaque numbers or
delegate to the modules above.

## Test changes

- `utils.test.js`: +17 tests (`nowSec` ×3, `formatTimestamp` ×3, `relativeTime` ×11)
- `db.test.js`: purge tests updated from ms constants to `nowSec()` + seconds
- All other test files pass without modification
