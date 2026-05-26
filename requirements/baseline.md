# Leaf — Requirements Specification

**Version:** 2.1
**Status:** Current implementation
**Purpose:** Sufficient detail to recreate the full application from scratch

---

## 1. Overview

A collaborative, offline-capable, plaintext notes web application called **Leaf**. Multiple authenticated users share a single set of notes. The application works fully offline and syncs changes automatically when connectivity is restored. Note content is treated as opaque by the server, enabling end-to-end encryption as a future addition.

---

## 2. Architecture

### 2.1 Deployment Model

- Hosted on shared PHP hosting (e.g. Namecheap) running PHP 8.x with LiteSpeed/Apache and Phusion Passenger
- **Build step required:** TypeScript sources compiled to a single JS bundle via esbuild (run `make build-spa` before deploy)
- No database — flat files only (designed for future MySQL migration via a storage abstraction layer)
- The SPA frontend may be deployed in a subdirectory (e.g. `/v6/spa/`)
  and PHP backend in a different subdirectory (e.g. `/v6/api/`) — all paths must be relative-safe
- Data directory (`data/`) should be placed outside web root in production

### 2.2 Technology Stack

**Backend:** PHP 8.x, flat files, JSONL changelog
**Frontend:** TypeScript 5.x compiled to ES2020 via esbuild, Dexie 3.x (IndexedDB wrapper), no JS framework
**Build tooling:** esbuild (bundling), tsc (type checking only, noEmit), pnpm (package manager)
**Auth:** JWT (HS256) access tokens + httpOnly refresh token cookie
**PWA:** Service worker with cache-first shell, manifest, installable
**Sync:** Custom poll-based queue (no Dexie Observable / Dexie Syncable)
**Test frameworks:** Vitest + jsdom (frontend), PHPUnit (backend), shell scripts (integration)

### 2.3 File Layout on Disk

```
/deploy-root/
  data/                   ← runtime data (should be outside web root in production)
    users.htpasswd          ← bcrypt user store
    refresh_tokens.json     ← active refresh tokens
    notes/                  ← note JSON files (auto-created)
    changelog.jsonl         ← append-only change log (auto-created)
  api/
    config.php              ← all paths, JWT settings, CORS policy
    config.php-sample       ← sample config with placeholder JWT_SECRET
    storage.php             ← storage abstraction (all file I/O)
    api.php                 ← REST API endpoints
    sync.php                ← sync endpoint
    auth.php                ← login / refresh / logout
    auth_guard.php          ← JWT verification guard
    jwt.php                 ← JWT encode/decode (no library)
    users.php               ← validate_user() interface
    adduser.php             ← CLI user management tool
  src/                    ← TypeScript source (not deployed)
    ts/
      app.ts                ← entry point
      notes.ts              ← data access layer
      db.ts                 ← Dexie schema and IndexedDB helpers
      auth.ts               ← token management
      sync.ts               ← offline queue and poll loop
      store.ts              ← reactive state
      ui.ts                 ← DOM layer
      utils.ts              ← shared utilities
      frontmatter.ts        ← frontmatter parsing, serialization, and pending-meta state
      raw-panel.ts          ← raw (textarea) tab panel
      meta-panel.ts         ← meta (structured metadata) tab panel
      tree.ts               ← collapsible tree view sidebar
      view.ts               ← SidebarView interface and event handler types
    package.json
    tsconfig.json
    pnpm-lock.yaml
    pnpm-workspace.yaml
  spa/                    ← build output + static assets
    index.html
    app.js                  ← built bundle (from src/ts/)
    manifest.json
    sw.js
    css/app.css
    icons/
      icon-192.svg
      icon-512.svg
  tests/                  ← test suites (not deployed)
    spa/                    ← Vitest frontend tests
    php/                    ← PHPUnit backend tests
    integration/            ← shell-script integration tests
  Makefile
```

---

## 3. Build System

### 3.1 Tooling

| Tool | Version | Purpose |
|---|---|---|
| TypeScript | ^5.7.0 | Type checking (`tsc --noEmit`) |
| esbuild | ^0.25.0 | Bundling TypeScript to single JS file |
| pnpm | — | Package manager (workspace-aware) |

### 3.2 Build Targets (`Makefile`)

| Target | Command | Description |
|---|---|---|
| `build-spa` | `esbuild ts/app.ts --bundle --outfile=../spa/app.js` | Bundle TypeScript sources into a single `spa/app.js` |
| `typecheck` | `tsc --noEmit` | Type-check without emitting output |
| `build` | alias for `build-spa` | Build everything |
| `test` | runs test-js + test-phpunit + test-integration | Full test suite |
| `test-js` | `cd tests/spa && pnpm test` | Vitest frontend tests |
| `test-phpunit` | `tests/vendor/bin/phpunit -c tests/php/phpunit.xml` | PHP backend tests |
| `test-integration` | `bash tests/integration/run.sh` | Full-stack integration tests |
| `serve` | `php -S localhost:9000` | Development web server |

### 3.3 Build Output

The SPA build produces `spa/app.js` — a single self-contained ES module bundle containing all application code plus Dexie. No external dependencies at runtime.

---

## 4. Data Model

### 4.1 Note File Format

Each note is stored as `notes/{id}.json`. Soft-deleted notes are renamed to `notes/{id}.deleted.json` (tombstones, never purged).

```json
{
  "current":    "2025-05-21:1:alice",
  "created_at": 1716163200,
  "versions": {
    "2025-05-20:1:alice": {
      "saved_at": 1716163200,
      "content":  "<opaque string — server never parses>",
      "prev":     null
    },
    "2025-05-21:1:alice": {
      "saved_at": 1716249600,
      "content":  "<opaque string>",
      "prev":     "2025-05-20:1:alice"
    }
  }
}
```

**Rules:**
- `content` is fully opaque to the server — never read, parsed, or inspected at any point
- `current` points to the active version key
- `created_at` is set once on CREATE and never updated
- `versions` is always kept sorted by key via `ksort()` — lexicographic order equals chronological order

### 4.2 Version Key Format

```
{UTC-date}:{counter}:{author}
e.g. 2025-05-21:1:alice
```

- **Lexicographic sort = chronological order** — enables `ksort()` for free ordering
- **Counter** resets per `(date, author)` pair, starts at 1
- **Author** is the authenticated username at time of save

### 4.3 Versioning Logic (Overwrite vs New Version)

On every save, `storage_resolve_version()` decides:

- **Overwrite** existing slot if: `current_version.author === incoming_author` AND `current_version.date === today (UTC)`
- **New version** in all other cases — compute next counter for `(today, author)` by scanning existing keys

On overwrite: `saved_at` updates, `prev` pointer is preserved unchanged.
On new version: `prev` points to the previous `current`.

This means: Alice writing multiple times in the same UTC day overwrites her last slot. Alice writing the next day creates a new slot. Bob writing after Alice always creates a new slot regardless of date.

### 4.4 Changelog Format (`changelog.jsonl`)

One JSON object per line, append-only:

