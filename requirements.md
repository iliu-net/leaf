# Notes App — Requirements Specification

**Version:** 1.0
**Status:** Current implementation
**Purpose:** Sufficient detail to recreate the full application from scratch

---

## 1. Overview

A collaborative, offline-capable, plaintext notes web application. Multiple authenticated users share a single set of notes. The application works fully offline and syncs changes automatically when connectivity is restored. Note content is treated as opaque by the server, enabling end-to-end encryption as a future addition.

---

## 2. Architecture

### 2.1 Deployment Model

- Hosted on shared PHP hosting (e.g. Namecheap) running PHP 8.x with LiteSpeed/Apache and Phusion Passenger
- No build step, no npm, no framework — vanilla PHP backend, vanilla ES module JavaScript frontend
- No database — flat files only (designed for future MySQL migration via a storage abstraction layer)
- The SPA frontend may be deployed in a subdirectory (e.g. `/v6/spa/`)
  and PHP backend in a different subdirectory (e.g. `/v6/api/`) — all paths must be relative-safe

### 2.2 Technology Stack

**Backend:** PHP 8.x, flat files, JSONL changelog
**Frontend:** Vanilla JS (ES modules), Dexie 3.x (IndexedDB wrapper), no JS framework
**Auth:** JWT (HS256) access tokens + httpOnly refresh token cookie
**PWA:** Service worker with cache-first shell, manifest, installable
**Sync:** Custom poll-based queue (no Dexie Observable / Dexie Syncable)

### 2.3 File Layout on Disk

```
/deploy-root/
  users.htpasswd          ← bcrypt user store
  refresh_tokens.json     ← active refresh tokens
  notes/                  ← note JSON files (auto-created)
  changelog.jsonl         ← append-only change log (auto-created)
  api/
    config.php              ← all paths and JWT settings
    storage.php             ← storage abstraction (all file I/O)
    api.php                 ← REST API endpoints
    sync.php                ← sync endpoint
    auth.php                ← login / refresh / logout
    auth_guard.php          ← JWT verification guard
    jwt.php                 ← JWT encode/decode (no library)
    users.php               ← validate_user() interface
    adduser.php             ← CLI user management tool
  spa/
    index.html
    manifest.json
    sw.js
    css/app.css
    js/
      app.js
      api.js
      auth.js
      db.js
      sync.js
      store.js
      ui.js
    icons/
      icon-192.svg
      icon-512.svg
```

---

## 3. Data Model

### 3.1 Note File Format

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

### 3.2 Version Key Format

```
{UTC-date}:{counter}:{author}
e.g. 2025-05-21:1:alice
```

- **Lexicographic sort = chronological order** — enables `ksort()` for free ordering
- **Counter** resets per `(date, author)` pair, starts at 1
- **Author** is the authenticated username at time of save

### 3.3 Versioning Logic (Overwrite vs New Version)

On every save, `storage_resolve_version()` decides:

- **Overwrite** existing slot if: `current_version.author === incoming_author` AND `current_version.date === today (UTC)`
- **New version** in all other cases — compute next counter for `(today, author)` by scanning existing keys

On overwrite: `saved_at` updates, `prev` pointer is preserved unchanged.
On new version: `prev` points to the previous `current`.

This means: Alice writing multiple times in the same UTC day overwrites her last slot. Alice writing the next day creates a new slot. Bob writing after Alice always creates a new slot regardless of date.

### 3.4 Changelog Format (`changelog.jsonl`)

One JSON object per line, append-only:

```jsonl
{"rev":1,"file":"shopping","type":"CREATE","ts":1716163200,"version":null,"prev_version":null}
{"rev":2,"file":"shopping","type":"UPDATE","ts":1716249600,"version":"2025-05-21:1:alice","prev_version":"2025-05-20:1:alice"}
{"rev":3,"file":"shopping","type":"DELETE","ts":1716330000,"version":null,"prev_version":"2025-05-21:1:alice"}
```

