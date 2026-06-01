# Change 026 — PHP Storage Contract

## Summary

Added seven functions to `storage.php` that isolate `sync.php`, `history.php`,
and `trash.php` from the internal storage format (the `versions` map, tombstone
file layout, changelog mechanics).  After this change, no endpoint accesses
`$note['versions']`, and the only caller of `changelog_append()` outside
`storage.php` is the restore action in `trash.php` (which constructs a
semantically unique CREATE entry — not format knowledge).  Swapping the
flat-file backend for git or MySQL means rewriting only `storage.php`.

Implements item 1 from `TODO/refactor-php.md` as detailed in
`TODO/refactor-php-plan.md`.

Also renames two internal functions for consistency with the `storage_*` /
`changelog_*` naming convention:

| Old name | New name |
|---|---|
| `note_is_deleted()` | `storage_note_deleted()` |
| `next_rev()` | `changelog_next_rev()` |

## Motivation

Before:
- `sync.php`, `history.php`, and `trash.php` all navigated
  `$note['versions'][$current]` inline — duplicated across ~10 locations.
- Bootstrap and incremental sync paths used different code to read the same
  note data.
- `trash.php`'s preview action reached directly into the filesystem
  (`deleted_path()`, `file_exists()`, `file_get_contents()`, `json_decode()`).
- `apply_client_change()` was ~110 lines with embedded changelog construction
  and version-map access.

After: the storage layer owns all knowledge of the internal format.
Consumer endpoints work with normalized flat arrays and typed return values.

## Contract functions (all in `storage.php`)

### Phase 1 — `storage_get_note_full(string $id, int $client_id): ?array`

Normalized flat read for sync-protocol consumers.  Hides the internal
`versions` map.  The `$client_id` parameter carries the sync client ID
so the storage layer can clear the exclusive flag (and trigger staging
flushes for the git backend) without consumer awareness.

| Key | Source | Fallback |
|-----|--------|----------|
| `content` | Current version's `content` | `''` |
| `version` | Note's `current` pointer | `''` |
| `prev` | Current version's `prev` | `null` |
| `author` | Current version's `author` | `''` |
| `updated_at` | Current version's `saved_at` | `0` |
| `created_at` | Note-level `created_at` | `0` |
| `created_by` | Note-level `created_by` | `''` |

### Phase 2 — `storage_put_note_logged(string $id, string $content, string $author, int $client_id, string $client_version): ?array`

CREATE or UPDATE + changelog entry in one call.  Returns `[$version, $dirty]`
on success, or `null` if the client version is empty.  The `$dirty` boolean
is always `false` in the current flat-file backend; the git backend will set
it to `true` when content is staged to disk but not yet committed.
Handles tombstone revival, conflict detection (via `error_log`), version
resolution, and changelog append internally.

### Phase 3 — `storage_delete_note_logged(string $id, string $author): bool`

DELETE + changelog entry.  Returns `true` on success, `false` if already
deleted or nonexistent.

### Phase 3 — `storage_rename_note_logged(string $old_id, string $new_id, string $author): bool`

RENAME + changelog entry.  Returns `true` on success, `false` if source
missing, target occupied, or rename fails.

### Phase 4 — `storage_get_version_list(string $id): array`

Version metadata (`key`, `author`, `saved_at`, `prev`) for all versions,
newest first.  Used by `history.php` `action=list`.

### Phase 4 — `storage_get_version_content(string $id, string $vkey): ?string`

Opaque content for a specific version key, or `null` if not found.
Used by `history.php` `action=get`.

### Phase 5 — `storage_get_tombstone(string $id): ?array`

Normalized flat read for tombstone data.  Returns `null` if the
`.deleted.json` file does not exist or is malformed.
Used by `trash.php` `action=preview`.

### `storage_housekeeping(string $entry): int` — Periodic maintenance hook

Called by the daily purge block in `sync.php` (and potentially cron).
The `$entry` parameter identifies the caller (`"sync"` for the daily
hook) so backends can vary behaviour by context.  In the flat-file
backend, the `"sync"` entry point expires deleted notes past the TTL.
The git backend will use this to flush stale `.meta` staging files.

Replaces direct calls to `storage_purge_deleted_notes()` from sync.php
— the purge is now invoked through this hook instead, keeping all
periodic maintenance behind a single storage contract entry point.

## Files modified

### `src/php/storage.php` — 877 lines

- Phase 1: `storage_get_note_full($id, $client_id)` — after `storage_get_note()`
- Phase 2: `storage_put_note_logged()` — after `storage_apply_write()`;
  returns `[$vkey, $dirty]` tuple
- Phase 3: `storage_delete_note_logged()` → `bool`,
  `storage_rename_note_logged()` → `bool` — after `storage_put_note_logged()`
- Phase 4: `storage_get_version_list()`, `storage_get_version_content()` —
  new "Version history" section before the Changelog section