```jsonl
{"rev":1,"file":"shopping","type":"CREATE","ts":1716163200,"version":null,"prev_version":null}
{"rev":2,"file":"shopping","type":"UPDATE","ts":1716249600,"version":"2025-05-21:1:alice","prev_version":"2025-05-20:1:alice"}
{"rev":3,"file":"shopping","type":"DELETE","ts":1716330000,"version":null,"prev_version":"2025-05-21:1:alice"}
{"rev":4,"file":"shopping","type":"RENAME","ts":1716410000,"version":null,"prev_version":null,"renamed_to":"groceries"}
```

**Fields:** `rev` (monotonic integer), `file` (note id), `type` (CREATE/UPDATE/DELETE/RENAME), `ts` (unix timestamp), `version` (version key written, null for CREATE/DELETE/RENAME), `prev_version` (previous version key, null for first CREATE), `renamed_to` (new note id, present only for RENAME).

`rev` is determined by reading the last non-empty line backwards in 256-byte chunks — no full file load needed.

### 4.5 Note Content and Frontmatter

Content is a free-form string that by convention begins with YAML-lite frontmatter:

```
---
title: My Note
summary: A short description
user-tags: [work, meetings]
created_by: alice
updated_by: bob
custom_key: some value
---

Note body text here...
```

The server stores and returns this as a completely opaque string. The client parses frontmatter for display and metadata editing. Frontmatter parsing and serialization is handled by the `frontmatter.ts` module.

**Reserved frontmatter keys** (handled by dedicated fields, not custom):

| Key | Usage |
|---|---|
| `title` | Human-readable title — editable |
| `summary` | Short description — editable |
| `user-tags` | Array stored as `[tag1, tag2]` — editable |
| `created_by` | Username that created the note — read-only, set on create |
| `updated_by` | Username that last saved — read-only, updated on save |
| `auto-tags` | Reserved for future automatic tagging |

All other keys are treated as custom key/value pairs and displayed in the Meta tab.

### 4.6 Folder Structure (Colon-Separated Naming)

Folders are a naming convention only — no actual subdirectories are created on
disk. The `:` (colon) separator in note names (e.g. `work:meetings:standup`)
is used to simulate a folder hierarchy. The client tree view reconstructs
the hierarchy by splitting note IDs on `:`.

When creating notes from user input, slashes (`/`) are mapped to colons by `safeName()`.

---

## 5. Backend PHP

### 5.1 `config.php`

Defines all constants. Must be the first `require_once` in every other PHP file.

| Constant | Default | Description |
|---|---|---|
| `DATA_ROOT` | `dirname(__DIR__).'/data/'` | Root directory for all runtime data |
| `NOTES_DIR` | `DATA_ROOT . 'notes/'` | Note JSON files directory |
| `CHANGELOG_FILE` | `DATA_ROOT . 'changelog.jsonl'` | Append-only changelog |
| `HTPASSWD_FILE` | `DATA_ROOT . 'users.htpasswd'` | bcrypt user store |
| `REFRESH_TOKENS_FILE` | `DATA_ROOT . 'refresh_tokens.json'` | Active refresh tokens |
| `CORS_ALLOW_POLICY` | `'*'` | `Access-Control-Allow-Origin` value — tighten in production |
| `JWT_SECRET` | (must be changed) | HS256 signing key — generate with `php -r "echo bin2hex(random_bytes(32));"` |
| `JWT_EXPIRY` | `15 * 60` | Access token lifetime in seconds |
| `REFRESH_EXPIRY` | `30 * 24 * 3600` | Refresh token lifetime in seconds |

### 5.2 `storage.php`

All file I/O is isolated here. No other PHP file reads or writes files directly (except `php://input`). Each function has a MySQL equivalent documented in a comment for future migration.

**Public functions:**

| Function | Description |
|---|---|
| `storage_get_note(id)` | Read live note. Returns null if missing or soft-deleted |
| `storage_put_note(id, data)` | Atomic write via temp file + rename |
| `storage_delete_note(id)` | Soft delete: rename `.json` → `.deleted.json` |
| `storage_note_exists(id)` | True if live (not deleted) file exists |
| `storage_list_notes()` | All live notes, metadata only, sorted by id |
| `storage_resolve_version(note, author)` | Returns `[version_key, is_overwrite]` |
| `storage_apply_write(id, content, author)` | Single write path — applies versioning, returns version key |
| `storage_rename_note(old_id, new_id)` | Rename a note file. Both files must be on same filesystem. Fails if `new_id` already exists |
| `changelog_append(entry)` | flock-protected append |
| `next_rev()` | Max rev + 1, reads changelog backwards |
| `changelog_since(rev)` | All entries where rev > given value |
| `changelog_current_rev()` | Highest rev, or 0 if empty |
| `note_is_deleted(id)` | True if `.deleted.json` tombstone exists |

**Target MySQL schema** (documented in comments):

```sql
CREATE TABLE notes (
  id         VARCHAR(200) PRIMARY KEY,
  current    VARCHAR(100),
  created_at INT NOT NULL,
  deleted    TINYINT NOT NULL DEFAULT 0
);

CREATE TABLE versions (
  note_id     VARCHAR(200) NOT NULL,
  version_key VARCHAR(100) NOT NULL,
  saved_at    INT NOT NULL,
  content     LONGTEXT NOT NULL,
  prev        VARCHAR(100),
  PRIMARY KEY (note_id, version_key),
  FOREIGN KEY (note_id) REFERENCES notes(id)
);

CREATE TABLE changelog (
  rev          INT AUTO_INCREMENT PRIMARY KEY,
  file         VARCHAR(200) NOT NULL,
  type         ENUM('CREATE','UPDATE','DELETE') NOT NULL,
  ts           INT NOT NULL,
  version      VARCHAR(100),
  prev_version VARCHAR(100),
  INDEX (rev)
);
```

### 5.3 `api.php`

Thin routing layer. All endpoints require authentication via `require_auth()`. CORS headers include `Authorization`. OPTIONS preflight bypasses auth and always returns 204.

**Endpoints:**

| Method | Action | Request | Response |
|---|---|---|---|
| GET | `list` | — | `[{id, created_at, updated_at, current}]` |
| GET | `load&file=ID` | — | `{content: string}` |
| POST | `save` | `{file, content}` | `{ok: true}` |
| POST | `new` | `{file}` | `{ok: true, file: string}` |
| POST | `delete` | `{file}` | `{ok: true}` |

**`list`:** Returns server-known fields only — no title, path, or
tags (those are in opaque content). Returns `updated_at` derived
from `versions[current].saved_at`.

**`save`:** Calls `storage_apply_write()` then appends a changelog
entry. On 404 if note is deleted. `$author` comes from `require_auth()`.

**`new`:** Creates the skeleton JSON structure with
`current: null, versions: {}`. Returns 409 if a tombstone exists for
that name.

**`delete`:** Idempotent — already deleted returns `{ok: true}`.
Calls `storage_delete_note()` then appends DELETE to changelog.

**Filename sanitization:** `safe_name()` strips everything except
`[a-zA-Z0-9_\-\.]` and applies `basename()`. Max length enforced
client-side (80 chars).

### 5.4 `sync.php`

Implements the server side of the custom poll sync protocol. Requires auth. OPTIONS preflight bypasses auth.

