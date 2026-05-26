# Version History — Implementation Plan

## Overview

Add a version history modal accessible from the Meta tab's system info section.
The server stores a full version chain per note (prev-linked, keyed by
`date:counter:author`).  There is currently no way to browse it.  This feature
exposes the chain via a new endpoint and a modal UI with diff preview.

## Lazy loading

The entire history feature is loaded on demand — no code is loaded until the
user clicks "View History".

**Build change** — esbuild must use `--format=esm --splitting` to produce
separate chunks for dynamic `import()`:

```
# Before (single bundle)
esbuild ts/app.ts --bundle --outfile=../spa/app.js

# After (code-split ESM)
esbuild ts/app.ts --bundle --format=esm --splitting --outdir=../spa/
```

**`index.html`** script tag changes from `<script src="app.js">` to
`<script type="module" src="app.js">`.  The main bundle (`app.js`) still
loads eagerly; `history.js` (and its chunk) only loads when the user opens
the modal.

**HTML for the modal** is built entirely in JS — no changes to `index.html`.

---

## 1. Server — schema change: author stored explicitly

Currently the author exists only inside the version key (`date:counter:author`).
If we later switch to UUID-based keys, author data would be lost.  Add `author`
as a first-class field on every version entry.

### New version entry schema

```json
"versions": {
  "2026-05-25:1:alice": {
    "author":    "alice",
    "saved_at":  1748200000,
    "content":   "...",
    "prev":      "2026-05-24:1:alice",
    "exclusive": true
  }
}
```

### Code change

**File:** `src/php/storage.php` — `storage_apply_write()`

Add one line to the version entry:

```php
$note['versions'][$vkey] = [
    'author'    => $author,   // ← new
    'saved_at'  => time(),
    'content'   => $content,
    'prev'      => $prev_vkey,
    'exclusive' => true,
];
```

No backward compatibility needed — the app is not deployed yet.  All version
entries will carry `author` from this point forward.  The version key format
is now an opaque identifier free to evolve (UUIDs, hashes, etc.).

---

## 2. Client — surface author from server to Meta panel

Currently the Meta panel reads `created_by` and `updated_by` from the note's
**frontmatter** — user-editable text inside the note body.  This is unreliable:
anyone can edit or delete those fields, and they don't reflect who actually
wrote to the server.  The ground truth lives in the server's version chain.

After the schema change (section 1), every version entry carries `author`.
This makes it possible to get authoritative authorship from the server and
display it in the Meta panel instead of the frontmatter fields.

### 2a. Extend `NoteRecord` in IndexedDB

**File:** `src/ts/db.ts`

Add two fields to the `NoteRecord` interface and the Dexie schema:

```ts
export interface NoteRecord {
  id: string;
  content: string;
  created_at: number;
  updated_at: number;
  deleted: 0 | 1;
  current: string;
  updated_by: string;   // ← new
  created_by: string;   // ← new
}
```

Update `dbSaveNote()` to set these for local writes:

```ts
export async function dbSaveNote(id: string, content: string): Promise<void> {
  // ...
  await db.notes.put({
    id, content,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted: 0,
    current: existing?.current ?? 'local',
    updated_by: getUsername() ?? 'unknown',    // ← new
    created_by: existing?.created_by ?? getUsername() ?? 'unknown', // ← new
  });
}
```

Update `dbCreateNote()` likewise:

```ts
export async function dbCreateNote(id: string): Promise<void> {
  // ...
  await db.notes.put({
    id, content: '', created_at: now, updated_at: now, deleted: 0,
    current: 'local',
    created_by: getUsername() ?? 'unknown',   // ← new
    updated_by: getUsername() ?? 'unknown',   // ← new
  });
}
```

Note: `db.ts` will import `getUsername` from `auth.ts`.  If this creates a
circular dependency, pass `created_by`/`updated_by` as extra parameters from
`notes.ts` instead (which already imports `getUsername`).

Update `dbApplyServerChange()` to accept and store the new field:

```ts
async function dbApplyServerChange(
  type: 'CREATE' | 'UPDATE' | 'DELETE' | 'RENAME',
  id: string,
  content: string | null,
  version?: string | null,
  _prevVersion?: string | null,
  author?: string | null,        // ← new
): Promise<void> {
  // ...
  // CREATE or UPDATE — add to the .put() call:
  await db.notes.put({
    id, content: content ?? '',
    created_at: existing?.created_at ?? Date.now(),
    updated_at: Date.now(),
    deleted: 0,
    current: version ?? existing?.current ?? 'local',
    updated_by: author ?? existing?.updated_by ?? '',   // ← new
    created_by: (type === 'CREATE')
      ? (author ?? existing?.created_by ?? '')           // ← new
      : (existing?.created_by ?? ''),
  });
}
```

### 2b. Include `author` in sync protocol response

**File:** `src/php/sync.php` — `changelog_entry_to_dexie_change()`

Add `author` to the `obj` for CREATE and UPDATE:

```php
// After the schema change, every version entry has 'author'.
// Surface it so the client can store it as updated_by / created_by.
$author = ($current && isset($note['versions'][$current]))
    ? ($note['versions'][$current]['author'] ?? '')
    : '';

return [
    'type' => $dexie_type,
    'key'  => $key,
    'obj'  => [
        'id'           => $key,
        'content'      => $content,
        'version'      => $version,
        'prev_version' => $prev_version,
        'author'       => $author,   // ← new
    ],
];
```

**File:** `src/ts/sync.ts` — update `SyncResponseBody` type to include `author`.

### 2c. Update `NoteData` and `loadNote()`

**File:** `src/ts/notes.ts`

Add the fields to `NoteData`:

```ts
export interface NoteData {
  id: string;
  content: string;
  created_at: number;
  updated_at: number;
  current: string;
  created_by: string;   // ← new
  updated_by: string;   // ← new
  meta: FrontmatterResult['meta'];
}
```

Expose them in `loadNote()` from the `NoteRecord`:

```ts
export async function loadNote(id: string): Promise<NoteData> {
  const note = await dbGetNote(id);
  // ...
  return {
    id, content,
    created_at: note?.created_at ?? 0,
    updated_at: note?.updated_at ?? 0,
    current: note?.current ?? '',
    created_by: note?.created_by ?? '',   // ← new
    updated_by: note?.updated_by ?? '',   // ← new
    meta: fm.meta,
  };
}
```

### 2d. Stop writing authorship to frontmatter

**File:** `src/ts/notes.ts`

Remove the frontmatter writes from `saveNote()` and `createNote()`:

```ts
// saveNote() — remove:
//   updateFrontmatter(content, { updated_by: getUsername() ?? 'unknown' });
// Just save content as-is. Authorship is now in NoteRecord.

// createNote() — remove:
//   updateFrontmatter('', { created_by: ..., updated_by: ... });
// Authorship goes into dbSaveNote / dbCreateNote instead.
```

The frontmatter `created_by` and `updated_by` fields remain valid for users
who want to manually set them (like "company", "category", "status") — they
just stop being the system labels shown in the Meta panel.

### 2e. Update Meta panel

**File:** `src/ts/meta-panel.ts` — `populateSystemFields()`

Read from `NoteData` fields instead of frontmatter:

```ts
export function populateSystemFields(noteData: NoteData): void {
  if (_sysCurrent)   _sysCurrent.textContent   = noteData.current ?? '';
  if (_sysCreated)   _sysCreated.textContent   = formatTimestamp(noteData.created_at);
  if (_sysUpdated)   _sysUpdated.textContent   = formatTimestamp(noteData.updated_at);
  if (_sysCreatedBy) _sysCreatedBy.textContent = noteData.created_by;   // ← was: getMetaField(noteData.meta, 'created_by')
  if (_sysUpdatedBy) _sysUpdatedBy.textContent = noteData.updated_by;   // ← was: getMetaField(noteData.meta, 'updated_by')
}
```

---

## 3. Server — new endpoint: `api/history`

**File:** `src/php/history.php` (new)

Auth required (same JWT guard as sync/trash).

### `action=list`

Return version metadata for a note (no content).  The `author` field comes
from the version entry data, not parsed from the key.