**Fields:** `rev` (monotonic integer), `file` (note id), `type` (CREATE/UPDATE/DELETE), `ts` (unix timestamp), `version` (version key written, null for CREATE/DELETE), `prev_version` (previous version key, null for first CREATE).

`rev` is determined by reading the last non-empty line backwards in 256-byte chunks — no full file load needed.

### 3.5 Note Content and Frontmatter

Content is a free-form string that by convention begins with YAML frontmatter:

```
---
title: My Note
path: work/meetings/standup
tags: [work, meetings]
created: 2025-05-20
---

Note body text here...
```

The server stores and returns this as a completely opaque string. The client parses frontmatter for display (title, path, tags) and tree building. The `store.js` module contains a `parseFrontmatter()` function for this purpose.

### 3.6 Folder Structure (S3-Style Naming)

Folders are a naming convention only — no actual subdirectories are created on
disk. The `/` separator in note paths (e.g. `work/meetings/standup`)
is encoded in the filename as `__` (double underscore). The client
reconstructs the tree from `path` in frontmatter by splitting on `/`.

---

## 4. Backend PHP

### 4.1 `config.php`

Defines all constants. Must be the first `require_once` in every other PHP file.

| Constant | Default | Description |
|---|---|---|
| `NOTES_DIR` | `__DIR__ . '/notes/'` | Note JSON files directory |
| `CHANGELOG_FILE` | `__DIR__ . '/changelog.jsonl'` | Append-only changelog |
| `HTPASSWD_FILE` | `__DIR__ . '/users.htpasswd'` | bcrypt user store |
| `REFRESH_TOKENS_FILE` | `__DIR__ . '/refresh_tokens.json'` | Active refresh tokens |
| `JWT_SECRET` | (must be changed) | HS256 signing key — generate with `php -r "echo bin2hex(random_bytes(32));"` |
| `JWT_EXPIRY` | `15 * 60` | Access token lifetime in seconds |
| `REFRESH_EXPIRY` | `30 * 24 * 3600` | Refresh token lifetime in seconds |

### 4.2 `storage.php`

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

### 4.3 `api.php`

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

### 4.4 `sync.php`

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

**Change types:** 1=CREATE, 2=UPDATE, 3=DELETE.

**Algorithm:**
1. Apply each incoming change using `storage_apply_write()` or `storage_delete_note()`
2. Read `changelog_since(syncedRevision)`
3. Deduplicate by note id — send only the latest state per note (not every intermediate change)
4. Convert each changelog entry to a Dexie change object
5. Return `{changes, currentRevision, partial: false}`

**Conflict strategy:** Last-write-wins. Server always accepts incoming changes. Competing writes produce separate version entries linked by `prev` — the chain is preserved for future 3-way merge UI. Content is never inspected.

### 4.5 `jwt.php`

HS256 JWT implementation using only PHP core functions (`hash_hmac`, `base64_encode`). No external library.

- `jwt_encode(payload, expiry)` — signs with `JWT_SECRET`, auto-sets `iat` and `exp`
- `jwt_decode(token)` — verifies signature with `hash_equals()` (constant-time), checks expiry, returns payload or false

### 4.6 `users.php`

Single exported function: `validate_user(string $username, string $password): string|false`

- Reads `HTPASSWD_FILE` line by line
- Skips comment lines (`#`)
- Only accepts bcrypt hashes (`$2y$` or `$2a$` prefix) — rejects MD5/SHA1 entries
- Uses `password_verify()` for verification
- Returns the username string on success, `false` on any failure

**Swappable:** Replacing the body of `validate_user()` is the only change needed to switch to database, LDAP, or OAuth.

### 4.7 `auth.php`

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

### 4.8 `auth_guard.php`

Single function: `require_auth(): string`

- Reads `Authorization: Bearer <token>` header
- Calls `jwt_decode()`
- Returns `$payload['sub']` (username) or exits with HTTP 401 + JSON error

Must be included **after** CORS headers and OPTIONS handling so preflight requests are not rejected.