**Single POST endpoint.** Request body:

```json
{
  "baseRevision":   12,
  "syncedRevision": 15,
  "changes": [
    {"type": 1, "key": "note-id", "obj": {"id": "note-id", "content": "..."}},
    {"type": 3, "key": "old-note", "obj": null}
  ],
  "partial": false
}
```

Response:

```json
{
  "changes":         [...],
  "currentRevision": 18,
  "partial":         false
}
```

**Change types:** 1=CREATE, 2=UPDATE, 3=DELETE, 4=RENAME.

For RENAME, the `obj` field contains `{"renamed_to": "new-id"}` instead of `{"content": "..."}`.

**Algorithm:**
1. Apply each incoming change:
   - Types 1/2 (CREATE/UPDATE): `storage_apply_write()`
   - Type 3 (DELETE): `storage_delete_note()`
   - Type 4 (RENAME): `storage_rename_note()`. If the target name is a tombstone (`.deleted.json`), the tombstone is removed first so the rename succeeds.
2. Read `changelog_since(syncedRevision)`
3. Deduplicate by note id — send only the latest state per note (not every intermediate change)
4. Convert each changelog entry to a Dexie change object
5. Return `{changes, currentRevision, partial: false}`

**Conflict strategy:** Last-write-wins. Server always accepts incoming changes. Competing writes produce separate version entries linked by `prev` — the chain is preserved for future 3-way merge UI. Content is never inspected.

### 5.5 `jwt.php`

HS256 JWT implementation using only PHP core functions (`hash_hmac`, `base64_encode`). No external library.

- `jwt_encode(payload, expiry)` — signs with `JWT_SECRET`, auto-sets `iat` and `exp`
- `jwt_decode(token)` — verifies signature with `hash_equals()` (constant-time), checks expiry, returns payload or false

### 5.6 `users.php`

Single exported function: `validate_user(string $username, string $password): string|false`

- Reads `HTPASSWD_FILE` line by line
- Skips comment lines (`#`)
- Only accepts bcrypt hashes (`$2y$` or `$2a$` prefix) — rejects MD5/SHA1 entries
- Uses `password_verify()` for verification
- Returns the username string on success, `false` on any failure

**Swappable:** Replacing the body of `validate_user()` is the only change needed to switch to database, LDAP, or OAuth.

### 5.7 `auth.php`

Three endpoints, all POST:

**`?action=login`** — body: `{username, password}`
- Calls `validate_user()`
- On failure: sleeps `100–300ms` (random, constant-time defence), returns 401
- On success: issues JWT access token, generates cryptographically random refresh token (32 bytes hex), stores it in `refresh_tokens.json` with expiry, sets httpOnly+SameSite=Strict cookie, returns `{ok, token, username, expires}`

**`?action=refresh`** — cookie sent automatically by browser
- Reads refresh token from cookie
- Looks up in `refresh_tokens.json`
- On invalid/expired: clears cookie, returns 401
- On valid: **rotates** token (delete old, create new), updates cookie, returns new JWT
- Expired tokens are pruned from the file on every write

**`?action=logout`**
- Deletes refresh token from `refresh_tokens.json`
- Clears cookie
- Returns `{ok: true}`

**Refresh token storage** (`refresh_tokens.json`):
```json
{
  "tok_abc123": {"user": "alice", "expires": 1748000000},
  "tok_def456": {"user": "bob",   "expires": 1748000001}
}
```

Written atomically via temp file + rename. Expired entries pruned on every write.

### 5.8 `auth_guard.php`

Single function: `require_auth(): string`

- Reads `Authorization: Bearer <token>` header
- Calls `jwt_decode()`
- Returns `$payload['sub']` (username) or exits with HTTP 401 + JSON error

Must be included **after** CORS headers and OPTIONS handling so preflight requests are not rejected.

### 5.9 `adduser.php`

CLI-only tool (`php_sapi_name() !== 'cli'` check, exits 403 via HTTP).

Commands:
- `add <username> <password>` — hashes with `PASSWORD_BCRYPT` cost 12, adds or overwrites entry
- `delete <username>` — removes entry
- `list` — prints all usernames
- `check <username> <password>` — calls `validate_user()`, exits 0/1