```
POST /api/history
Body:   { "action": "list", "id": "note-id" }

Response:
{
  "ok": true,
  "current": "2026-05-25:1:alice",
  "versions": [
    {
      "key":      "2026-05-25:1:alice",
      "author":   "alice",
      "saved_at": 1748200000,
      "prev":     "2026-05-24:1:alice"
    },
    {
      "key":      "2026-05-24:1:alice",
      "author":   "alice",
      "saved_at": 1748113600,
      "prev":     null
    }
  ]
}
```

- Sorted by `saved_at` descending (most recent first).
- `current` identifies which version is the live one.

Server logic:
- `storage_get_note($id)` → read the `versions` dict
- Extract metadata from each version entry (key, author, saved_at, prev)
- Sort and return

### `action=get`

Fetch opaque content for one or more versions (for diffing).

```
POST /api/history
Body:   { "action": "get", "id": "note-id", "versions": ["key1", "key2"] }

Response:
{
  "ok": true,
  "contents": {
    "key1": "# Note content at version key1...",
    "key2": "# Note content at version key2..."
  }
}
```

- Client fetches both sides of a diff in a single round-trip.
- Returns `null` for unknown version keys.
- Content is opaque — returned as-is.

### Router update

**File:** `src/php/router.php`

Add one case:
```php
case 'history':
    require $sharedDir . 'history.php';
    break;
```

---

## 4. Client — new module: `src/ts/history.ts`

Not imported directly by `app.ts`.  Lazy-loaded via dynamic `import()` when
the user clicks "View History".

### API layer

```ts
interface VersionMeta {
  key: string;
  author: string;
  saved_at: number;
  prev: string | null;
}

interface VersionListResponse {
  ok: true;
  current: string;
  versions: VersionMeta[];
}

// Fetch version list (metadata only)
function fetchVersionList(id: string): Promise<VersionListResponse>;

// Fetch content for specific versions (both sides of diff, single request)
function fetchVersionContent(
  id: string,
  versions: string[]
): Promise<Record<string, string | null>>;
```

Uses `authFetch` + `apiUrl('history')` (same pattern as sync/trash).

### Diff utility

A pure function — no DOM, no dependencies:

```ts
interface DiffLine {
  type: '+' | '-' | ' ';
  text: string;
}

function computeDiff(a: string, b: string): DiffLine[];
```

Simple line-based Myers or patience diff.  Both versions are client-side
plaintext, so diffing works regardless of E2EE (content is decrypted before
this point).

### DOM builder — `renderModal()`

Programmatically builds the entire modal DOM and appends to `<body>`.
Returns:

```ts
interface HistoryModal {
  el: HTMLElement;    // the modal overlay (already in DOM)
  close: () => void;  // remove from DOM, clean up listeners
}
```

### Public entry point

```ts
interface HistoryCallbacks {
  onRestore: (content: string) => void;
}

export function open(noteId: string, callbacks: HistoryCallbacks): void;
```

Called from `app.ts`:

```ts
const { open } = await import('./history.js');
open(noteId, {
  onRestore: (content: string) => {
    rawPanel.setRawContent(content);
    store.updateContent(content);
    store.markDirty();
  },
});
```

### Modal layout (built dynamically in JS)

```
┌──────────────────────────────────────────────────────────┐
│  Version History — <noteId>                         [×]  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   2026-05-25 15:22   alice                         CURRENT│
│                                                          │
│  ● 2026-05-24 10:07   bob                         [view] │  ← selected
│  ├─ prev ────────────────────────────────────────────── │
│  │                                                       │
│  ○ 2026-05-24 08:45   alice                      [view]  │
│  │                                                       │
│  ○ 2026-05-23 19:30   bob                        [view]  │
│  │                                                       │
│  ○ 2026-05-21 11:00   alice                      [view]  │
│                                                          │
│  ── diff:  ●  vs  [ 2026-05-25 15:22 alice ▾ ]  [↗] ───│
│                                                        ▲ │
│  │ -Old status: docked                                 █ │
│  │ +Under repair                                       █ │
│  │                                                     █ │
│  │  Next maintenance: Friday                           █ │
│  │ +New crew: Torres                                   █ │
│  │                                                     ▼ │
│  ────────────────────────────────────────────────────────│
│                                                          │
│                       [Close]    [Restore this version]   │
└──────────────────────────────────────────────────────────┘
```