- Phase 5: `storage_get_tombstone()` — after `storage_list_deleted_notes()`
- `storage_housekeeping($entry)` — periodic maintenance hook; the
  `"sync"` entry point expires deleted notes.  Replaces direct
  `storage_purge_deleted_notes()` calls from sync.php.
- Renamed: `note_is_deleted()` → `storage_note_deleted()`,
  `next_rev()` → `changelog_next_rev()`

### `src/php/sync.php` — 359 lines

- **Daily housekeeping block** — Now calls `storage_housekeeping('sync')`
  and `audit_purge('sync')` instead of `storage_purge_deleted_notes()`
  and `audit_purge()`.  The `'sync'` entry point lets backends vary
  behaviour by call context.
- **`apply_client_change()`** — Reduced from ~110 to ~42 lines, returns void.
  CREATE/UPDATE calls `storage_put_note_logged()` and destructures the
  `[$version, $dirty]` tuple for audit logging.  DELETE and RENAME use the
  `bool` return from their respective logged functions.  Removed redundant
  version validation (now inside `storage_put_note_logged()`).
- **`changelog_entry_to_dexie_change($entry, $client_id)`** — CREATE/UPDATE
  branch replaced inline version-map navigation with
  `storage_get_note_full($key, $client_id)`.  Parameter renamed from
  `$viewer` to `$client_id` for exclusive-flag management.
- **Bootstrap path** — Replaced inline note-reading block with
  `storage_get_note_full($meta['id'], $client_id)`.
- **Incremental path** — `changelog_entry_to_dexie_change($entry, $client_id)`
  passes the sync client ID.

### `src/php/history.php` — 82 lines

- `action=list` — Uses `storage_get_version_list()` instead of iterating
  `$note['versions']` inline.
- `action=get` — Uses `storage_get_version_content()` instead of accessing
  `$note_versions[$vkey]['content']` directly.

### `src/php/trash.php` — 139 lines

- `action=restore` — Uses `storage_note_deleted()` for the guard check
  and `storage_get_note_full($id, $client_id)` for the response build.
  Still calls `changelog_append()` directly — the only consumer-side
  changelog call remaining; it constructs a semantically unique CREATE entry
  for the revive operation (no internal format knowledge involved).
- `action=preview` — Replaced raw filesystem access (`deleted_path()`,
  `file_exists()`, `file_get_contents()`, `json_decode()`) with a single
  `storage_get_tombstone($id)` call.

## Architecture

```
                              ┌──────────────────────────┐
                              │      storage.php         │
                              │                          │
                              │  storage_get_note_full   │◄── sync.php (read)
                              │    ($id, $client_id)     │◄── trash.php (restore)
                              │                          │
                              │  storage_put_note_logged │◄── sync.php (write)
                              │    -> [$version, $dirty] │
                              │                          │
                              │  storage_delete_note_    │◄── sync.php (delete)
                              │    logged() -> bool      │
                              │                          │
                              │  storage_rename_note_    │◄── sync.php (rename)
                              │    logged() -> bool      │
                              │                          │
                              │  storage_get_version_list│◄── history.php (list)
                              │  storage_get_version_    │◄── history.php (get)
                              │    content()             │
                              │                          │
                              │  storage_get_tombstone   │◄── trash.php (preview)
                              │                          │
                              │  storage_housekeeping    │◄── sync.php (daily hook)
                              │    ($entry)              │◄── cron (future)
                              │                          │
                              │  changelog_*()           │  <- internal
                              │  storage_note_deleted()  │
                              │  versions map            │
                              └──────────────────────────┘
```

Consumer endpoints see only the eight contract functions.  The internal
`versions` map is never accessed outside `storage.php`.  `changelog_append()`
has one remaining consumer call site (trash restore), which passes no
format-specific knowledge.

## Forward-looking design

The `$client_id` parameter on `storage_get_note_full()` and
`storage_put_note_logged()`, and the `[$version, $dirty]` tuple from
`storage_put_note_logged()` are designed for cross-cutting concerns
(exclusive-flag management, git staging — see `TODO/git-storage.md`):

- **`$client_id`** enables the storage layer to mark versions as seen by
  a different client (clearing the exclusive flag) and, for the git backend,
  flush staged `.meta` files without the consumer knowing staging exists.
- **`$dirty`** will be `true` when content was written to `.md` but deferred
  from git commit (staging).  The audit log records it as a separate boolean
  field so consumer code never needs to interpret a synthetic version string.
- **`bool` returns** from delete/rename simplify callers (they only used the
  previous `?array` return as a truthiness check anyway) and will work
  unchanged when those operations gain staging-aware flush logic.

The `$entry` parameter on `storage_housekeeping()` lets backends vary
behaviour by call context (`"sync"` for the daily hook, future values
for cron or CLI).  The flat-file backend expires deleted notes on
`"sync"`; the git backend will flush stale `.meta` staging files.

The git plan eliminates `storage_resolve_version()` and
`storage_mark_version_seen()` (immutable commits make overwrite logic
unnecessary).  Both are internal to `storage.php` — zero consumer impact.