### 4.9 `adduser.php`

CLI-only tool (`php_sapi_name() !== 'cli'` check, exits 403 via HTTP).

Commands:
- `add <username> <password>` — hashes with `PASSWORD_BCRYPT` cost 12, adds or overwrites entry
- `delete <username>` — removes entry
- `list` — prints all usernames
- `check <username> <password>` — calls `validate_user()`, exits 0/1

Usernames must not contain `:` (htpasswd delimiter), `/`, or `\`. Minimum password length: 8 characters.

---

## 5. Frontend JavaScript

All JS files are ES modules. No transpiler, no bundler. Loaded via `<script type="module">` in `index.html`. Dexie 3.x is loaded as a UMD global via `<script src="https://unpkg.com/dexie@3/dist/dexie.js">` before the module script.

### 5.1 `db.js` — Dexie Schema and IndexedDB Helpers

**Schema (version 1):**

```js
db.version(1).stores({
  notes: 'id, updated_at, deleted',
  queue: '++seq, status',
});
```

**`notes` table records:**
```js
{
  id:         string,   // note identifier
  content:    string,   // full raw text including frontmatter — opaque
  created_at: number,   // ms timestamp, set once on CREATE
  updated_at: number,   // ms timestamp, updated on every save
  deleted:    0 | 1,    // soft delete flag
}
```

**`queue` table records:**
```js
{
  seq:     number,   // auto-increment, determines push order
  type:    string,   // 'CREATE' | 'UPDATE' | 'DELETE'
  id:      string,   // note id
  content: string,   // note content at time of change (null for DELETE)
  status:  string,   // 'pending' | 'sent'
}
```

**Exported helpers:**

| Function | Description |
|---|---|
| `dbListNotes()` | All non-deleted notes sorted by id, metadata only |
| `dbGetNote(id)` | Full record or null if missing/deleted |
| `dbSaveNote(id, content)` | Create or update, preserves `created_at` |
| `dbDeleteNote(id)` | Sets `deleted=1` |
| `dbCreateNote(id)` | Creates empty record if not already existing |
| `dbApplyServerChange(type, id, content)` | Apply incoming server change — does NOT touch queue |
| `queueChange(type, id, content)` | Add to queue; collapses existing pending UPDATE for same id |
| `queueGetPending()` | All pending entries sorted by seq |
| `queueMarkSent(seq)` | Mark one entry sent |
| `queuePruneSent()` | Delete all sent entries |

### 5.2 `auth.js` — Token Management

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
| `tryRestoreSession()` | Called at boot — attempts `refreshToken()`, returns boolean |
| `onAuthFailure(fn)` | Subscribe to auth failure (token expired, logout). Returns unsubscribe fn |

### 5.3 `sync.js` — Offline Queue and Poll Loop

**Config:**
- `SYNC_URL = 'sync.php'`
- `POLL_INTERVAL = 30_000` ms
- `RETRY_DELAY = 10_000` ms
- `REVISION_KEY = 'notes_sync_revision'` (localStorage key, integer)

**State machine:** `OFFLINE ↔ IDLE → SYNCING → IDLE` (or `→ ERROR → IDLE` after retry delay)

**Wire format to `sync.php`:** Same as described in §4.4. All requests go through `authFetch()`.

**`push()`:**
1. Read pending queue entries
2. Convert to `{type: 1|2|3, key, obj}` format
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
| `onSyncStatus(fn)` | Subscribe to status changes. Returns unsubscribe fn |
| `getSyncStatus()` | Current status string |
| `onRemoteChange(fn)` | Subscribe to incoming server changes. Returns unsubscribe fn |

### 5.4 `api.js` — Data Access Layer

All reads/writes go to IndexedDB. Server is never called directly. Function signatures intentionally match a server-fetch API so callers need no changes if the implementation changes.

| Function | IndexedDB op | Queue op |
|---|---|---|
| `listNotes()` | `dbListNotes()` | none |
| `loadNote(id)` | `dbGetNote(id)` | none |
| `saveNote(id, content)` | `dbSaveNote()` | `queueChange('UPDATE', ...)` |
| `createNote(id)` | `dbCreateNote()` | `queueChange('CREATE', ...)` |
| `deleteNote(id)` | `dbDeleteNote()` | `queueChange('DELETE', ...)` |

### 5.5 `store.js` — Reactive State

Simple event emitter pattern — no framework. `on(event, fn)` returns an unsubscribe function.

**State shape:**
```js
{
  notes:    [],      // [{id, created_at, updated_at}] from server/IndexedDB
  filtered: [],      // after search filter (matches note id only)
  current:  null,    // currently open note id
  content:  '',      // full raw textarea content (includes frontmatter)
  dirty:    false,   // unsaved changes flag
  query:    '',      // search string
  online:   bool,    // from navigator.onLine / sync status
}
```

**Events emitted:** `notes-changed`, `count-changed`, `note-opened`, `dirty-changed`, `note-closed`, `online-changed`

**`parseFrontmatter(raw)`:** Exported utility. Parses YAML-lite frontmatter between `---` delimiters. Returns `{meta: {title, path, tags, created, ...}, body: string}`. Handles inline arrays (`[one, two]`). Returns `{meta: {}, body: raw}` if no frontmatter block present.

**Search:** Matches against note `id` (filename) only — not title, tags, or content.

### 5.6 `ui.js` — DOM Layer

All DOM manipulation isolated here. No business logic. No imports from `api.js` or `store.js`. Callbacks injected via `bindEvents()`.

**Exported functions:**

| Function | Description |
|---|---|
| `renderFileList(notes, currentId)` | Render sidebar list from `[{id, ...}]` objects |
| `setActiveFile(id)` | Toggle `.active` class on file items |
| `updateNoteCount(total, shown)` | Update footer count |
| `showEditor(id, content)` | Show textarea, hide empty state, populate content |
| `hideEditor()` | Show empty state, hide textarea |
| `getEditorContent()` | Current textarea value |
| `setDirty(val)` | Toggle dirty dot, disable/enable save button |
| `setStatus(msg, ttl)` | Status bar message with optional auto-clear |
| `setOffline(offline)` | Toggle offline badge |
| `setSyncStatus(text)` | Update sync status indicator (cleared when 'ONLINE') |
| `setSidebarLoading(loading)` | Show/hide first-visit sync spinner |
| `toast(msg, isErr)` | Append a self-removing toast (3.5s) |
| `openModal()` | Show new-note modal, focus input |
| `closeModal()` | Hide modal |
| `setModalError(msg)` / `setModalHint(msg)` | Modal feedback |
| `getModalValue()` | Trimmed modal input value |
| `showLoginScreen()` | Show login, hide app shell, clear fields |
| `showAppShell(username)` | Hide login, show app shell, set username display |
| `setLoginError(msg)` | Login form error message |
| `setLoginLoading(loading)` | Login button loading state |
| `bindEvents(callbacks)` | Wire all DOM events once |

**`bindEvents` callbacks:** `onOpen(id)`, `onDelete(id)`, `onSearch(q)`, `onSave()`, `onNew()`, `onCreate()`, `onCancelModal()`, `onLogin(username, password)`, `onLogout()`

**File list event delegation:** Single click listener on `#file-list`. Distinguishes `.file-item-del` (delete) from `.file-item` (open) via `closest()`.