### Interaction summary

| Element | Behavior |
|---------|----------|
| Click a version row | Selects it (●), fetches content if not cached, renders diff vs dropdown target. Default diff target = CURRENT. |
| Dropdown in diff header | Choose comparison target. All versions listed. Selected version greyed out. Changing it re-renders diff from cached content (no re-fetch). |
| `[view]` per row | Opens raw content in new tab via `data:text/plain;charset=utf-8,...` |
| `[↗]` pop-out | Opens current diff as self-contained HTML page in new tab (`data:text/html,...`) |
| `[Restore this version]` (bottom) | Copies selected version's content into editor, triggers `onRestore` callback. CURRENT row: button disabled/hidden. |
| `[×]` / `[Close]` / Escape / click-outside | Closes modal, discards all fetched content and DOM. |
| `├─ prev ─` connector | Rendered between two consecutive versions where the later one's `prev` does NOT point to the chronologically previous entry — i.e. a visible branch/conflict. |

### States

- **Loading:** Spinner in modal body while `fetchVersionList` is in flight.
- **Empty:** "No version history" — shouldn't occur (every note has ≥1 version), but handled gracefully.
- **Error:** Inline error message with retry button.

### Content caching

Fetched version contents are cached in a `Map<string, string>` scoped to the
modal session.  Switching dropdown targets or clicking different rows uses
cached data when available.

---

## 5. Client — wiring in `app.ts` and `meta-panel.ts`

### `src/ts/meta-panel.ts`

Add a "View History" button in the system info section:

```html
<tr><td>Version</td><td id="meta-sys-current">2026-05-25:1:alice</td></tr>
<tr><td></td><td><button id="btn-view-history" class="btn-small">View History…</button></td></tr>
```

### `src/ts/app.ts`

Wire the button click to lazy-load and open:

```ts
document.getElementById('btn-view-history')?.addEventListener('click', async () => {
  const currentId = store.getCurrent();
  if (!currentId) return;
  const { open } = await import('./history.js');
  open(currentId, {
    onRestore: (content: string) => {
      rawPanel.setRawContent(content);
      store.updateContent(content);
      store.markDirty();
    },
  });
});
```

### `src/ts/ui.ts`

Ensure `setRawContent(content: string)` is exposed publicly (delegates to
`rawPanel.setRawContent`).  May already exist — check during implementation.

---

## 6. CSS

Minimal additions to `spa/css/app.css`.  The history modal reuses the existing
modal overlay pattern but with a wider card (680px).  New classes:

| Class | Purpose |
|-------|---------|
| `.history-modal` | Wider modal card (680px, max-height 80vh, scroll) |
| `.history-version-row` | Version list row with hover/selected states |
| `.history-version-row.selected` | Selected version highlight (accent glow) |
| `.history-version-row.current` | CURRENT label styling (muted) |
| `.history-branch-connector` | `├─ prev ─` connector between branched versions |
| `.history-diff-header` | Diff header bar with dropdown and pop-out button |
| `.history-diff-preview` | Scrollable diff output (mono, pre-wrap, max-height 240px) |
| `.history-diff-add` | Green text for added lines |
| `.history-diff-remove` | Red text for removed lines |
| `.history-diff-context` | Muted text for unchanged lines |

---

## 7. Pre-refactor: split `ui.ts`

Before adding history support, extract two self-contained concerns from
`ui.ts` (~655 lines → ~485 lines after split).

### New module: `src/ts/modal.ts`

The create/rename modal logic (~70 lines):

```ts
// Exports:
export function openModal(currentNoteId: string | null, searchValue: string): void;
export function openRenameModal(id: string): void;
export function closeModal(): void;
export function setModalError(msg: string): void;
export function setModalHint(msg: string): void;
export function getModalValue(): string;
export function bindModalEvents(handlers: {
  onCreate: () => void;
  onCancel: () => void;
  onRenameConfirm: (oldId: string) => void;
}): void;
```

Removes `_renameId` module state from `ui.ts`.  `modal.ts` owns its own DOM
refs for the overlay, title, input, hint, and action buttons.