Usernames must not contain `:` (htpasswd delimiter), `/`, or `\`. Minimum password length: 8 characters.

---

## 6. Frontend TypeScript

All JS/TS files are compiled from TypeScript sources in `src/ts/`. A single bundle (`spa/app.js`) is produced by esbuild. Dexie 3.x is imported as an ES module and bundled. No Dexie global or CDN script tag is needed.

### 6.1 `db.ts` — Dexie Schema and IndexedDB Helpers

**Schema (version 1):**

```js
db.version(1).stores({
  notes: 'id, updated_at, deleted',
  queue: '++seq, status',
});
```

**`notes` table records (`NoteRecord`):**
```ts
{
  id:         string,   // note identifier
  content:    string,   // full raw text including frontmatter — opaque
  created_at: number,   // ms timestamp, set once on CREATE
  updated_at: number,   // ms timestamp, updated on every save
  deleted:    0 | 1,    // soft delete flag
  current:    string,   // version key — server-assigned or "local" for unsynced
}
```

**`queue` table records (`QueueRecord`):**
```ts
{
  seq:        number,                   // auto-increment, determines push order
  type:       string,                   // 'CREATE' | 'UPDATE' | 'DELETE' | 'RENAME'
  id:         string,                   // note id
  content:    string | null,            // note content at time of change (null for DELETE/RENAME)
  renamed_to: string | undefined,       // target note id for RENAME
  status:     string,                   // 'pending' | 'sent'
  version:    string,                   // version the local edit was based on
}
```

Both `NoteRecord` and `QueueRecord` are exported as TypeScript interfaces.

**Exported helpers:**

| Function | Description |
|---|---|
| `ensureDbOpen()` | Re-open IndexedDB connection if closed (Firefox resilience) |
| `dbListNotes()` | All non-deleted notes sorted by id, metadata only (id, created_at, updated_at, current) |
| `dbGetNote(id)` | Full record or null if missing/deleted |
| `dbSaveNote(id, content)` | Create or update, preserves `created_at` and `current` |
| `dbDeleteNote(id)` | Sets `deleted=1` |
| `dbCreateNote(id)` | Creates empty record if not already existing |
| `dbRenameNote(oldId, newId)` | Renames a note record in IndexedDB, preserving `created_at`. Also rewrites pending queue entries for old id. |
| `dbApplyServerChange(type, id, content, version?, prevVersion?)` | Apply incoming server change — does NOT touch queue. Handles CREATE, UPDATE, DELETE, and RENAME. |
| `queueChange(type, id, content, version, extra?)` | Add to queue; collapses existing pending UPDATE/CREATE/RENAME for same id. Uses a readwrite transaction for concurrency safety. `extra.renamed_to` sets the target for RENAME. |
| `queueGetPending()` | All pending entries sorted by seq |
| `queueMarkSent(seq)` | Mark one entry sent |
| `queuePruneSent()` | Delete all sent entries |
| `dbPurgeDeletedNotes()` | Permanently remove soft-deleted records older than 7 days. Called at app boot to keep cache lean. |

### 6.2 `auth.ts` — Token Management

**Token storage:** Module-level variables only (`_token`, `_username`, `_expires`). Never `localStorage` or cookies. Cleared on tab close; restored silently via refresh cookie on next visit.

**Exported functions:**

| Function | Description |
|---|---|
| `getToken()` | Current JWT string or null |
| `getUsername()` | Logged-in username or null |
| `isLoggedIn()` | True if token exists and not expired |
| `login(username, password)` | POST to `auth.php?action=login`, stores token |
| `logout()` | POST to `auth.php?action=logout`, clears token, fires `onAuthFailure` |
| `refreshToken()` | Silent refresh via cookie. Deduplicates concurrent calls via shared promise |
| `authFetch(url, options)` | Drop-in for `fetch()` — attaches `Authorization: Bearer`, retries once on 401 after refresh |
| `tryRestoreSession()` | Called at boot — attempts `refreshToken()`, returns `'ok' \| 'auth-failed' \| 'network-error'` |
| `onAuthFailure(fn)` | Subscribe to auth failure (token expired, logout). Returns unsubscribe fn |

### 6.3 `sync.ts` — Offline Queue and Poll Loop

**Config:**
- `SYNC_URL = '../api/sync.php'`
- `POLL_INTERVAL = 30_000` ms
- `RETRY_DELAY = 10_000` ms
- `REVISION_KEY = 'notes_sync_revision'` (localStorage key, integer)

**State machine:** `OFFLINE ↔ IDLE → SYNCING → IDLE` (or `→ ERROR → IDLE` after retry delay)

**Wire format to `sync.php`:** Same as described in §5.4. All requests go through `authFetch()`.

**Change type mapping:** `{CREATE: 1, UPDATE: 2, DELETE: 3, RENAME: 4}`

**`push()`:**
1. Read pending queue entries
2. Convert to `{type: 1|2|3|4, key, obj}` format:
   - CREATE/UPDATE → `{id, content, version: entry.version}`
   - RENAME → `{renamed_to: entry.renamed_to, version: entry.version}`
   - DELETE → `null`
3. POST to `sync.php` with `baseRevision = syncedRevision = getRevision()`
4. On success: mark entries sent, apply any server changes returned in same response

**`pull()`:**
1. POST to `sync.php` with empty `changes: []`
2. Apply returned server changes via `dbApplyServerChange()`
3. Update stored revision

**`tick()`:** `push()` then `pull()` then `queuePruneSent()`. Guards against concurrent execution via `running` boolean. On `AUTH_FAILURE` error: sets status to OFFLINE, stops without retry.

**Poll loop:** `schedulePoll()` uses `setTimeout` (not `setInterval`). Reschedules after each tick completes to avoid overlap.

**Exported functions:**

| Function | Description |
|---|---|
| `syncStart()` | Wire online/offline events, fire immediate tick, start poll loop |
| `syncNow()` | Immediate tick + reschedule (called after save/create/delete) |
| `stopSync()` | Clear poll timer (called on logout) |
| `clearRevision()` | Remove stored revision from localStorage (before DB reset) |
| `onSyncStatus(fn)` | Subscribe to status changes. Returns unsubscribe fn |
| `getSyncStatus()` | Current status string |
| `onRemoteChange(fn)` | Subscribe to incoming server changes. Returns unsubscribe fn |

### 6.4 `notes.ts` — Data Access Layer

All reads/writes go to IndexedDB. Server is never called directly. Function signatures intentionally match a server-fetch API so callers need no changes if the implementation changes.

**`NoteData` interface** (returned by `loadNote()`):
```ts
interface NoteData {
  id: string;                              // note id (filename)
  content: string;                         // full raw content (frontmatter + body)
  created_at: number;                      // from IndexedDB record
  updated_at: number;                      // from IndexedDB record
  current: string;                         // from IndexedDB record (version key)
  meta: Record<string, string | string[]>; // parsed frontmatter
}
```

**Operations:**

| Function | IndexedDB op | Queue op | Notes |
|---|---|---|---|
| `listNotes()` | `dbListNotes()` | none | Returns `NoteMeta[]` (id, timestamps, current) |
| `loadNote(id)` | `dbGetNote(id)` | none | Returns `NoteData` — merges DB fields + parsed frontmatter |
| `saveNote(id, content)` | `dbSaveNote()` | `queueChange('UPDATE', ...)` | Auto-sets `updated_by` in frontmatter |
| `createNote(id)` | `dbCreateNote()` | `queueChange('CREATE', ...)` | Auto-sets `created_by` and `updated_by` in frontmatter |
| `deleteNote(id)` | `dbDeleteNote()` | `queueChange('DELETE', ...)` | |
| `renameNote(oldId, newId)` | `dbRenameNote()` | `queueChange('RENAME', ...)` | `renamed_to` in extra opts |

### 6.5 `store.ts` — Reactive State

Simple event emitter pattern — no framework. `on(event, fn)` returns an unsubscribe function.

**State shape:**
```js
{
  notes:    [],      // [{id, created_at, updated_at, current}] from server/IndexedDB
  filtered: [],      // after search filter (matches note id only)
  current:  null,    // currently open note id
  content:  '',      // full raw textarea content (includes frontmatter)
  dirty:    false,   // unsaved changes flag
  query:    '',      // search string
  online:   bool,    // from navigator.onLine / sync status
}
```

**`NoteMeta` interface** (exported):
```ts
interface NoteMeta {
  id: string;
  created_at: number;
  updated_at: number;
  current: string;
}
```

**Events emitted:** `notes-changed`, `count-changed`, `note-opened`, `dirty-changed`, `note-closed`, `online-changed`

**Search:** Matches against note `id` (filename) only — not title, tags, or content.

**Dirty-state guard:** `updateContent()` only marks dirty if a note is actually open (`state.current !== null`). This prevents browser form restoration from falsely enabling the Save button after page load.

### 6.6 `ui.ts` — DOM Layer

All DOM manipulation isolated here. No business logic. No imports from `api.js` or `store.js`. Callbacks injected via `bindEvents()`. Coordinates the new panel-based editor (raw-panel and meta-panel).

**Sidebar delegation:** `renderFileList()` delegates to a `currentView: SidebarView` (default: `TreeView`). This enables swapping in alternative sidebar modes in the future.

**Exported functions:**

| Function | Description |
|---|---|
| `initPanels(onDirty)` | One-time setup: initialise raw/meta panels, bind panel events, wire tab buttons. `onDirty` callback marks store dirty from meta panel changes. |
| `renderFileList(notes, currentId)` | Render sidebar list using current `SidebarView` |
| `setActiveFile(id)` | Toggle `.active` class on file items |
| `updateNoteCount(total, shown)` | Update footer count (delegates to current view) |
| `showEditor(noteData)` | Show editor with tab bar, populate raw textarea and meta system fields from `NoteData`. Activates Raw tab by default. |
| `hideEditor()` | Hide tab bar and panels, show empty state, reset meta state |
| `flushAndGetContent()` | If on Meta tab with pending changes, flush them to the textarea, then return textarea value. Use for saving. |
| `getRawContent()` | Plain read of textarea value with no side-effects. Use for diagnostics or keystroke listeners (never for saving). |
| `setDirty(val)` | Toggle dirty dot, disable/enable save button |
| `setStatus(msg, ttl)` | Status bar message with optional auto-clear |
| `setOffline(offline)` | Toggle offline badge |
| `setSyncStatus(text)` | Update sync status indicator (cleared when 'ONLINE') |
| `setSidebarLoading(loading)` | Show/hide first-visit sync spinner |
| `toast(msg, isErr)` | Append a self-removing toast (3.5s) |
| `openModal()` | Show new-note modal, focus input; pre-fills with search text + current note path prefix |
| `openRenameModal(id)` | Open modal in rename mode with note id pre-filled |
| `closeModal()` | Hide modal |
| `setModalError(msg)` / `setModalHint(msg)` | Modal feedback |
| `getModalValue()` | Trimmed modal input value |
| `toggleSidebar()` | Toggle sidebar collapsed/visible |
| `clearSearch()` | Clear search input and dispatch input event |
| `showLoginScreen()` | Show login, hide app shell, clear fields |
| `showAppShell(username)` | Hide login, show app shell, set username display |
| `hideLoginScreen()` | Dismiss login overlay, show app shell |
| `showOfflineFirstVisit()` | Show offline-unauthenticated prompt in sidebar |
| `setLoginError(msg)` | Login form error message |
| `setLoginLoading(loading)` | Login button loading state |
| `bindEvents(callbacks)` | Wire all DOM events once |

**`bindEvents` callbacks:** `onOpen(id)`, `onDelete(id)`, `onRename(id)`, `onRenameConfirm(oldId)`, `onSearch(q)`, `onSave()`, `onNew()`, `onCreate()`, `onCancelModal()`, `onLogin(username, password)`, `onLogout()`, `onUpdateSW()`, `onResetDB()`, `onSignIn()`, `onDismissLogin()`

**Sidebar event delegation:** Single click listener on `#file-list`. Delegates to `currentView.handleClick(e, handlers)`. In tree view mode, this handles tree toggle arrows, "more" (⋯) context menu buttons, and note-item clicks.