**Note editor input:** Fires a `CustomEvent('note-changed', {bubbles: true})` — app.js listens for this to call `store.updateContent()`.

### 5.7 `app.js` — Entry Point

**Import order:**
1. `api.js`, `store.js`, `ui.js`
2. `db.js` (for `db.notes.count()` on first visit check)
3. `sync.js` (`syncStart`, `syncNow`, `stopSync`, `onSyncStatus`, `onRemoteChange`)
4. `auth.js` (`login`, `logout`, `getUsername`, `tryRestoreSession`, `onAuthFailure`)

**Boot sequence:**
1. `ui.setOffline(!navigator.onLine)`
2. `tryRestoreSession()` — silent refresh via cookie
3a. Success → `showApp()`
3b. Failure → `showLogin()`

**`showApp()` sequence:**
1. `ui.showAppShell(getUsername())`
2. `db.notes.count()` — if 0 and online: `ui.setSidebarLoading(true)` (first visit indicator)
3. `refreshList()` — render what's in IndexedDB immediately
4. `syncStart()` — begin poll loop

**`showLogin()` sequence:**
1. `stopSync()`
2. `store.closeNote()`
3. `ui.hideEditor()`
4. `ui.showLoginScreen()`

**Sync status wiring:**
- `IDLE` / `ERROR` / `OFFLINE` → `ui.setSidebarLoading(false)`
- `SYNCING` → `ui.setStatus('Syncing…', 2000)`
- `ERROR` → `ui.toast('Sync error — will retry shortly', true)`

