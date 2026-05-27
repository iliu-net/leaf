# Sync API & Metadata Enrichment

## Overview

This change enriches the sync protocol and related API endpoints with
additional metadata fields, adds stale-revision detection, optimises the
new-client bootstrap path, and documents the complete API protocol.

All changes are **server-side only** — the client TypeScript was explicitly
left untouched for a future pass.

---

## Motivation

1. **Missing metadata on sync responses.**  CREATE/UPDATE changes had no
   `created_at` or `updated_at` timestamps.  DELETE changes returned
   `"obj": null` with no information about who deleted the note or when.
   RENAME changes lacked `renamed_by` and `renamed_at`.

2. **Missing metadata in trash.**  The trash `list` and `preview` actions
   returned no `deleted_by` information.

3. **Inefficient bootstrap.**  New clients (`syncedRevision=0`) triggered
   a full changelog scan.  For a long-running server with thousands of
   entries, this is wasteful — the filesystem already has the current
   state.

4. **No stale-revision detection.**  If the changelog were ever truncated
   (future feature), a client whose `syncedRevision` predates the
   truncation point would silently receive incomplete data.

---

## Files Changed

| File | Change |
|------|--------|
| `src/php/sync.php` | Enriched response shapes, three-branch handler, delete tombstone metadata, rename metadata |
| `src/php/storage.php` | `deleted_by` in tombstone files and `storage_list_deleted_notes()`, `changelog_earliest_rev()` |
| `src/php/trash.php` | `deleted_at` and `deleted_by` in `action=preview` response |
| `tests/integration/test_sync.sh` | Rewrote rename tests to use incremental sync path; added tombstone rename + create-over-tombstone tests |

---

## Detailed Changes

### 1. sync.php — Enriched CREATE/UPDATE Response

`changelog_entry_to_dexie_change()` now includes:

| Field | Source | Description |
|-------|--------|-------------|
| `created_at` | `$note['created_at']` | Unix timestamp of note creation (set once, never overwritten) |
| `updated_at` | `$note['versions'][current]['saved_at']` | Unix timestamp of last write to the current version |

These fields were already present in the on-disk format — they were simply
not being surfaced to the client.

### 2. sync.php — Enriched DELETE Response

Previously DELETE returned `"obj": null`.  Now it returns:

```json
{
  "type": 3,
  "key": "old-note",
  "obj": {
    "deleted_by": "alice",
    "deleted_at": 1748350000
  }
}
```

Source: `deleted_by` from the changelog entry, `deleted_at` from
`$entry['ts']`.

### 3. sync.php — Enriched RENAME Response

Previously RENAME returned only `renamed_to` and version pointers.
Now it also returns:

```json
{
  "type": 4,
  "key": "old-name",
  "obj": {
    "renamed_to": "new-name",
    "renamed_by": "alice",
    "renamed_at": 1748350000,
    "version": null,
    "prev_version": null
  }
}
```

### 4. sync.php — `deleted_by` in Changelog (DELETE)

`apply_client_change()` now passes `$author` to `storage_delete_note()`
and records `deleted_by` in the changelog entry for DELETE operations.

### 5. sync.php — `renamed_by` in Changelog (RENAME)

`apply_client_change()` now records `renamed_by` in the changelog entry
for RENAME operations.

### 6. sync.php — Three-Branch Handler (Step 2)

Replaced the single `changelog_since()` path with three branches:

| Branch | Condition | Behaviour |
|--------|-----------|-----------|
| Bootstrap | `syncedRevision === 0` | Build response from filesystem: live notes → CREATE, tombstones → DELETE. No changelog scan. |
| Incremental | `syncedRevision >= earliest_rev` | Walk `changelog_since(syncedRevision)`, deduplicate by key (most recent state wins). |
| Stale | `0 < syncedRevision < earliest_rev` | Return HTTP 409 `{"error": "STALE_REVISION"}` — client must re-bootstrap. |

**Bootstrap response includes:**
- `created_at`, `updated_at`, `author`, `created_by`, `prev_version` for each CREATE
- `deleted_by`, `deleted_at` for each DELETE (from tombstone metadata)

**Important:** Bootstrap does NOT return RENAME entries — it represents the
current filesystem state where notes already exist under their final names.

**NOTE_READ audit logging** follows the normal path for all branches
(including bootstrap).  Every note whose content is delivered to a client
is logged.

### 7. storage.php — `storage_delete_note()` Signature Change

```php
// Before
function storage_delete_note(string $id): void

// After
function storage_delete_note(string $id, string $deleted_by = ''): void
```