**Note editor input:** Textarea input fires a `CustomEvent('note-changed', {bubbles: true})` — `app.ts` listens for this and calls `store.updateContent(ui.getRawContent())`.

**Tab switching (internal):**
- **Raw → Meta:** Re-parse frontmatter from textarea, compute body stats, render meta panel.
- **Meta → Raw:** If pending meta changes, flush them to textarea via `updateFrontmatter()`. Activate raw tab.
- **Meta dirty flag:** When meta fields change, the global store dirty state is also updated so the Save button is enabled.

### 6.7 `app.ts` — Entry Point

**Import order:**
1. `notes.ts`, `store.ts`, `ui.ts`
2. `db.ts` (for `db.notes.count()` on first visit check, `dbPurgeDeletedNotes()`)
3. `sync.ts` (`syncStart`, `syncNow`, `stopSync`, `clearRevision`, `onSyncStatus`, `onRemoteChange`)
4. `auth.ts` (`login`, `logout`, `getUsername`, `tryRestoreSession`, `onAuthFailure`)

**Boot sequence:**
1. `ui.setOffline(!navigator.onLine)`
2. `showApp(false)` — show app shell first, always (no gate)
3. `tryRestoreSession()` — silent refresh via cookie
   - `'ok'` → upgrade UI, start sync
   - `'auth-failed'` → show login screen
   - `'network-error'` → stay in offline mode, app already visible

**`showApp(hasSession)` sequence:**
1. `ui.showAppShell(username)`
2. `dbPurgeDeletedNotes()` (fire-and-forget)
3. `db.notes.count()` — if 0 and online and has session: `ui.setSidebarLoading(true)` (first visit indicator)
4. `refreshList()` — render what's in IndexedDB immediately
5. If has session: `syncStart()` — begin poll loop

**Auth handling:**
- `showLogin()` → `stopSync()`, `ui.showLoginScreen()`
- `handleLogout()` → `logout()`, `onAuthFailure` fires → `showLogin()`
- `handleDismissLogin()` → hide login screen, stay in offline mode
- `handleSignIn()` → show login screen

**`saveFile()`:** Calls `ui.flushAndGetContent()` (flushes meta-pending changes if on Meta tab), saves via `notes.saveNote()`, calls `syncNow()`.

**`note-changed` listener:** Uses `ui.getRawContent()` for plain read (no side-effects) — must NOT call `flushAndGetContent()` on every keystroke.

**`initPanels()`:** Called during startup, passes callback `() => store.updateContent(ui.getRawContent())` so meta-panel dirty state marks the store dirty.

**Other operations:** `refreshList()`, `openFile()`, `deleteFile()`, `handleRenameClick()`, `handleRenameConfirm()`, `createFile()`, `handleSearch()`, `handleUpdateApp()`, `handleResetDB()`.

**Keyboard shortcuts:** `Ctrl/Cmd+S` → save. `Escape` → close modal or dismiss login.

**Unload guard:** `beforeunload` warns if `dirty` and editor is visible.

**PWA shortcut:** `?action=new` in URL → `ui.openModal()` on load.

### 6.8 `frontmatter.ts` — Frontmatter Parsing & Serialization

Pure data module with no DOM dependencies. Contains all frontmatter parsing, serialization, and the pending-meta state machine.

**Types exported:**

| Type | Description |
|---|---|
| `FrontmatterResult` | `{meta: Record<string, string \| string[]>, body: string}` |
| `PendingMeta` | `{title: string, summary: string, tags: string[], custom: Record<string, string>}` — form state |
| `ContentStats` | `{chars: number, words: number, lines: number}` — body-only statistics |

**Functions exported:**

| Function | Description |
|---|---|
| `parseFrontmatter(raw)` | Parse YAML-lite frontmatter between `---` delimiters. Handles inline arrays (`[one, two]`). Returns `{meta: {}, body: raw}` if no frontmatter present. |
| `updateFrontmatter(content, updates)` | Merge fields into frontmatter. `updates` keys with value `undefined` are deleted. `string[]` values serialize as `[a, b]`. Creates frontmatter block if none exists. |
| `initPendingMeta(fm)` | Build initial `PendingMeta` from parsed frontmatter, extracting reserved keys into dedicated fields and remaining into `custom`. |
| `pendingMetaToUpdates(pm)` | Convert `PendingMeta` into an update map for `updateFrontmatter()`. Empty strings produce `undefined` (delete). |
| `pendingMetaEqual(a, b)` | Deep comparison for dirty checking. |
| `computeStats(body)` | Compute chars/words/lines from body portion (frontmatter stripped). |
| `sanitizeKey(key)` | Validate a frontmatter key name. Returns key if valid, empty string otherwise. |
| `sanitizeTags(tags)` | Deduplicate and natural-sort an array of tags. |
| `sanitizeCustom(custom)` | Remove entries with invalid keys from a custom-fields record. |

**Reserved keys** (handled by dedicated fields, excluded from custom): `title`, `summary`, `user-tags`, `auto-tags`, `created_by`, `updated_by`.