### New module: `src/ts/login-screen.ts`

The login screen logic (~100 lines):

```ts
// Exports:
export function showLoginScreen(): void;
export function showAppShell(username: string | null): void;
export function hideLoginScreen(): void;
export function setLoginError(msg: string): void;
export function setLoginLoading(loading: boolean): void;
export function showOfflineFirstVisit(): void;
export function bindLoginEvents(handlers: {
  onLogin: (u: string, p: string) => void;
  onSignIn: () => void;
  onLogout: () => void;
  onDismissLogin: () => void;
}): void;
```

Removes login DOM refs and logic from `ui.ts`.

### Remaining in `ui.ts`

Editor lifecycle (show/hide/flush), tab switching, sidebar rendering, status
bar, toasts, sidebar toggle, event wiring dispatch, and the `initPanels()`
entry point.  These are the cross-cutting concerns that coordinate the
remaining modules.

### `app.ts` changes

Replace `ui.bindEvents(...)` with:
```ts
modal.bindModalEvents({ onCreate, onCancel, onRenameConfirm });
loginScreen.bindLoginEvents({ onLogin, onSignIn, onLogout, onDismissLogin });
ui.bindEditorEvents({ onOpen, onDelete, onSearch, onSave, onNew, ... });
```

---

## 8. Implementation order

| Step | File(s) | Description |
|------|---------|-------------|
| R1 | `src/ts/modal.ts` | Extract create/rename modal from `ui.ts` (~70 lines out) |
| R2 | `src/ts/login-screen.ts` | Extract login screen from `ui.ts` (~100 lines out) |
| R3 | `src/ts/ui.ts` | Remove extracted code; delegate event wiring to new modules |
| R4 | `src/ts/app.ts` | Update imports and event binding for split modules |
| 1  | `src/php/storage.php` | Add `author` field to version entries in `storage_apply_write()` |
| 2  | `src/php/sync.php` | Include `author` in sync response obj for CREATE/UPDATE |
| 3  | `src/ts/db.ts` | Add `updated_by`/`created_by` to `NoteRecord`, store in local writes and `dbApplyServerChange` |
| 4  | `src/ts/sync.ts` | Update `SyncResponseBody` type + pass `author` from `applyServerChanges` to `dbApplyServerChange` |
| 5  | `src/ts/notes.ts` | Add `created_by`/`updated_by` to `NoteData`; remove frontmatter authorship writes |
| 6  | `src/ts/meta-panel.ts` | Read `created_by`/`updated_by` from `NoteData` instead of frontmatter |
| 7  | `src/php/history.php` | New server endpoint (`list` + `get` actions) |
| 8  | `src/php/router.php` | Add `history` route (1 line) |
| 9  | `src/ts/history.ts` | New module: API calls, diff util, modal renderer, public `open()` |
| 10 | `spa/index.html`, `src/ts/meta-panel.ts` | Add "View History" button row in system info table |
| 11 | `src/ts/ui.ts` | Ensure `setRawContent()` is publicly exposed |
| 12 | `src/ts/app.ts` | Wire button → dynamic import → `open()` with `onRestore` callback |
| 13 | `spa/css/app.css` | History modal and diff styles |
| 14 | `Makefile` | Update `build-spa` for `--format=esm --splitting --outdir=../spa/` |
| 15 | `spa/index.html` | Change `<script>` to `<script type="module">` |

---

## Open questions

- **Trash integration (future):** Deferred — does not block this feature.
  The modal's contract (`open(noteId, { onRestore })`) is generic: `onRestore`
  copies content to the editor today, and a future trash panel would call the
  trash restore API instead.  The only server-side adjustment needed later is
  a flag on `action=list`/`action=get` to read from the tombstone file rather
  than the live note (`storage_get_note()` returns `null` for deleted notes).
  No design decisions needed now.

- **esbuild `--splitting`:** To be resolved during implementation.
  Try `--format=esm --splitting --outdir=../spa/` with `type="module"`.
  If the SW cache or chunk loading causes issues, fall back to bundling
  `history.ts` eagerly — it's small (~10–15 KB) and the lazy-loading benefit
  is marginal for a feature this size.

No other open questions remain.
