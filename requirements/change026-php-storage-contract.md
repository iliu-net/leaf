# Change 026 — PHP Storage Contract

## Summary

Added seven functions to `storage.php` that isolate `sync.php`, `history.php`,
and `trash.php` from the internal storage format (the `versions` map, tombstone
file layout, changelog mechanics).  After this change, no endpoint reads
`$note['versions']`, calls `deleted_path()`, `next_rev()`, or
`changelog_append()` directly.  Swapping the flat-file backend for git or MySQL
means rewriting only `storage.php`.

Implements item 1 from `TODO/refactor-php.md` as detailed in
`TODO/refactor-php-plan.md`.

## Motivation

Before this change:
- `sync.php`, `history.php`, and `trash.php` all navigated
  `$note['versions'][$current]` inline — duplicated across ~10 locations.
- Bootstrap and incremental sync paths used different code to read the same
  note data.
- `trash.php`'s preview action reached directly into the filesystem
  (`deleted_path()`, `file_exists()`, `file_get_contents()`, `json_decode()`).
- `apply_client_change()` was ~110 lines with embedded changelog construction.

After this change, the storage layer owns all knowledge of the internal format
and changelog protocol.  Consumer endpoints only work with normalized flat
arrays.

## New functions (all in `storage.php`)

### Phase 1 — `storage_get_note_full(string $id): ?array`

Normalized flat read for sync-protocol consumers.  Returns a flat array hiding
the internal `versions` map:

| Key | Source | Fallback |
|-----|--------|----------|
| `content` | Current version's `content` | `''` |
| `version` | Note's `current` pointer | `''` |
| `prev` | Current version's `prev` | `null` |
| `author` | Current version's `author` | `''` |
| `updated_at` | Current version's `saved_at` | `0` |
| `created_at` | Note-level `created_at` | `0` |
| `created_by` | Note-level `created_by` | `''` |

### Phase 2 — `storage_put_note_logged(string $id, string $content, string $author, ?string $client_version): ?array`

CREATE or UPDATE + changelog entry in one call.  Returns null if the client
version is missing.  Handles tombstone revival, conflict detection (via
`error_log`), version resolution, and changelog append internally.

### Phase 3 — `storage_delete_note_logged(string $id, string $author): ?array`

DELETE + changelog entry.  Returns null if already deleted or nonexistent.

### Phase 3 — `storage_rename_note_logged(string $old_id, string $new_id, string $author): ?array`

RENAME + changelog entry.  Returns null if source missing, target occupied, or
rename fails.

### Phase 4 — `storage_get_version_list(string $id): array`

Returns version metadata (`key`, `author`, `saved_at`, `prev`) for all versions
of a note, newest first.  Used by `history.php` `action=list`.

### Phase 4 — `storage_get_version_content(string $id, string $vkey): ?string`

Returns opaque content for a specific version key, or null if not found.  Used
by `history.php` `action=get`.

### Phase 5 — `storage_get_tombstone(string $id): ?array`

Normalized flat read for tombstone data.  Returns null if the `.deleted.json`
file does not exist or is malformed.  Used by `trash.php` `action=preview`.

## Files modified

### `src/php/storage.php` — +186 lines

- Phase 1: `storage_get_note_full()` — after `storage_get_note()`
- Phase 2: `storage_put_note_logged()` — after `storage_apply_write()`
- Phase 3: `storage_delete_note_logged()`, `storage_rename_note_logged()` —
  after `storage_put_note_logged()`
- Phase 4: `storage_get_version_list()`, `storage_get_version_content()` —
  new "Version history" section before the Changelog section
- Phase 5: `storage_get_tombstone()` — after `storage_list_deleted_notes()`

### `src/php/sync.php` — −177 lines

- **`changelog_entry_to_dexie_change()`** — CREATE/UPDATE branch replaced ~35
  lines of inline version-map navigation with a single
  `storage_get_note_full($key)` call.
- **Bootstrap path** — Replaced inline note-reading block with
  `storage_get_note_full()` build.
- **`apply_client_change()`** — Reduced from ~110 to ~40 lines.  CREATE/UPDATE,
  DELETE, and RENAME branches are now thin wrappers that call the
  `storage_*_logged()` functions and `audit_log()`.  Removed redundant
  version validation (now handled inside `storage_put_note_logged()`).

### `src/php/history.php` — −53 lines

- `action=list` — Uses `storage_get_version_list()` instead of iterating
  `$note['versions']` inline.
- `action=get` — Uses `storage_get_version_content()` instead of accessing
  `$note_versions[$vkey]['content']` directly.

### `src/php/trash.php` — −56 lines

- `action=restore` — Response build uses `storage_get_note_full()` instead of
  inline version-map access.
- `action=preview` — Replaced raw filesystem access (`deleted_path()`,
  `file_exists()`, `file_get_contents()`, `json_decode()`) with a single
  `storage_get_tombstone($id)` call.

## Architecture

```
                              ┌──────────────────┐
                              │   storage.php    │
                              │                  │
                              │  storage_get_    │
                              │    note_full()   │◄──────── sync.php (read)
                              │                  │
                              │  storage_put_    │
                              │    note_logged() │◄──────── sync.php (write)
                              │                  │
                              │  storage_delete_ │
                              │    note_logged() │◄──────── sync.php (delete)
                              │                  │
                              │  storage_rename_ │
                              │    note_logged() │◄──────── sync.php (rename)
                              │                  │
                              │  storage_get_    │
                              │    version_list()│◄──────── history.php (list)
                              │                  │
                              │  storage_get_    │
                              │  version_content │◄──────── history.php (get)
                              │                  │
                              │  storage_get_    │
                              │    tombstone()   │◄──────── trash.php (preview)
                              │                  │
                              │  changelog_*()  │  ← internal only
                              │  next_rev()      │
                              │  versions map    │
                              └──────────────────┘
```

Consumer endpoints see only the seven public contract functions.  The internal
`versions` map, `deleted_path()`, `next_rev()`, and `changelog_append()` are
never called outside `storage.php`.

## Line-count impact

| File | Before | After | Δ |
|------|--------|-------|---|
| `storage.php` | ~664 | ~850 | +186 |
| `sync.php` | ~457 | ~280 | −177 |
| `history.php` | ~103 | ~50 | −53 |
| `trash.php` | ~146 | ~90 | −56 |
| **Net** | | | **−100** |