### 6.9 `raw-panel.ts` — Raw Tab Panel

Owns all textarea DOM and dispatches `note-changed` on programmatic writes.

**Exported functions:**

| Function | Description |
|---|---|
| `initRawPanel()` | One-time setup: cache textarea DOM ref |
| `showRawPanel(content)` | Populate textarea and clear any stale inline `display` style |
| `hideRawPanel()` | Hide the raw panel (resets nothing — value preserved for tab switching) |
| `getRawContent()` | Plain read of textarea value, no side-effects |
| `setRawContent(content)` | Programmatic write + dispatch `note-changed` custom event (keeps store in sync) |
| `focusRawPanel()` | Focus the textarea |
| `bindRawEvents(handlers)` | Wire textarea `input` event to `handlers.onInput()` |

**Important:** Setting `textarea.value = ...` in JS does NOT trigger the `input` event. All code paths that write to the textarea must use `setRawContent()` to keep the store in sync. The initial load (`showRawPanel()`) does not dispatch `note-changed` — the note just opened, not dirty.

### 6.10 `meta-panel.ts` — Meta Tab Panel

Owns all meta-tab DOM: form fields (title, summary, tags), custom key/value rows, system info, and body-content statistics.

**Exported functions:**

| Function | Description |
|---|---|
| `initMetaPanel()` | One-time setup: cache all meta panel DOM refs |
| `renderMetaPanel(pm, stats)` | Populate title/summary/tags fields, render custom rows, display content stats |
| `getMetaFormValues()` | Read current form values from DOM → `PendingMeta` |
| `resetMetaPanel()` | Clear all fields (called when editor is hidden) |
| `populateSystemFields(noteData)` | Populate version, created/updated timestamps, created_by, updated_by from `NoteData` |
| `renderCustomRows(custom)` | Render custom field key/value rows |
| `addCustomRow()` | Add an empty custom field row |
| `bindMetaEvents(handlers)` | Wire input events on all editable fields, add-custom button, and remove-custom buttons |

**System info fields:** Version (`current`), Created (timestamp), Updated (timestamp), Created by, Updated by — all read-only.

**Stats line:** Shows `{chars} chars · {words} words · {lines} lines` (body only, frontmatter excluded).

### 6.11 `tree.ts` — Tree View Sidebar

Implements the `SidebarView` interface. Builds a collapsible tree from flat `NoteMeta[]` using `:` as the path separator.

**Module-level state:**
- `expandedPaths` — Set of branch paths currently expanded
- `savedExpanded` — Snapshot saved when a search is active, restored when search is cleared
- `contextMenuTarget` — Path of the note whose context menu is open

**Tree building:** Notes are sorted using natural sort (numeric segments compared as numbers, string segments compared lexicographically). At each level, branches (nodes with children) sort before leaves.

**Auto-expand:** When a note is currently open, all ancestor branches along its path are auto-expanded.

**Search mode:** When a search is active, the tree collapses to a flat list of matching notes. The previous expanded state is saved and restored when the search is cleared.

**Context menu:** Right-click/⋯ button on a note shows rename and delete options in a floating context menu. One outside-click listener dismisses it.

**Exported:** `TreeView` object implementing the `SidebarView` interface with `render()`, `handleClick()`, `updateNoteCount()`, and `destroy()`.

### 6.12 `view.ts` — Interfaces & Event Handler Types

Pure type module — no runtime code. Separated to avoid circular imports between `ui.ts` and `tree.ts`.

**Exported interfaces:**

| Interface | Description |
|---|---|
| `UIEventHandlers` | All callbacks passed to `ui.bindEvents()` (onOpen, onDelete, onRename, onRenameConfirm, onSearch, onSave, onNew, onCreate, onCancelModal, onLogin, onLogout, onUpdateSW, onResetDB, onSignIn, onDismissLogin) |
| `RawEventHandlers` | `onInput` callback for raw-panel events |
| `MetaEventHandlers` | `onFieldChange`, `onAddCustomField`, `onRemoveCustomField(key)` for meta-panel events |
| `SidebarView` | Contract for sidebar implementations: `render()`, `handleClick()`, `updateNoteCount()`, `destroy()` |

---

## 7. Frontend HTML and CSS

### 7.1 `index.html` Structure

```
<body>
  #login-screen          ← shown by default (display:flex), dismissible with × button
    #login-card
      #login-close        ← dismiss button (×)
      #login-brand
      #login-heading
      #login-form
        #login-username
        #login-password
        #login-error
        #login-btn

  #app                   ← hidden by default (display:none)
    #header
      #header-brand        ← includes #btn-toggle-sidebar, #btn-menu (app menu), dropdown
        #btn-toggle-sidebar
        #btn-menu
        #app-menu (.dropdown-menu)
          #menu-update       ← "Update App"
          #menu-reset-db     ← "Reset Database"
      #header-center (#current-file, #dirty-dot)
      #header-actions (#username-display, #btn-signin, #btn-save, #btn-logout)

    #main
      #sidebar (collapsible via .sidebar-collapsed)
        #sidebar-toolbar (#search-wrap>#search, #btn-new)
        #file-list          ← tree view or flat list (delegated to SidebarView)
        #sidebar-loading (.sidebar-spinner, span)
        #sidebar-footer (#note-count)

      #editor-wrap
        #empty-state (.empty-icon, p, small>kbd)

        #editor-tabs         ← tab bar (hidden when no note open)
          #tab-btn-raw         ← "Raw" tab button
          #tab-btn-meta        ← "Meta" tab button

        #tab-raw (.tab-panel) ← raw editing panel
          #note-area (textarea)

        #tab-meta (.tab-panel) ← structured metadata panel
          #meta-panel
            .meta-field>label+input#meta-title
            .meta-field>label+textarea#meta-summary
            .meta-field>label+input#meta-tags
            #meta-custom-section
              .meta-section-header + #btn-add-custom
              #meta-custom-rows
            #meta-stats-section
              .meta-section-header
              #meta-stats
            #meta-system-section
              .meta-section-header
              table#meta-system-table
                rows for: version, created, updated, created by, updated by

    #statusbar
      #status-msg
      #offline-badge
      #sync-status
      ← char-count and line-count REMOVED (moved to meta panel body-only stats)

  #modal-overlay
    #modal
      #modal-title
      .modal-field>label+input#modal-input
      #modal-hint
      #modal-actions (#modal-cancel, #modal-create)

  #toast-container

  #item-context-menu (.item-context-menu)  ← shared context menu for rename/delete
    button[data-action="rename"]
    button[data-action="delete"]

  <script src="app.js">   ← single built bundle (TypeScript compiled via esbuild)
```

**Notes:**
- Login screen is `display:flex`, app shell is `display:none` — JS swaps them after auth
- Login screen is dismissible — user can skip auth and work offline
- Dexie is imported as an ES module inside the bundle — no CDN script tag needed
- Tab bar and panels are shown/hidden by `showEditor()` / `hideEditor()` and `switchTab()`, never by CSS alone
- Character and line counts have been removed from the status bar; body-only content stats appear in the Meta tab
- The sidebar can be toggled collapsed via the `#btn-toggle-sidebar` button, which adds/removes `.sidebar-collapsed` on `#app`