**`onRemoteChange`:** `ui.setSidebarLoading(false)` + `refreshList()`

**`onAuthFailure`:** `showLogin()`

**`syncNow()`** called after: `saveFile()`, `deleteFile()`, `createFile()`

**Keyboard shortcuts:** `Ctrl/Cmd+S` → save. `Escape` → close modal.

**Unload guard:** `beforeunload` warns if `dirty` and editor is visible.

**PWA shortcut:** `?action=new` in URL → `ui.openModal()` on load.

---

## 6. Frontend HTML and CSS

### 6.1 `index.html` Structure

```
<body>
  #login-screen          ← shown by default (display:flex)
    #login-card
      #login-brand
      #login-heading
      #login-form
        #login-username
        #login-password
        #login-error
        #login-btn

  #app                   ← hidden by default (display:none)
    #header
      #header-brand (.logo, h1)
      #header-center (#current-file, #dirty-dot)
      #header-actions (#username-display, #btn-save, #btn-logout)

    #main
      #sidebar
        #sidebar-toolbar (#search-wrap>#search, #btn-new)
        #file-list
        #sidebar-loading (.sidebar-spinner, span)
        #sidebar-footer (#note-count)

      #editor-wrap
        #empty-state (.empty-icon, p, small>kbd)
        #note-area (textarea)

    #statusbar
      #status-msg
      #offline-badge
      #sync-status
      #line-count
      #char-count

  #modal-overlay
    #modal
      #modal-title
      .modal-field>label+input#modal-input
      #modal-hint
      #modal-actions (#modal-cancel, #modal-create)

  #toast-container

  <script src="dexie@3">   ← UMD global, before ES module
  <script type="module" src="js/app.js">
```

**Notes:**
- Login screen is `display:flex`, app shell is `display:none` — JS swaps them after auth
- Dexie script tag must precede the module tag (UMD global required by `db.js`)

### 6.2 CSS Design Tokens

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

### 6.3 Notable CSS Behaviours

- **Active note:** `background: var(--accent-glow)`, `border: 1px solid rgba(212,196,160,.22)`, `color: var(--accent)`
- **Delete button:** Hidden (`opacity:0`) by default, shown (`opacity:1`) on `.file-item:hover`
- **Dirty dot:** 7px circle, `opacity:0` → `opacity:1` via `.visible` class, transition 0.15s
- **Textarea max-width:** 800px, `align-self: center` — comfortable reading width
- **Caret:** `caret-color: var(--accent)`
- **First-visit spinner:** `border-top-color: var(--accent)`, 20px, 0.7s linear infinite, hidden by default

---

## 7. PWA

### 7.1 `manifest.json`

```json
{
  "name": "Notes",
  "short_name": "Notes",
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

### 7.2 `sw.js`

**Base path derivation:**
```js
const BASE = self.location.pathname.replace(/\/sw\.js$/, '');
```
All shell paths are prefixed with `BASE` — never absolute `/` paths. This makes the service worker subdirectory-safe.

**Cache name:** `notes-v4` (increment on any shell change to force update)

**Precache (install):** All shell files with `${BASE}/` prefix, plus `https://unpkg.com/dexie@3/dist/dexie.js`

