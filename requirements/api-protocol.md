# Leaf — API Protocol Reference

This document describes the complete HTTP API exposed by the Leaf PHP backend.
It documents the current (post-May-2026) state of all endpoints, request/response
shapes, error conventions, and the sync protocol.

---

## Table of Contents

1. [Conventions](#conventions)
   - [URL Patterns](#url-patterns)
   - [Authentication](#authentication)
   - [Timestamps](#timestamps)
   - [Error Responses](#error-responses)
   - [CORS](#cors)
2. [Endpoints](#endpoints)
   - [`/api/auth` — Authentication](#apiauth)
   - [`/api/sync` — Sync Protocol](#apisync)
   - [`/api/trash` — Trash Management](#apitrash)
   - [`/api/history` — Version History](#apihistory)
   - [`/api/spa-config` — SPA Configuration](#apispa-config)
3. [Sync Protocol Deep-Dive](#sync-protocol-deep-dive)
   - [Change Type Constants](#change-type-constants)
   - [Three-Branch Handler](#three-branch-handler)
   - [Version Key Format](#version-key-format)
   - [Conflict Strategy](#conflict-strategy)
   - [Exclusive Flag](#exclusive-flag)
   - [Partial Batches](#partial-batches)
4. [Storage Schema](#storage-schema)
   - [Note File (`{id}.json`)](#note-file-idjson)
   - [Tombstone File (`{id}.deleted.json`)](#tombstone-file-iddeletedjson)
   - [Changelog (`changelog.jsonl`)](#changelog-changelogjsonl)
5. [Audit Log](#audit-log)

---

## Conventions

### URL Patterns

All endpoints live under `/api/`.  Two URL styles are supported:

| Style     | Example                          |
|-----------|----------------------------------|
| Clean     | `/api/auth?action=login`         |
| Explicit  | `/api/index.php/auth?action=login` |

The router reads `PATH_INFO` to extract the endpoint name (`auth`, `sync`,
`trash`, `history`, `spa-config`).  Query parameters (e.g. `?action=login`) are
handled by each endpoint's own logic.

### Authentication

Authentication uses **short-lived JWT access tokens** plus **long-lived httpOnly
refresh tokens**.

- Every protected endpoint (`sync`, `trash`, `history`) expects:
  ```
  Authorization: Bearer <access_token>
  ```
- The access token is issued by `POST /api/auth?action=login` and refreshed via
  `POST /api/auth?action=refresh`.
- The refresh token is stored in an `httpOnly`, `SameSite=Strict` cookie named
  `refresh_token`.  The client never reads it directly — the browser sends it
  automatically.
- Access tokens expire after **15 minutes** (`JWT_EXPIRY`).  Refresh tokens
  expire after **30 days** (`REFRESH_EXPIRY`).  The client is expected to
  refresh the access token before it expires.
- On failed authentication, the server returns `401` with a JSON error body
  (see [Error Responses](#error-responses)).

### Timestamps

All timestamps are **Unix seconds** (integer).  The client stores milliseconds
internally but the API layer uses seconds.

### Error Responses

Every error response uses a **non-2xx HTTP status code** with a JSON body
containing an `error` string.  There is never a `200` status with an `error`
field — the client can check `res.ok` and, if false, parse `data.error`.

| Status | Meaning                                       |
|--------|-----------------------------------------------|
| 400    | Bad request (invalid JSON, missing parameter) |
| 401    | Authentication required or invalid token      |
| 404    | Resource not found / unknown action           |
| 405    | Wrong HTTP method (endpoints require POST)    |
| 409    | Stale revision — client must re-bootstrap     |
| 500    | Internal server error                         |

Error body shape:
```json
{ "error": "Human-readable message" }
```

The only exception: `OPTIONS` preflight requests return `204 No Content` with
no body (and bypass authentication).

### CORS

All endpoints set:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

Exceptions:
- `spa-config` uses `GET, OPTIONS` methods.
- `auth` does not include `Authorization` in `Allow-Headers` (it is the
  endpoint that issues tokens, so clients never send an Authorization
  header to it).

The `CORS_ALLOW_POLICY` constant (default `'*'`) can be tightened in
`config.php` for production.

---

## Endpoints

### `/api/auth`

**Purpose:** Issue, refresh, and revoke authentication tokens.

**Method:** `POST`

All actions require no pre-existing authentication.

#### `POST ?action=login`

Create a session for a user.

**Request:**
```json
{
  "username": "alice",
  "password": "s3cret"
}
```

**Response `200` (success):**
```json
{
  "ok":       true,
  "token":    "eyJhbGciOiJIUzI1NiIs...",
  "username": "alice",
  "expires":  1716163200
}
```

Also sets the `refresh_token` httpOnly cookie.

**Response `401` (failure):**
```json
{ "error": "Invalid username or password" }
```

Login failures include a deliberate random delay (7–12 seconds) to prevent
user-enumeration timing attacks.

#### `POST ?action=refresh`

Issue a new access token using the refresh token cookie.

**Request:** No body required.  The `refresh_token` cookie is sent automatically
by the browser.

**Response `200` (success):**
```json
{
  "ok":       true,
  "token":    "eyJhbGciOiJIUzI1NiIs...",
  "username": "alice",
  "expires":  1716163200
}
```

Also rotates the refresh token: the old cookie is invalidated, a new one is set.

**Response `401` (failure):**
```json
{ "error": "No refresh token" }
```
or
```json
{ "error": "Refresh token expired or invalid" }
```

On failure, the refresh token cookie is cleared.

#### `POST ?action=logout`

Revoke the current session.

**Request:** No body required.

**Response `200` (success):**
```json
{ "ok": true }
```

Invalidates the refresh token server-side and clears the cookie.

---

### `/api/sync`

**Purpose:** Push local changes to the server and pull remote changes — both in
a single POST.  This is the core of the offline-first sync protocol.

**Method:** `POST`

**Authentication:** Required (Bearer token).

#### Request Shape

```json
{
  "baseRevision":   12,
  "syncedRevision": 15,
  "changes": [
    {
      "type": 1,
      "key":  "note-id",
      "obj": {
        "content":    "# Hello\n\nWorld",
        "version":    "2026-05-27:1:alice",
        "author":     "alice",
        "created_by": "bob",
        "created_at": 1748000000,
        "updated_at": 1748340000
      }
    }
  ],
  "partial": false
}
```

| Field            | Type      | Description                                                        |
|------------------|-----------|--------------------------------------------------------------------|
| `baseRevision`   | `number`  | Server revision the client's changes are based on                  |
| `syncedRevision` | `number`  | Last server revision the client has seen (used for pull)           |
| `changes`        | `array`   | Local changes to push (may be empty)                               |
| `partial`        | `boolean` | If `true`, client is sending changes in batches                    |

**`changes` entry fields** (varies by change type, see [Change Types](#change-type-constants)):

| Type | Meaning  | `obj` shape                                                  |
|------|----------|--------------------------------------------------------------|
| 1    | CREATE   | `{ content, version }` + optional `author`, `created_by`, `created_at`, `updated_at` |
| 2    | UPDATE   | Same as CREATE                                               |
| 3    | DELETE   | `null` (or `{ deleted_by }`)                                 |
| 4    | RENAME   | `{ renamed_to, version }`                                    |

The `obj` field for CREATE/UPDATE may include additional metadata fields
(`author`, `created_by`, `created_at`, `updated_at`), but the server only
requires `content` and `version`.  Client metadata is informational — the
server records its own timestamps and author.

#### Response Shape

```json
{
  "changes": [
    { "type": 1, "key": "note-id", "obj": { "id": "note-id", ... } }
  ],
  "currentRevision": 18,
  "partial": false
}
```

| Field             | Type      | Description                                                        |
|-------------------|-----------|--------------------------------------------------------------------|
| `changes`         | `array`   | Server changes since `syncedRevision` (or full dump if `syncedRevision=0`) |
| `currentRevision` | `number`  | Server's current revision after applying incoming changes          |
| `partial`         | `boolean` | Always `false` — the server sends all changes at once              |

**Change entry shapes in the response:**

##### CREATE / UPDATE (type 1 or 2)

```json
{
  "type": 1,
  "key":  "welcome",
  "obj": {
    "content":     "# Welcome\n\nThis is the first note.",
    "version":     "2026-05-27:1:alice",
    "prev_version": null,
    "author":      "alice",
    "created_by":  "alice",
    "created_at":  1748000000,
    "updated_at":  1748340000
  }
}
```

| Field          | Type      | Description                                                    |
|----------------|-----------|----------------------------------------------------------------|
| `content`      | `string`  | Opaque note content (server never inspects it)                 |
| `version`      | `string`  | Version key of this revision (format: `date:counter:author`)   |
| `prev_version` | `string`  | Previous version key in the chain, or `null`                   |
| `author`       | `string`  | Author of *this version* (the one who wrote it)                |
| `created_by`   | `string`  | Original creator of the note (set once, never overwritten)     |
| `created_at`   | `number`  | Unix timestamp of note creation (seconds)                      |
| `updated_at`   | `number`  | Unix timestamp of last write to this version (seconds)         |

##### DELETE (type 3)

```json
{
  "type": 3,
  "key":  "old-note",
  "obj": {
    "deleted_by": "alice",
    "deleted_at": 1748350000
  }
}
```

| Field        | Type      | Description                                          |
|--------------|-----------|------------------------------------------------------|
| `deleted_by` | `string`  | Username who performed the deletion                   |
| `deleted_at` | `number`  | Unix timestamp when the note was deleted (seconds)    |

##### RENAME (type 4)

```json
{
  "type": 4,
  "key":  "old-name",
  "obj": {
    "renamed_to":   "new-name",
    "renamed_by":   "alice",
    "renamed_at":   1748350000,
    "version":      null,
    "prev_version": null
  }
}
```

| Field          | Type      | Description                                          |
|----------------|-----------|------------------------------------------------------|
| `renamed_to`   | `string`  | New note identifier after the rename                 |
| `renamed_by`   | `string`  | Username who performed the rename                    |
| `renamed_at`   | `number`  | Unix timestamp when the rename occurred (seconds)    |
| `version`      | `null`    | Always null for renames (version metadata is on the note) |
| `prev_version` | `null`    | Always null for renames                              |

#### Error Codes Specific to Sync

| Status | Error               | Meaning                                                                  |
|--------|---------------------|--------------------------------------------------------------------------|
| 409    | `STALE_REVISION`    | Client's `syncedRevision` predates the oldest surviving changelog entry. The client should re-bootstrap from `syncedRevision=0`. |
| 401    | `Invalid or expired token` | Access token has expired or is malformed. Refresh first.          |

---

### `/api/trash`

**Purpose:** Manage soft-deleted notes (list, preview, restore, permanently
delete).

**Method:** `POST`

**Authentication:** Required (Bearer token).

All actions are determined by the `action` field in the request body.

#### `action=list`

List all notes currently in the trash.

**Request:**
```json
{
  "action": "list"
}
```

**Response `200`:**
```json
{
  "ok": true,
  "data": [
    {
      "id":         "old-note",
      "deleted_at": 1748350000,
      "deleted_by": "alice"
    },
    {
      "id":         "another-old",
      "deleted_at": 1748345000,
      "deleted_by": "bob"
    }
  ]
}
```

| Field        | Type              | Description                                         |
|--------------|-------------------|-----------------------------------------------------|
| `id`         | `string`          | Note identifier                                     |
| `deleted_at` | `number` or `null`| Unix timestamp when deleted. `null` for legacy tombstones without this field. |
| `deleted_by` | `string`          | Username who performed the deletion. Empty string for legacy tombstones. |

#### `action=preview`

Read the content of a deleted note without restoring it.

**Request:**
```json
{
  "action": "preview",
  "id": "old-note"
}
```

**Response `200`:**
```json
{
  "ok": true,
  "note": {
    "id":         "old-note",
    "content":    "# Old content\n\n...",
    "created_at": 1748000000,
    "created_by": "alice",
    "deleted_at": 1748350000,
    "deleted_by": "alice"
  }
}
```

| Field        | Type      | Description                                                          |
|--------------|-----------|----------------------------------------------------------------------|
| `id`         | `string`  | Note identifier                                                      |
| `content`    | `string`  | The note's current content (from the tombstone's current version)    |
| `created_at` | `number`  | Unix timestamp of original note creation (seconds)                   |
| `created_by` | `string`  | Original creator username                                            |
| `deleted_at` | `number`  | Unix timestamp when the note was deleted (seconds)                   |
| `deleted_by` | `string`  | Username who performed the deletion                                  |

**Errors:** `400` if `id` missing, `404` if tombstone not found.

#### `action=restore`

Restore a note from the trash back to the live notes.

**Request:**
```json
{
  "action": "restore",
  "id": "old-note"
}
```

**Response `200`:**
```json
{
  "ok": true,
  "note": {
    "id":         "old-note",
    "content":    "# Old content\n\n...",
    "created_at": 1748000000,
    "created_by": "alice",
    "current":    "2026-05-25:1:alice"
  }
}
```

| Field        | Type      | Description                                         |
|--------------|-----------|-----------------------------------------------------|
| `id`         | `string`  | Note identifier                                     |
| `content`    | `string`  | The note's current content                          |
| `created_at` | `number`  | Unix timestamp of original creation (seconds)       |
| `created_by` | `string`  | Original creator username                           |
| `current`    | `string`  | Current version key                                 |

Restoring also writes a changelog entry (type CREATE) so other clients
re-sync the revived note.

**Errors:** `400` if `id` missing, `404` if note is not deleted, `500` if
restore fails.

#### `action=purge`

Permanently delete (hard-delete) a single tombstone.

**Request:**
```json
{
  "action": "purge",
  "id": "old-note"
}
```

**Response `200`:**
```json
{ "ok": true }
```

**Errors:** `400` if `id` missing, `404` if tombstone not found.

#### `action=empty`

Permanently delete ALL tombstones at once.

**Request:**
```json
{
  "action": "empty"
}
```

**Response `200`:**
```json
{ "ok": true }
```

---

### `/api/history`

**Purpose:** Retrieve version history for a note and fetch opaque content for
specific versions (e.g. for diffing).

**Method:** `POST`

**Authentication:** Required (Bearer token).

#### `action=list`

List all versions of a note (metadata only, no content).

**Request:**
```json
{
  "action": "list",
  "id": "my-note"
}
```

**Response `200`:**
```json
{
  "ok":       true,
  "current":  "2026-05-27:3:alice",
  "versions": [
    {
      "key":      "2026-05-27:3:alice",
      "author":   "alice",
      "saved_at": 1748350000,
      "prev":     "2026-05-27:2:alice"
    },
    {
      "key":      "2026-05-27:2:alice",
      "author":   "alice",
      "saved_at": 1748345000,
      "prev":     "2026-05-27:1:alice"
    },
    {
      "key":      "2026-05-27:1:alice",
      "author":   "alice",
      "saved_at": 1748340000,
      "prev":     null
    }
  ]
}
```

| Field      | Type             | Description                                                     |
|------------|------------------|-----------------------------------------------------------------|
| `current`  | `string` or `null` | Current version key, or `null` if note not found              |
| `versions` | `array`          | Version entries sorted by `saved_at` descending (most recent first) |

Each version entry:

| Field      | Type             | Description                                                     |
|------------|------------------|-----------------------------------------------------------------|
| `key`      | `string`         | Version key (format: `date:counter:author`)                     |
| `author`   | `string`         | Author of this version                                          |
| `saved_at` | `number`         | Unix timestamp when this version was saved (seconds)             |
| `prev`     | `string` or `null` | Previous version key in the chain, or `null` for root versions |

#### `action=get`

Fetch the opaque content of one or more specific versions.

**Request:**
```json
{
  "action": "get",
  "id": "my-note",
  "versions": ["2026-05-27:2:alice", "2026-05-27:1:alice"]
}
```

**Response `200`:**
```json
{
  "ok":       true,
  "contents": {
    "2026-05-27:2:alice": "# Version 2 content\n\n...",
    "2026-05-27:1:alice": "# Version 1 content\n\n..."
  }
}
```

| Field      | Type             | Description                                          |
|------------|------------------|------------------------------------------------------|
| `contents` | `object`         | Map from version key to content string, or `null` if version not found |

**Errors:** `400` if `versions` is not an array, `404` if the note is not found.

---

### `/api/spa-config`

**Purpose:** Expose server-side configuration to the SPA client at boot time.

**Method:** `GET`

**Authentication:** None (public endpoint).

**Response `200`:**
```json
{
  "markdown": {
    "html": false
  }
}
```

The response is exactly the `$spa_config` PHP array defined in `api/config.php`.
If `$spa_config` is not defined or is empty, the response is `{}`.

The client fetches this at boot and caches it in `localStorage`.

**Note:** This endpoint has no `?action` parameter — it does not return the
`{ "ok": true }` wrapper used by other endpoints.  It returns the config object
directly.

---

## Sync Protocol Deep-Dive

### Change Type Constants

| Constant       | Value | Meaning                                              |
|----------------|-------|------------------------------------------------------|
| `DEXIE_CREATE` | 1     | Create a new note                                     |
| `DEXIE_UPDATE` | 2     | Update an existing note's content                     |
| `DEXIE_DELETE` | 3     | Soft-delete a note (moves to trash)                   |
| `DEXIE_RENAME` | 4     | Rename a note (change its identifier)                 |

These constants are shared between server (PHP) and client (TypeScript).

### Three-Branch Handler

The sync endpoint uses a three-branch strategy to serve changes efficiently:

#### Branch 1: Bootstrap (`syncedRevision === 0`)

When the client has never synced (or has been instructed to re-bootstrap), the
server builds the response directly from the **filesystem** — no changelog scan
required.

- **Live notes** → `CREATE` changes (one per note, with current content)
- **Tombstone files** → `DELETE` changes (one per deleted note)

This is O(`live_notes + tombstones`) and avoids scanning the entire changelog
for new clients.

**Important:** RENAME entries are NOT included in the bootstrap response.
A client bootstrapping sees the current state — notes under their current names
and deletions as-is.

#### Branch 2: Incremental (`syncedRevision >= earliest_rev`)

For clients that have synced before and whose revision is still within the
surviving changelog:

1. Read changelog entries with `rev > syncedRevision`
2. **Deduplicate by key** — if a note was created, updated, and deleted since
   the last sync, only the DELETE entry is returned (most recent state per key)
3. Deduplication is done in reverse chronological order, then re-reversed
   to restore forward order for the client

The client receives only the final state of each changed note.

#### Branch 3: Stale (`0 < syncedRevision < earliest_rev`)

If the client's `syncedRevision` predates the oldest surviving changelog entry
(i.e. the relevant portion of the changelog has been truncated), the server
returns **HTTP 409**:

```json
{ "error": "STALE_REVISION" }
```

The client should then re-bootstrap by sending `syncedRevision=0`.

**Note:** Currently the changelog is never truncated (it grows without bound).
The 409 branch exists as future-proofing for when log truncation is added.
`changelog_earliest_rev()` reads only the first line of the changelog (O(1) I/O).

### Version Key Format

Version keys follow the pattern:

```
{YYYY-MM-DD}:{counter}:{author}
```

Examples:
```
2026-05-27:1:alice
2026-05-27:2:alice
2026-05-27:1:bob
```

- Lexicographic sort equals chronological order
- Counter resets per (date, author) pair
- The author in the key is a convenience duplicate of the `author` field in the
  version entry; the `author` field is authoritative

### Conflict Strategy

**Last-write-wins at the version level.**

When a client pushes a change with a `baseRevision` that is behind the server's
current revision, both versions survive in the version chain:

1. The client's incoming version is written with a `prev` pointer to the
   competing server version
2. Both versions are preserved in the note's version history
3. The client receives the competing version in the sync response and can
   reconcile locally (future 3-way merge UI)
4. The conflict is logged via `error_log()`

This ensures no data is ever silently lost.

### Exclusive Flag

Each version carries an `exclusive` boolean flag.  It controls whether the next
save by the same author **overwrites** the current version (same key → same
slot), or creates a **new version** (incremented counter).

- `exclusive: true` — This version has only been seen by its author.  Next
  save by the same author on the same day overwrites it.
- `exclusive: false` — Another user has received this version via sync.  Next
  save by the original author creates a new version instead of overwriting.

The flag is set to `false` during sync response building (`Step 3` in sync.php):
for every note whose content is delivered to a client with a different username
than the version author.

This prevents the scenario where Alice saves, Bob syncs and reads Alice's
content, then Alice saves again — without the exclusive flag, Bob's client would
think Alice's version no longer exists.  With it, Alice's new save creates a new
version key and Bob receives both.

### Partial Batches

The client may send `"partial": true` when it has many pending changes (above a
threshold).  The server accepts and applies each batch normally.  The server
always responds with `"partial": false` — the partial flag only controls client
behavior.  The client sends `"partial": false` on its final batch to indicate
the server should respond.

**(Client-side optimization — the server handles all batches identically.)**

---

## Storage Schema

The server uses flat-file storage under `data/`.  All file I/O is isolated in
`src/php/storage.php` so switching to MySQL later means rewriting only that file.

### Note File (`{id}.json`)

Located at `data/notes/{id}.json`.

```json
{
  "current":    "2026-05-27:1:alice",
  "created_at": 1748000000,
  "created_by": "alice",
  "versions": {
    "2026-05-27:1:alice": {
      "author":    "alice",
      "saved_at":  1748000000,
      "content":   "# Hello\n\nWorld",
      "prev":      null,
      "exclusive": false
    }
  }
}
```

| Field                | Type     | Description                                                    |
|----------------------|----------|----------------------------------------------------------------|
| `current`            | `string` | Key of the current version                                     |
| `created_at`         | `number` | Unix timestamp of note creation (set once, never changed)      |
| `created_by`         | `string` | Original creator (set once, never changed)                     |
| `versions`           | `object` | Map from version key to version entry                          |
| `versions.*.author`   | `string` | Who wrote this version                                         |
| `versions.*.saved_at` | `number` | Unix timestamp when saved                                      |
| `versions.*.content`  | `string` | Opaque note content                                            |
| `versions.*.prev`     | `string` \| `null` | Previous version key, or `null` for root versions     |
| `versions.*.exclusive`| `boolean` | True until another user fetches this version via sync         |

### Tombstone File (`{id}.deleted.json`)

Located at `data/notes/{id}.deleted.json`.

A soft-deleted note's complete version history is preserved in the tombstone:

```json
{
  "current":    "2026-05-27:1:alice",
  "created_at": 1748000000,
  "created_by": "alice",
  "deleted_at": 1748350000,
  "deleted_by": "alice",
  "versions": {
    "2026-05-27:1:alice": {
      "author":   "alice",
      "saved_at": 1748000000,
      "content":  "# Hello\n\nWorld",
      "prev":     null
    }
  }
}
```

Two metadata fields are added at the top level:

| Field        | Type     | Description                                              |
|--------------|----------|----------------------------------------------------------|
| `deleted_at` | `number` | Unix timestamp when the note was soft-deleted (seconds)  |
| `deleted_by` | `string` | Username who performed the deletion                      |

When a note is restored (`storage_revive_note`), these fields are stripped
and the file is moved back to `{id}.json`.

### Changelog (`changelog.jsonl`)

Located at `data/changelog.jsonl`.  Append-only, one JSON object per line.

```jsonl
{"rev":1,"file":"welcome","type":"CREATE","ts":1748000000,"version":"2026-05-27:1:alice","prev_version":null}
{"rev":2,"file":"welcome","type":"UPDATE","ts":1748001000,"version":"2026-05-27:2:alice","prev_version":"2026-05-27:1:alice"}
{"rev":3,"file":"welcome","type":"DELETE","ts":1748002000,"version":null,"prev_version":"2026-05-27:2:alice","deleted_by":"alice"}
{"rev":4,"file":"old-name","type":"RENAME","ts":1748003000,"renamed_to":"new-name","renamed_by":"alice","version":null,"prev_version":null}
```

| Field          | Type              | Description                                              |
|----------------|-------------------|----------------------------------------------------------|
| `rev`          | `number`          | Monotonically increasing revision number                 |
| `file`         | `string`          | Note identifier (the `key`)                              |
| `type`         | `"CREATE"` \| `"UPDATE"` \| `"DELETE"` \| `"RENAME"` | Change type |
| `ts`           | `number`          | Unix timestamp of the change (seconds)                   |
| `version`      | `string` \| `null` | Version key written (null for DELETE and RENAME)       |
| `prev_version` | `string` \| `null` | Previous version key (null for first version, DELETE, RENAME) |
| `renamed_to`   | `string` \| absent | New note name after rename (RENAME only)                 |
| `renamed_by`   | `string` \| absent | Username who performed the rename (RENAME only)          |
| `deleted_by`   | `string` \| absent | Username who performed the deletion (DELETE only)        |

Appends use `flock(LOCK_EX)` for concurrent-write safety.

---

## Audit Log

Monthly JSONL files at `data/audit-YYYY-MM.jsonl`.  One JSON object per line.

```json
{"ts":1716163200,"event":"AUTH_LOGIN","user":"alice","ip":"192.168.1.1"}
{"ts":1716163205,"event":"NOTE_WRITE","user":"alice","note_id":"welcome","version":"2026-05-27:1:alice","ip":"192.168.1.1"}
{"ts":1716163210,"event":"NOTE_DELETE","user":"alice","note_id":"old-note","ip":"192.168.1.1"}
{"ts":1716163215,"event":"NOTE_RENAME","user":"alice","note_id":"old-name","renamed_to":"new-name","ip":"192.168.1.1"}
{"ts":1716163220,"event":"NOTE_READ","user":"bob","note_id":"welcome","version":"2026-05-27:1:alice"}
{"ts":1716163225,"event":"NOTE_RESTORE","user":"alice","note_id":"old-note"}
{"ts":1716163230,"event":"AUTH_LOGOUT","user":"alice"}
```

| Event              | Description                                              |
|--------------------|----------------------------------------------------------|
| `AUTH_LOGIN`       | Successful login                                          |
| `AUTH_LOGIN_FAIL`  | Failed login attempt                                      |
| `AUTH_REFRESH`     | Access token refreshed via refresh_token cookie           |
| `AUTH_LOGOUT`      | Explicit logout                                           |
| `NOTE_WRITE`       | Note created or updated                                   |
| `NOTE_DELETE`      | Note soft-deleted                                         |
| `NOTE_RENAME`      | Note renamed                                              |
| `NOTE_READ`        | Note content delivered to a client during sync            |
| `NOTE_RESTORE`     | Note restored from trash                                  |

IP addresses are only included when `AUDIT_LOG_IPS=true` (configurable in
`config.php`).  Audit files are purged after `AUDIT_RETENTION_DAYS` (default:
90 days) by the daily purge hook in sync.php.