### 7.2 CSS Design Tokens

**Palette (dark editorial):**

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#0a0a0a` | Main background |
| `--bg-2` | `#111111` | Sidebar, header, status bar |
| `--bg-3` | `#1c1c1c` | Inputs, button backgrounds |
| `--bg-hover` | `#242424` | Hover states |
| `--bg-active` | `#2e2e2e` | Active/pressed states |
| `--border` | `#2a2a2a` | Subtle borders |
| `--border-mid` | `#3a3a3a` | Standard borders |
| `--border-hi` | `#505050` | Prominent borders, inputs |
| `--text-1` | `#f0ece4` | Primary text |
| `--text-2` | `#b8b0a4` | Secondary text |
| `--text-3` | `#7a7269` | Muted text, placeholders |
| `--accent` | `#d4c4a0` | Accent (warm gold) |
| `--accent-dim` | `#9a8c74` | Dimmed accent |
| `--accent-glow` | `rgba(212,196,160,.15)` | Focus glow |
| `--danger` | `#e05050` | Error / delete |
| `--danger-bg` | `rgba(224,80,80,.15)` | Error background |

**Typography:**
- UI font: `DM Sans` (Google Fonts), fallback `system-ui`
- Monospace font: `DM Mono` (Google Fonts), fallback `Menlo`, `Monaco`
- Editor (`#note-area`): DM Mono, 13.5px, weight 300, line-height 1.8
- File list: DM Mono, 12.5px

**Layout:**
- `--sidebar-w: 220px`
- `--header-h: 46px`
- `--status-h: 26px`
- `--radius: 6px`
- `--radius-lg: 10px`

**Responsive breakpoint:** `max-width: 600px` — sidebar stacks above editor, full width, max-height 40vh

### 7.3 Notable CSS Behaviours

- **Active note:** `background: var(--accent-glow)`, `border: 1px solid rgba(212,196,160,.22)`, `color: var(--accent)`
- **Dirty dot:** 7px circle, `opacity:0` → `opacity:1` via `.visible` class, transition 0.15s
- **Textarea max-width:** 800px, `align-self: center` — comfortable reading width. Textarea visibility is now controlled by its parent panel (`#tab-raw`), not by an inline `display` style.
- **Caret:** `caret-color: var(--accent)`
- **First-visit spinner:** `border-top-color: var(--accent)`, 20px, 0.7s linear infinite, hidden by default
- **Tab bar:** `#editor-tabs` shown as `display:flex` when a note is open. Tab buttons use `.active` class for the current tab (gold border-bottom accent).
- **Meta panel:** Form fields stack vertically with section headers. Custom field rows contain key/value inputs and a remove (×) button. System info rendered in a simple two-column table.
- **Tree view:** Branch nodes have toggle arrows (▶/▼). Branch-only nodes (no note directly at that path) are visually distinct. Indentation increases 16px per level. Context menu appears on ⋯ button click, positioned at the button's location.
- **Sidebar toggle:** `#app.sidebar-collapsed` hides the sidebar entirely via CSS.
- **App menu dropdown:** Toggled by clicking the brand area; closes on outside click. Contains "Update App" and "Reset Database" actions.

---

## 8. PWA

### 8.1 `manifest.json`

```json
{
  "name": "Leaf",
  "short_name": "Leaf",
  "start_url": "./",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "shortcuts": [
    {"name": "New Note", "url": "./?action=new"}
  ]
}
```

All URLs are relative (`./`) so the manifest works correctly from any subdirectory.

### 8.2 `sw.js`

**Base path derivation:**
```js
const BASE = self.location.pathname.replace(/\/sw\.js$/, '');
```
All shell paths are prefixed with `BASE` — never absolute `/` paths. This makes the service worker subdirectory-safe.

**Cache name:** `leaf-v1` (increment on any shell change to force update)

**Precache (install):** All shell files with `${BASE}/` prefix:
```
index.html, css/app.css, app.js, manifest.json, icons/icon-192.svg, icons/icon-512.svg
```
Dexie is bundled into `app.js` — no external CDN dependency to precache.

**Fetch strategy:**
- `api.php`, `sync.php`, `auth.php` → **network only**, never cached. Offline fallback returns `{error: 'Offline', changes: [], currentRevision: null}`
- Everything else → **cache first**, update cache in background

**Update notification:** The update listener is in `app.ts` (not `sw.js`). On `updatefound` + `statechange` → `ui.toast('Update available — refresh to apply.')`.

**Background sync hook:** Reserved for future use. `self.addEventListener('sync', ...)` is stubbed but not wired to actual sync logic.

---

## 9. Authentication Flow

### 9.1 First Visit / Login

```
User enters credentials
  → POST auth.php?action=login {username, password}
  → Server: validate_user() → bcrypt verify
  → Server: issue JWT (15min) + refresh token cookie (30 days, httpOnly+SameSite=Strict)
  → Client: store JWT in memory, store username
  → showApp()
```

### 9.2 Return Visit (Silent Restore)

```
boot()
  → showApp(false)         ← show app shell regardless (no gate)
  → tryRestoreSession()
  → POST auth.php?action=refresh (cookie sent automatically)
  → Server: validate refresh token, rotate token, issue new JWT
  → Client: store new JWT
  → Upgrade UI, start sync
```

If `tryRestoreSession()` returns `'auth-failed'`: show login screen (server reachable, session invalid).
If `tryRestoreSession()` returns `'network-error'`: stay in offline mode (app already visible, user can work locally).

### 9.3 Token Expiry During Session

```
authFetch() makes request
  → 401 received
  → refreshToken() called (deduplicates concurrent calls)
  → POST auth.php?action=refresh
  → On success: retry original request with new token
  → On failure: notifyAuthFailure() → showLogin()
```

### 9.4 Logout

```
handleLogout()
  → logout() → POST auth.php?action=logout
  → Server: delete refresh token, clear cookie
  → Client: clearToken() → notifyAuthFailure() → showLogin()
  → stopSync()
```

### 9.5 Offline / Dismiss Login

The login screen has a dismiss (×) button and responds to the Escape key. Dismissing the login screen hides it and shows the app shell in offline mode — the user can work locally without authentication. A "Sign in" button in the header allows them to authenticate later.

---

## 10. Sync Protocol

### 10.1 Client Queue Model

Every mutating operation writes to IndexedDB first (offline-safe), then adds to the `queue` table:

- `saveNote()` → `dbSaveNote()` + `queueChange('UPDATE', ...)`
- `createNote()` → `dbCreateNote()` + `queueChange('CREATE', ...)`
- `deleteNote()` → `dbDeleteNote()` + `queueChange('DELETE', ...)`
- `renameNote(oldId, newId)` → `dbRenameNote()` + `queueChange('RENAME', ...)`

Queue collapse: `queueChange()` for UPDATE/CREATE/RENAME deletes any existing pending entry for the same note before inserting, preventing redundant pushes of intermediate states.

### 10.2 Sync Tick Sequence