**Fetch strategy:**
- `api.php`, `sync.php`, `auth.php` → **network only**, never cached. Offline fallback returns `{error: 'Offline', changes: [], currentRevision: null}`
- Everything else → **cache first**, update cache in background

**Update notification:** On `updatefound` + `statechange` → `ui.toast('Update available — refresh to apply.')`

---

## 8. Authentication Flow

### 8.1 First Visit / Login

```
User enters credentials
  → POST auth.php?action=login {username, password}
  → Server: validate_user() → bcrypt verify
  → Server: issue JWT (15min) + refresh token cookie (30 days, httpOnly+SameSite=Strict)
  → Client: store JWT in memory, store username
  → showApp()
```

### 8.2 Return Visit (Silent Restore)

```
boot()
  → tryRestoreSession()
  → POST auth.php?action=refresh (cookie sent automatically)
  → Server: validate refresh token, rotate token, issue new JWT
  → Client: store new JWT
  → showApp()
```

### 8.3 Token Expiry During Session

```
authFetch() makes request
  → 401 received
  → refreshToken() called (deduplicates concurrent calls)
  → POST auth.php?action=refresh
  → On success: retry original request with new token
  → On failure: notifyAuthFailure() → showLogin()
```

### 8.4 Logout

```
handleLogout()
  → logout() → POST auth.php?action=logout
  → Server: delete refresh token, clear cookie
  → Client: clearToken() → notifyAuthFailure() → showLogin()
  → stopSync()
```

---

## 9. Sync Protocol

### 9.1 Client Queue Model

Every mutating operation writes to IndexedDB first (offline-safe), then adds to the `queue` table:

- `saveNote()` → `dbSaveNote()` + `queueChange('UPDATE', ...)`
- `createNote()` → `dbCreateNote()` + `queueChange('CREATE', ...)`
- `deleteNote()` → `dbDeleteNote()` + `queueChange('DELETE', ...)`

Queue collapse: `queueChange()` for UPDATE/CREATE deletes any existing pending entry for the same note before inserting, preventing redundant pushes of intermediate states.

### 9.2 Sync Tick Sequence

```
tick()
  1. push() — send pending queue to sync.php
  2. pull() — fetch changes since last revision
  3. queuePruneSent() — clean up sent entries
```

### 9.3 First Visit Loading State

On `showApp()`:
1. `db.notes.count()` — if 0 AND online: show `#sidebar-loading` spinner
2. Spinner hidden when sync status transitions to IDLE/ERROR/OFFLINE
3. Spinner hidden immediately when `onRemoteChange` fires (notes arrived)

### 9.4 Revision Tracking

- Stored in `localStorage` as `notes_sync_revision` (integer)
- Set to `currentRevision` from every server response
- Sent as both `baseRevision` and `syncedRevision` in every request
- `null` on first sync (server interprets as "send everything")

---

## 10. Security

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

## 11. Known Limitations and Future Work

| Item | Status |
|---|---|
| Folder tree UI in sidebar | Schema supports it (S3-style naming), UI renders flat list only |
| Markdown preview | Not implemented — editor is plaintext only |
| History panel | Version chain exists server-side, no UI to browse it |
| Conflict resolution UI | Conflicts resolved last-write-wins; old versions preserved for future 3-way merge |
| Soft-delete purge | Tombstones accumulate forever; no purge endpoint |
| E2EE | Architecture designed for it (opaque content); not implemented |
| MySQL migration | Storage abstraction layer in place; target schema documented |
| Note rename | No endpoint or UI — delete and recreate |
| Multi-user note isolation | All users share one note set (collaborative by design) |
| Background sync | Service worker sync hook stubbed but not wired |
| Per-user revision tracking | Single `notes_sync_revision` in localStorage — multi-account on same browser would conflict |