Now writes `deleted_by` into the tombstone JSON alongside `deleted_at`.
Both fields are stripped during revive (`storage_revive_note`).

### 8. storage.php — `storage_list_deleted_notes()` Returns `deleted_by`

The returned array entries now include a `deleted_by` field (string,
empty for legacy tombstones without the field).

### 9. storage.php — New Function `changelog_earliest_rev()`

```php
function changelog_earliest_rev(): int
```

Reads the **first non-empty line** of `changelog.jsonl` and returns its
`rev` field.  O(1) I/O — only one line read.  Returns `1` if the
changelog is empty or missing.

Used by the Stale branch to detect when a client's `syncedRevision` falls
before the surviving portion of the log.  Currently the changelog is never
truncated, so this is future-proofing.

### 10. trash.php — `deleted_by` in Preview Response

`action=preview` now returns `deleted_at` and `deleted_by` in the `note`
object, read from the tombstone JSON.

### 11. test_sync.sh — Rename Tests Rewritten

Tests 9–13 were rewritten to use **incremental sync** (tracked revisions)
instead of `syncedRevision=0` for every request.  This is necessary
because the new bootstrap path (syncedRevision=0) builds from filesystem
and does not return RENAME entries.

**Pattern:** Bootstrap once at the start of each test sequence
(`REV_BOOT = pull with syncedRevision=0`), then use the returned
`currentRevision` as `syncedRevision` for subsequent pushes and pulls.

**New tests added:**
- **Test 13:** Rename to a tombstoned name should succeed (hard-deletes
  the tombstone first, then renames)
- **Test 14:** Create over a tombstone should succeed (revives the note
  with new content)

---

## On-Disk Format Changes

### Tombstone Files (`{id}.deleted.json`)

New top-level field:

```json
{
  "current": "2026-05-27:1:alice",
  "created_at": 1748000000,
  "created_by": "alice",
  "deleted_at": 1748350000,
  "deleted_by": "alice",
  "versions": { ... }
}
```

Legacy tombstones without `deleted_by` are handled gracefully — the
field defaults to `""` in API responses.

### Changelog (`changelog.jsonl`)

DELETE entries gain `deleted_by`:

```jsonl
{"rev":3,"file":"old","type":"DELETE","ts":1748002000,"version":null,"prev_version":"...","deleted_by":"alice"}
```

RENAME entries gain `renamed_by`:

```jsonl
{"rev":4,"file":"old","type":"RENAME","ts":1748003000,"renamed_to":"new","renamed_by":"alice","version":null,"prev_version":null}
```

---

## Client Impact

**None in this change.**  All client TypeScript files were cleanly
reverted (`git checkout --`).  The client continues to work with the new
response shapes because:

- Extra fields in JSON objects are ignored by JavaScript — adding
  `created_at`, `updated_at`, `deleted_by`, etc. to responses does not
  break existing field access.
- The `"obj"` field on DELETE changes changed from `null` to an object.
  The client already handles `null` vs object checks on the `obj` field
  (DELETE does not try to access `.content`).

Future work: consume these new fields in the client for richer UI
metadata display, conflict resolution, and trash management.

---

## API Documentation

A standalone API protocol reference was created at
`requirements/api-protocol.md`.  It documents all 5 endpoints, the sync
protocol (three branches, change types, version keys, conflict strategy,
exclusive flag), storage schema, and audit log.  This supersedes any
inline doc comments as the canonical reference.

---

## Testing

All integration tests pass:

```
$ make test
  ... (all dots, no failures)
```

The `test_sync.sh` suite covers:
- Empty initial sync
- Create, update, delete note lifecycle
- Pull verification after each operation
- Special characters in note names (slash → colon mapping)
- Rename and verify under new name
- Rename to existing name (should fail)
- Rename to tombstoned name (should succeed)
- Create over tombstone (should revive)

---

## Backward Compatibility

- **Tombstones without `deleted_by`:** Legacy tombstones (created before
  this change) lack the `deleted_by` field.  `storage_list_deleted_notes()`
  returns `""` for these.  The sync bootstrap path uses `?? ''` so it
  never sends `null`.
- **Changelog entries without `renamed_by` / `deleted_by`:** These fields
  are accessed with `?? ''` / `?? null` throughout — missing fields
  default gracefully.
- **Client backward compatibility:** Extra JSON fields are harmless.
  The DELETE `obj` change (from `null` to `{deleted_by, deleted_at}`) is
  safe because the client checks `change.obj?.content` which returns
  `undefined` for DELETE objects — same behaviour as before.