```
tick()
  1. push() — send pending queue to sync.php
  2. pull() — fetch changes since last revision
  3. queuePruneSent() — clean up sent entries
```

### 10.3 First Visit Loading State

On `showApp()`:
1. `db.notes.count()` — if 0 AND online: show `#sidebar-loading` spinner
2. Spinner hidden when sync status transitions to IDLE/ERROR/OFFLINE
3. Spinner hidden immediately when `onRemoteChange` fires (notes arrived)

### 10.4 Revision Tracking

- Stored in `localStorage` as `notes_sync_revision` (integer)
- Set to `currentRevision` from every server response
- Sent as both `baseRevision` and `syncedRevision` in every request
- `null` on first sync (server interprets as "send everything")

### 10.5 Pulled Change Application

Server changes are applied via `dbApplyServerChange()`:
- CREATE/UPDATE: Insert or update note with server-provided content, preserving `created_at` if existing
- DELETE: Set `deleted=1` on existing record
- RENAME: Copy record to new id, delete old id, rewrite any pending queue entries for old id
- None of these operations touch the queue (server changes are not re-queued)

---

## 11. Testing

The project has a multi-layered test strategy covering frontend, backend, and full-stack integration.

### 11.1 Frontend Tests (Vitest)

**Framework:** Vitest 3.x with `jsdom` environment and `fake-indexeddb`.

**Setup:** `tests/spa/setup.js` installs `fake-indexeddb/auto` so Dexie works without a real browser. Between each test, IndexedDB tables are cleared (not deleted — the Dexie instance stays alive).

**Test files:**

| File | Module under test |
|---|---|
| `auth.test.js` | Token management, login/logout flows |
| `db.test.js` | Dexie schema, IndexedDB CRUD, queue operations |
| `notes.test.js` | Data access layer (notes.ts) |
| `store.test.js` | Reactive state, event emitter |
| `sync.test.js` | Sync protocol, push/pull, queue management |
| `ui.test.js` | DOM manipulation, rendering, event binding, tab panels |
| `utils.test.js` | Shared utility functions, frontmatter parsing/serialization |
| `frontmatter.test.js` | Frontmatter parse, updateFrontmatter, initPendingMeta, computeStats, tag sanitization |

**Run with:** `make test-js` or `cd tests/spa && pnpm test`

### 11.2 PHP Backend Tests (PHPUnit)

**Framework:** PHPUnit with a custom bootstrap.

**Test files:**

| File | Module under test |
|---|---|
| `JwtTest.php` | JWT encode/decode, signature verification |
| `StorageTest.php` | File I/O, note CRUD, changelog operations |
| `SyncUtilTest.php` | Sync protocol helpers, change type mapping |
| `UsersTest.php` | User validation, bcrypt verification |

**Run with:** `make test-phpunit`

### 11.3 Integration Tests (Shell)

**Framework:** Bash scripts against a real PHP dev server.

**Files:**
- `tests/integration/test_auth.sh` — Login, refresh, logout flows
- `tests/integration/test_sync.sh` — Note sync, conflict resolution
- `tests/integration/run.sh` — Orchestrator that starts server, runs tests, cleans up

**Run with:** `make test-integration` (uses port 8080 by default, override with `PORT=9000`)

**Environment:** Integration tests use an isolated temp directory with their own config, users, and data.

---

## 12. Security

| Concern | Mechanism |
|---|---|
| Authentication | JWT HS256, 15-min access token |
| Session persistence | httpOnly+Secure+SameSite=Strict refresh cookie |
| Token theft mitigation | Refresh tokens rotate on every use |
| XSS token theft | Access token in JS memory only (not localStorage) |
| CSRF | SameSite=Strict cookie + Bearer token (no cookie auth for API) |
| Password storage | bcrypt cost 12 (PHP `PASSWORD_BCRYPT`) |
| Timing attacks | `hash_equals()` for JWT sig, random sleep on failed login |
| Content privacy | Server never reads note content — opaque blob throughout |
| File path traversal | `safe_name()` strips all non-alphanumeric chars, applies `basename()` |
| HTTP-only files | `users.htpasswd` and `refresh_tokens.json` should be outside web root in production |
| OPTIONS preflight | Bypasses auth in both `api.php` and `sync.php` — must be ordered correctly |

---

## 13. Editor Architecture (Tabbed Editor)

### 13.1 Overview

The editor area uses a two-tab interface:

- **Raw tab** — the standard textarea showing full note content including frontmatter
- **Meta tab** — structured view/edit of metadata fields (title, summary, tags, custom fields) plus read-only system information

### 13.2 Data Flow

1. **Open note** → Raw tab shown by default, textarea filled with full content. Frontmatter is parsed and stored as initial `_pendingMeta` (a baseline; discarded and re-parsed on first switch to Meta tab).

2. **Switch to Meta tab** → Re-parse frontmatter from current textarea value. Compute `ContentStats` from the body (chars/words/lines). Populate form fields, custom-field rows, and content-stats line from fresh parse.

3. **Edit a meta field** → Update `_pendingMeta` object, set `_pendingMetaDirty = true`. Also update the global store dirty state so the Save button is enabled. Textarea is NOT modified yet.

4. **Switch from Meta → Raw** → If `_pendingMetaDirty`, call `updateFrontmatter()` to merge `_pendingMeta` into the current textarea content, then write the result via `setRawContent()` (which dispatches `note-changed`). Reset `_pendingMetaDirty = false`.

5. **Save** (any tab) → `flushAndGetContent()` flushes `_pendingMeta` if on Meta tab (same merge + write as step 4), resets `_pendingMetaDirty = false`, then returns the textarea value. Save proceeds as normal — `notes.saveNote()` sets `updated_by` automatically.

### 13.3 Module Responsibilities

| Module | Responsibility |
|---|---|
| `frontmatter.ts` | Pure functions: parse, serialize, pending-meta state machine, stats computation |
| `raw-panel.ts` | Textarea DOM lifecycle, programmatic writes with `note-changed` dispatch |
| `meta-panel.ts` | Meta tab DOM: form fields, custom rows, system info, stats display |
| `ui.ts` | Coordinator: tab switching logic, dirty-state bridging, delegates to panel modules |

### 13.4 Key Design Decisions

- **Batched meta edits:** Meta changes are tracked in `_pendingMeta` and only flushed to the textarea when saving or switching tabs. This prevents interleaving partial edits.
- **Flush on read:** `flushAndGetContent()` is named explicitly to signal the side-effect (flushing meta) rather than a plain getter.
- **Plain read:** `getRawContent()` provides a side-effect-free read of the textarea value, used by the `note-changed` keystroke listener.
- **Programmatic writes:** Setting `textarea.value` in JS does not fire `input` events. `setRawContent()` explicitly dispatches `note-changed` to keep the store in sync.
- **Reserved keys:** `title`, `summary`, `user-tags`, `auto-tags`, `created_by`, `updated_by` have dedicated handling and are excluded from custom fields.
- **Tag round-trip:** `user-tags` is stored in frontmatter as `[tag1, tag2]` (bare bracket notation). The meta tab displays them comma-separated. Tags are deduplicated and naturally sorted on parse.

