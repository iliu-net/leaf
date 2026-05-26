# Trash UI — Implementation Plan

## Overview

Trash is a **sidebar mode toggle** — the same `#file-list` area in the sidebar
shows either live notes or deleted notes. A button with a count badge switches
between them.

Tombstones exist in two places:
- **Local IndexedDB**: notes with `deleted: 1`, purged after 7 days
- **Server** (`/api/trash`): `.deleted.json` files, purged after 30 days (API fully built)

The UI merges both sources. Offline restore is instant. Online restore needs
a round-trip to the server.

```
┌─ Sidebar ──────────────────────────────┐
│ [🔍 Filter…]   [+ New]   [🗑 3]       │  ← toolbar (notes mode)
│                                         │
│  ▶ documents/                           │
│    📄 note-a                      ⋯    │
│    📄 note-b                      ⋯    │
│                                         │
│ ─────────── or ───────────────          │
│                                         │
│  ← Notes    Trash                       │  ← toolbar (trash mode)
│                                         │
│  🗑 old-note                    ⋯      │  ⋯ = Restore / Delete forever
│    deleted 2 days ago                   │
│  🗑 server-note  (↑)            ⋯      │  ↑ needs network
│    alice, 5 days ago                    │
│                                         │
├─────────────────────────────────────────┤
│ 3 items                    [Empty]     │  ← footer (trash mode)
└─────────────────────────────────────────┘

┌─ Editor (trash preview) ───────────────┐
│ ⚠ This note is in the trash.           │
│   [Restore]  [Delete forever]          │
│ ─────────────────────────────────────── │
│                                         │
│   (read-only content of deleted note)   │
│                                         │
└─────────────────────────────────────────┘
```

---

## Architecture

```
  app.ts ── thin wiring only
    │
    ├── trash-service.ts   orchestrates: merge lists, restore, purge, empty
    │     ├── db.ts         local IndexedDB operations
    │     └── /api/trash    server API calls (authFetch)
    │
    ├── trash-view.ts      renders trash list in #file-list
    │     implements SidebarView interface
    │     └── context-menu.ts   shared dropdown (extracted from tree.ts
    │                           — see context-menu-plan.md)
    │
    └── editor area        click a trash row → read-only preview
          with restore / delete banner
```

`trash-view.ts` owns all DOM for the trash list. `trash-service.ts` owns all logic.
`app.ts` just wires button clicks to service calls and swaps the sidebar mode.

`context-menu.ts` is already extracted from `tree.ts` as a prerequisite
(see `context-menu-plan.md`). It provides `show(anchorEl, items)` / `close()`
and both tree and trash pass their own `{ label, action }` arrays.

**Prerequisite:** `context-menu-plan.md` must be completed before this plan.

---

## New files

### `trash-view.ts` (~140 lines)

Implements `SidebarView<TrashEntry>` — the generic interface lets `render()`
accept `TrashEntry[]` without a type mismatch.

```
Rendering:
  render(entries: TrashEntry[], currentId: string | null) → fills #file-list
    - Flat list (no tree — tombstones aren't hierarchical)
    - Each row: trash icon, id (monospace), relative time, optional author
    - Server-only items get a subtle (↑) indicator
    - Each row has a ⋯ button (same pattern as notes browser)
      → opens context-menu.ts with [Restore] and [Delete forever]
    - Empty state: "Trash is empty" with muted styling

  handleClick(e, handlers) → delegates to buttons
    - Source normalization: 'both' → 'server' for onTrashRestore and onTrashPreview
      (the restore service treats 'both' as a server-path restore — safer,
      since the server has the authoritative tombstone)
    - .file-item-more → contextMenu.show(anchor, [
        { label: 'Restore',        action: () => handlers.onTrashRestore(id, src) },
        { label: 'Delete forever', action: () => handlers.onTrashPurge(id, src) },
      ])
    - Click on the row itself → handlers.onTrashPreview(id, src)
      (shows read-only preview of the deleted note in the editor area)

  updateNoteCount(total, shown)
    - Updates count in footer

  destroy()
    - contextMenu.close() (belt-and-suspenders — menu should already be closed)

TrashEntry type:
  {
    id: string
    deleted_at: number        // unix ms
    source: 'local' | 'server' | 'both'
    updated_by?: string       // who deleted it
  }

Event handlers interface:
  {
    onTrashPreview: (id: string, source: 'local' | 'server') => void
    // Restore normalizes 'both' → 'server' (see trash-service.ts § Source resolution)
    onTrashRestore: (id: string, source: 'local' | 'server') => void
    onTrashPurge:   (id: string, source: 'local' | 'server' | 'both') => void
    onTrashEmpty:   () => void
  }
```

---

### `trash-service.ts` (~200 lines)

All business logic. `app.ts` calls these functions directly — no UI code.

```
Types:
  LocalTrashEntry  = { id, deleted_at: number, updated_by: string }
  ServerTrashEntry = { id, deleted_at: number | null }
  TrashEntry       = { id, deleted_at, source: 'local'|'server'|'both',
                        updated_by?: string }

Exports:

  // ── Merge ────────────────────────────────────
  mergeTrashEntries(local: LocalTrashEntry[],
                    server: ServerTrashEntry[]): TrashEntry[]
    - Deduplicates by id
    - Uses the more recent deleted_at when both sources have a record
    - Sets source to 'local', 'server', or 'both'
    - Sorts newest-first by deleted_at

  // ── Load ─────────────────────────────────────
  async loadTrashEntries(): Promise<TrashEntry[]>
    - Calls dbListDeletedNotes() (always)
    - If navigator.onLine, calls fetchTrashList() from server
    - Filters server results: excludes IDs that were permanently deleted
      while offline (tracked in localStorage — see "Pending purge tracking" below)
    - Merges via mergeTrashEntries()
    - Returns merged + sorted list
    - On server fetch failure, falls back to local-only (no error thrown)

  // ── Preview ──────────────────────────────────
  async getTrashContent(id: string, source: 'local' | 'server'): Promise<{ content: string; id: string } | null>
    Local / both tombstones:
      - Reads from IndexedDB via dbGetNoteAny(id) — NOT dbGetNote, which
        filters out deleted records and would always return null for tombstones
      - Returns { id, content } if found and deleted===1, null otherwise
    Server-only tombstones (online):
      - Calls fetchTrashPreview(id) — a dedicated endpoint that returns the
        tombstone's content without actually restoring it
      - Returns { id, content } from the server, null on failure
    Server-only tombstones (offline):
      - Can't appear in the list (offline only shows local tombstones),
        so this path is unreachable

  // ── Restore ──────────────────────────────────
  async restoreTrashItem(id: string,
                          source: 'local' | 'server'): Promise<void>
    Local path (offline or local-only tombstone):
      - dbRestoreNote(id)    // flips deleted:0, updates updated_at
      - const note = await dbGetNoteAny(id)  // read back for content + current
      - queueChange('CREATE', id, note?.content ?? '', note?.current ?? 'local')
      - notifyLocalChange('restored', id)  // cross-tab
      - syncNow()            // push the CREATE to server
    Server path:
      - fetchTrashRestore(id) → returns { note: { id, created_at, content, current } }
        Server revives the note + appends a changelog entry, so other
        clients pick up the restore on their next sync without us
        pushing anything.
      - Write locally using a raw db.notes.put() (NOT dbSaveNote) to
        preserve the server's version key:
          await ensureDbOpen();
          await db.notes.put({
            id, content,
            created_at: note.created_at,
            updated_at: Date.now(),
            deleted: 0 as const,
            current: note.current,        // ← preserve server version key!
            updated_by: getUsername() ?? 'unknown',
            created_by: note.created_by,           // server is authoritative
          });
        Using dbSaveNote would set current='local' (the note doesn't exist
        locally yet), losing the server's version key and causing sync
        conflicts on the next save.
      - notifyLocalChange('restored', id)  // cross-tab
      (No queueChange — the server already has the note.
       No syncNow — we literally just talked to the server.)

  Source resolution: 'both' entries (tombstone exists in both
  IndexedDB and on the server) are normalized to 'server' before
  calling restoreTrashItem.  The server path is safer — it revives
  the official tombstone + appends a changelog entry so other clients
  pick up the restore via sync.  The local path with queueChange('CREATE')
  would conflict with a tombstone that still exists on the server.

  // ── Purge ────────────────────────────────────
  async purgeTrashItem(id: string, source: 'local' | 'server' | 'both'): Promise<void>
    Algorithm:
      1. If source !== 'local' && navigator.onLine:
           → fetchTrashPurge(id)   (fire-and-forget, ignore 404)
      2. If source !== 'local' && !navigator.onLine:
           → trackPendingPurge(id)  (persist in localStorage, see below)
      3. dbPermanentDelete(id)      (always — remove from IndexedDB immediately)
      4. notifyLocalChange('deleted', id)  (cross-tab)

    Why step 2 matters: without it, a purged 'both' tombstone would
    reappear in the trash list when the user comes back online
    (the server still has the .deleted.json file).  Tracking pending
    purges lets loadTrashEntries() filter them out and a periodic
    retry clears them from the server.

  // ── Empty ────────────────────────────────────
  async emptyTrash(): Promise<void>
    Algorithm:
      1. Load all local tombstones via dbListDeletedNotes() — call it once.
         Extract IDs: ids = tombstones.map(n => n.id)
      2. If online: fetchTrashEmpty() (fire-and-forget)
      3. If offline: for each local tombstone, trackPendingPurge(id)
           (Tracks ALL local tombstone IDs, including local-only ones.
            This is simpler than trying to determine source without a server
            round-trip.  Local-only IDs get harmless 404s from the server
            during flushPendingPurges — no data loss.  The real benefit:
            server-side tombstones won't reappear in the trash list on
            reconnect, same guarantee as purgeTrashItem.)
      4. db.notes.bulkDelete(ids) for all local tombstones
      5. notifyLocalChange('trash-emptied', '')  // cross-tab

  // ── Pending purge tracking (internal) ──────────
  Uses localStorage keyed by namespace (matching the cross-tab channel pattern).

  PENDING_PURGE_KEY = ns ? `leaf-trash-pending-purge:${ns}` : 'leaf-trash-pending-purge'

  getPendingPurges(): Set<string>
    - Reads JSON array from localStorage, returns as Set
    - Returns empty Set if key missing or parse fails

  trackPendingPurge(id: string): void
    - Adds id to the Set, writes back to localStorage

  dropPendingPurge(id: string): void
    - Removes id from the Set, writes back to localStorage

  flushPendingPurges(): Promise<void>
    - Called on the 'online' event (app.ts wires this)
    - For each id in getPendingPurges():
        fetchTrashPurge(id).then(() => dropPendingPurge(id))
    - Fire-and-forget per id — failures are benign (server TTL will
      eventually clean the tombstone, and loadTrashEntries filters it)

  // ── API (internal) ────────────────────────────
  async fetchTrashList(): Promise<ServerTrashEntry[]>
    POST /api/trash  { action: "list" }
    → { ok: true, data: [{ id, deleted_at }] }

  async fetchTrashRestore(id): Promise<{ ok, note: { id, created_at, content, current, created_by } }>
    POST /api/trash  { action: "restore", id }
    → { ok: true, note: { id, created_at, content, current, created_by } }

  async fetchTrashPreview(id): Promise<{ ok: boolean; note: { id: string; content: string } }>
    POST /api/trash  { action: "preview", id }
    → { ok: true, note: { id, content } }
    Returns the tombstone's content without restoring it — used by
    getTrashContent for server-only items so the user can see what
    they're about to restore or permanently delete.

  async fetchTrashPurge(id): Promise<void>
    POST /api/trash  { action: "purge", id }
    → { ok: true }

  async fetchTrashEmpty(): Promise<void>
    POST /api/trash  { action: "empty" }
    → { ok: true }
```

---

## Changes to existing files

### `db.ts` — four new functions (~45 lines)

```typescript
/**
 * Return all local tombstones (deleted: 1).
 * Does NOT include purged (already removed) records.
 */
export async function dbListDeletedNotes(): Promise<{
  id: string; deleted_at: number; updated_by: string
}[]> {
  await ensureDbOpen();
  const notes = await db.notes.where('deleted').equals(1).toArray();
  return notes.map(n => ({
    id: n.id,
    deleted_at: n.updated_at,
    updated_by: n.updated_by,
  }));
}

/**
 * Restore a soft-deleted note: flip deleted to 0.
 * Idempotent — no-op if the note doesn't exist or isn't deleted.
 * Updates updated_by to the current user (consistent with dbSaveNote).
 */
export async function dbRestoreNote(id: string): Promise<void> {
  await ensureDbOpen();
  const existing = await db.notes.get(id);
  if (!existing || !existing.deleted) return;
  await db.notes.put({
    ...existing,
    deleted: 0 as const,
    updated_at: Date.now(),
    updated_by: getUsername() ?? 'unknown',
  });
}

/**
 * Hard-delete a note row from IndexedDB entirely.
 * Idempotent — no-op if the note doesn't exist.
 * Always calls ensureDbOpen() — Firefox may close the connection
 * under storage pressure.
 */
export async function dbPermanentDelete(id: string): Promise<void> {
  await ensureDbOpen();
  await db.notes.delete(id);
}

/**
 * Read a note regardless of its deleted flag.
 * Unlike dbGetNote (which filters out deleted records), this returns
 * tombstones too so getTrashContent can preview them.
 * Returns null only if the record doesn't exist at all.
 *
 * Includes `current` (the version key) so restoreTrashItem can pass
 * it to queueChange for conflict resolution when the note was
 * previously synced from the server.
 */
export async function dbGetNoteAny(id: string): Promise<{
  id: string; content: string; deleted: 0 | 1; current: string
} | null> {
  await ensureDbOpen();
  const note = await db.notes.get(id);
  if (!note) return null;
  return {
    id: note.id,
    content: note.content,
    deleted: note.deleted,
    current: note.current,
  };
}
```

### `cross-tab.ts` — two new message types (~5 lines)

```typescript
/** Shape of the message sent between tabs. */
export interface CrossTabMessage {
  type: 'saved' | 'created' | 'deleted' | 'renamed' | 'server-sync'
      | 'restored' | 'trash-emptied';  // ← new
  id: string;
  newId?: string;
}
```

`'restored'` — a note was restored from the trash. Other tabs should refresh
their notes list (if in notes mode) or trash list (if in trash mode).

`'trash-emptied'` — all trash was purged at once. Other tabs should refresh
their trash list.

`purgeTrashItem` reuses the existing `'deleted'` type since the outcome is
the same for other tabs (note no longer exists).

---

### `view.ts` — generic SidebarView + extend UIEventHandlers (~15 lines)

Make `SidebarView` generic so `TrashView` can provide `TrashEntry[]` to
`render()` while `TreeView` continues passing `NoteMeta[]` (the default type
argument means zero changes to `tree.ts`).

```typescript
export interface SidebarView<T = NoteMeta> {
  render(items: T[], currentId: string | null): void;
  handleClick(e: MouseEvent, handlers: UIEventHandlers): void;
  updateNoteCount(total: number, shown: number): void;
  destroy(): void;
}
```

Add trash-specific callbacks to `UIEventHandlers`:

```typescript
export interface UIEventHandlers {
  // ... existing ...
  onToggleTrash:   () => void;
  onTrashPreview:  (id: string, source: 'local' | 'server') => void;
  onTrashRestore:  (id: string, source: 'local' | 'server') => void;
  onTrashPurge:    (id: string, source: 'local' | 'server' | 'both') => void;
  onTrashEmpty:    () => void;
}
```

### `sidebar-chrome.ts` — setCurrentView (~5 lines)

Add a function so `TrashView` can be registered as the active sidebar view.
Without this, click delegation in `ui.bindEvents` always dispatches to
`TreeView` — the trash ⋯ context menu would never fire.

```typescript
/**
 * Set the active sidebar view for event delegation.
 * Called by app.ts when switching sidebar modes (notes ↔ trash).
 */
export function setCurrentView(view: SidebarView<any>): void {
  currentView = view;
}
```

Also update `renderFileList` to call `setCurrentView`:

```typescript
export function renderFileList(notes: NoteMeta[], currentId: string | null): void {
  currentView = TreeView;
  TreeView.render(notes, currentId);
}
```

---

### `ui.ts` — sidebar mode toggle + trash banner (~60 lines)

Add sidebar mode state, toolbar swap, and editor-area trash banner.
No trash list rendering — that's in `trash-view.ts`.

```typescript
type SidebarMode = 'notes' | 'trash';
let _sidebarMode: SidebarMode = 'notes';

export function setSidebarMode(mode: SidebarMode): void {
  _sidebarMode = mode;
  // Swap toolbar visibility
  if (mode === 'trash') {
    sidebarToolbar.style.display   = 'none';  // search + new
    noteFooter.style.display       = 'none';  // normal footer (hide)
    trashToolbar.style.display     = 'flex';  // back + label
    trashFooter.style.display      = 'flex';  // count + empty
    hideTrashBanner();             // clear any stale preview
  } else {
    sidebarToolbar.style.display   = 'flex';
    noteFooter.style.display       = '';      // normal footer (restore)
    trashToolbar.style.display     = 'none';
    trashFooter.style.display      = 'none';
  }
}

export function getSidebarMode(): SidebarMode { return _sidebarMode; }

export function setTrashCount(n: number): void {
  trashCountBadge.textContent = String(n);
  trashCountBadge.style.display = n > 0 ? '' : 'none';
}

// ── Trash preview banner ─────────────────────────────────────────────

export function showTrashBanner(
  id: string,
  content: string,
  onRestore: () => void,
  onPurge: () => void
): void {
  // Hide normal editor, show the trash banner + read-only preview
  hideEditor();
  trashBanner.style.display = 'block';
  trashBannerContent.textContent = content;
  trashBannerTitle.textContent = `"${id}" is in the trash`;
  // Wire button handlers — callbacks are closures from app.ts
  trashBannerRestore.onclick = onRestore;
  trashBannerPurge.onclick = onPurge;
}

export function hideTrashBanner(): void {
  trashBanner.style.display = 'none';
}
```

#### DOM refs needed:
```
sidebarFooter         = $('sidebar-footer')    // hidden in trash mode
trashBanner           = $('trash-banner')
trashBannerContent    = $('trash-banner-content')
trashBannerTitle      = $('trash-banner-title')
trashBannerRestore    = $('trash-banner-restore')
trashBannerPurge      = $('trash-banner-purge')
noteFooter            = sidebarFooter          // alias for clarity
```

### `app.ts` — wiring (~50 lines)

#### New imports:
```typescript
import * as sidebar from './sidebar-chrome.js';  // for setCurrentView
import { TrashView } from './trash-view.js';
import {
  loadTrashEntries, getTrashContent,
  restoreTrashItem, purgeTrashItem, emptyTrash,
  flushPendingPurges,
} from './trash-service.js';
// dbListDeletedNotes is no longer imported directly here — it's called
// internally by loadTrashEntries() in trash-service.ts.
```

#### Online event — flush pending purges:
Add to `showApp()` after `onCrossTabChange` registration, alongside the existing
`syncStart` online handler:
```typescript
// When coming back online, flush any server-side tombstones that were
// permanently deleted while offline.  Each call is fire-and-forget.
window.addEventListener('online', () => {
  flushPendingPurges().catch(err =>
    console.warn('[trash] flushPendingPurges failed:', err)
  );
});
```

#### Trash helpers:
```typescript
/**
 * Refresh the trash list and update the count badge.
 * Used by handleToggleTrash, handleCrossTabChange, and onRemoteChange
 * so the mode-aware refresh logic lives in one place.
 *
 * NOTE: loadTrashEntries() calls dbListDeletedNotes() internally, so we
 * use entries.length for the badge — no second IndexedDB call needed.
 */
async function refreshTrashList(): Promise<void> {
  const entries = await loadTrashEntries();
  TrashView.render(entries, null);  // null = no note "open" in trash
  sidebar.setCurrentView(TrashView);  // register for click delegation
  ui.setTrashCount(entries.length);   // entries already includes local-only items
}
```

#### Trash handlers:
```typescript
async function handleToggleTrash(): Promise<void> {
  if (ui.getSidebarMode() === 'trash') {
    // Go back to notes
    ui.setSidebarMode('notes');
    ui.hideTrashBanner();
    await refreshList();       // renderFileList resets currentView to TreeView
  } else {
    // Enter trash mode
    ui.setSidebarMode('trash');
    await refreshTrashList();
  }
}

async function handleTrashPreview(id: string, source: 'local' | 'server'): Promise<void> {
  // Local / both: reads from IndexedDB via dbGetNoteAny
  // Server-only: fetches content on demand from the trash preview endpoint
  const result = await getTrashContent(id, source);
  if (!result) {
    ui.toast('Content not available', true);
    return;
  }
  // Show editor with read-only content and a restore/delete banner.
  // Pass closures so the banner buttons don't need access to app.ts internals.
  ui.showTrashBanner(id, result.content,
    () => handleTrashRestore(id, source),
    () => handleTrashPurge(id, source),
  );
}

async function handleTrashRestore(id: string, source: 'local' | 'server'): Promise<void> {
  try {
    await restoreTrashItem(id, source);
    ui.hideTrashBanner();
    ui.setSidebarMode('notes');
    await refreshList(id);     // open the restored note
    ui.toast('Restored "' + id + '"');
  } catch (err) {
    // Server path may fail if network drops between listing and restore
    ui.toast(`Restore failed: ${(err as Error).message}`, true);
  }
}

async function handleTrashPurge(id: string, source: 'local' | 'server' | 'both'): Promise<void> {
  if (!confirm('Permanently delete "' + id + '"? This cannot be undone.')) return;
  await purgeTrashItem(id, source);
  ui.hideTrashBanner();
  await refreshTrashList();
  ui.toast('Permanently deleted "' + id + '"');
}

async function handleTrashEmpty(): Promise<void> {
  if (!confirm('Permanently delete ALL items in trash?')) return;
  await emptyTrash();
  ui.hideTrashBanner();
  await refreshTrashList();
  ui.toast('Trash emptied');
}
```

#### Wiring in `bindEvents` call:
```typescript
ui.bindEvents({
  // ... existing ...
  onToggleTrash:  () => handleToggleTrash(),
  onTrashPreview: (id, src) => handleTrashPreview(id, src),
  onTrashRestore: (id, src) => handleTrashRestore(id, src),
  onTrashPurge:   (id, src) => handleTrashPurge(id, src),
  onTrashEmpty:   () => handleTrashEmpty(),
});
```

#### Boot — update trash badge:
In `showApp()`, after `refreshList()`:
```typescript
// Use refreshTrashList to get an accurate count, then switch back
// to notes.  This is boot time only — we don't render the trash list,
// just need the count for the badge in the notes toolbar.
const trashEntries = await loadTrashEntries();
ui.setTrashCount(trashEntries.length);
```

#### After any note delete:
In `deleteFile()`, no change needed — `refreshList()` already re-queries
IndexedDB for live notes.  The trash count badge should be updated
separately.  But since the plan calls `dbListDeletedNotes()` which
is also called inside `loadTrashEntries()`, the simplest approach is
to just call `loadTrashEntries()` and take `.length`:
```typescript
const trashEntries = await loadTrashEntries();
ui.setTrashCount(trashEntries.length);
```

#### After remote sync (onRemoteChange):
The `onRemoteChange` callback in `app.ts` must be **mode-aware**.
Currently it unconditionally calls `refreshList()`, which sets
`currentView = TreeView`.  If the user is in trash mode when a remote
sync arrives, this would silently switch the sidebar back to notes.

Fix: check `ui.getSidebarMode()` before deciding what to refresh.
```typescript
onRemoteChange(() => {
  ui.setSidebarLoading(false);
  if (ui.getSidebarMode() === 'trash') {
    refreshTrashList();
  } else {
    refreshList();
    // Update trash badge even in notes mode (remote sync may have
    // added or removed server tombstones that affect the count).
    loadTrashEntries().then(entries => ui.setTrashCount(entries.length));
  }
});
```

Note: `onRemoteChange` fires in the *current* tab after `applyServerChanges()`.
`handleCrossTabChange` handles *other* tabs via BroadcastChannel.
Both paths must be mode-aware.

#### Cross-tab — mode-aware refresh (~25 lines):

The existing `handleCrossTabChange` always calls `refreshList()` which renders
`TreeView` (notes mode). If another tab is in trash mode, it must refresh the
trash list instead.

`refreshTrashList()` is defined once (see "Trash helpers" above) and reused
here.  It calls `loadTrashEntries()` + renders + updates the badge — no
duplicate IndexedDB reads.

```typescript
async function handleCrossTabChange(msg: CrossTabMessage): Promise<void> {
  const currentId = store.getCurrent();
  const inTrashMode = ui.getSidebarMode() === 'trash';

  switch (msg.type) {
    case 'saved':
    case 'created': {
      await refreshList(currentId);
      if (currentId && currentId === msg.id && !store.isDirty()) {
        await reloadOpenNote(currentId);
      }
      break;
    }

    case 'deleted': {
      if (inTrashMode) {
        // Note was permanently deleted in another tab
        await refreshTrashList();
      } else {
        await refreshList();
        // Update trash badge — another tab may have soft-deleted a note,
        // incrementing the tombstone count.
        loadTrashEntries().then(e => ui.setTrashCount(e.length));
        if (currentId && currentId === msg.id) {
          store.closeNote();
          ui.hideEditor();
          ui.toast(`"${msg.id}" was deleted in another tab`);
        }
      }
      break;
    }

    case 'renamed': {
      const newId = msg.newId;
      await refreshList(newId);
      if (currentId && currentId === msg.id && newId && !store.isDirty()) {
        await reloadOpenNoteAs(newId);
        ui.toast(`Renamed to "${newId}" in another tab`);
      }
      break;
    }

    case 'restored': {
      if (inTrashMode) {
        await refreshTrashList();
      } else {
        await refreshList(currentId);
        // Update trash badge — another tab restored a note, decrementing
        // the tombstone count.
        loadTrashEntries().then(e => ui.setTrashCount(e.length));
        if (currentId && currentId === msg.id && !store.isDirty()) {
          await reloadOpenNote(currentId);
        }
      }
      break;
    }

    case 'trash-emptied': {
      if (inTrashMode) {
        await refreshTrashList();
        ui.toast('Trash was emptied in another tab');
      } else {
        // In notes mode: live notes unaffected, but trash badge → 0
        ui.setTrashCount(0);
      }
      break;
    }

    case 'server-sync': {
      if (inTrashMode) {
        await refreshTrashList();
      } else {
        await refreshList(currentId);
        // Server sync may bring new tombstones (other users' soft-deletes)
        // or remove them (server TTL purge).
        loadTrashEntries().then(e => ui.setTrashCount(e.length));
        if (currentId && !store.isDirty()) {
          await reloadOpenNote(currentId);
        }
      }
      break;
    }
  }
}
```

---

### `spa/index.html` — toolbar, footer, banner (~30 lines)

Assumes `context-menu-plan.md` is already complete (the `#context-menu` element exists).

#### Trash button in normal toolbar:
```html
<div id="sidebar-toolbar">
  <div id="search-wrap">...</div>
  <button id="btn-new" class="btn">+ New</button>
  <button id="btn-trash" class="btn-icon" title="Trash">
    <svg width="13" height="13" fill="none" stroke="currentColor"
         stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14"/>
    </svg>
    <span id="trash-count" class="trash-badge" style="display:none">0</span>
  </button>
</div>
```

#### Trash mode toolbar (hidden by default):
```html
<div id="trash-toolbar" style="display:none">
  <button id="btn-back-notes" class="btn-small">← Notes</button>
  <span class="trash-toolbar-label">Trash</span>
</div>
```

Place this between `#sidebar-toolbar` and `#file-list` in the sidebar.

#### Trash mode footer (hidden by default):
```html
<div id="trash-footer" style="display:none">
  <span id="trash-item-count">0 items</span>
  <button id="btn-empty-trash" class="btn-small danger">Empty trash</button>
</div>
```

Place this after `#sidebar-footer`. When trash mode is active, hide the normal
footer and show this one.

#### Trash preview banner (editor area, hidden by default):
```html
<div id="trash-banner" style="display:none">
  <div class="trash-banner-bar">
    <span class="trash-banner-icon">⚠</span>
    <span id="trash-banner-title"></span>
    <button id="trash-banner-restore" class="btn-small">Restore</button>
    <button id="trash-banner-purge" class="btn-small danger">Delete forever</button>
  </div>
  <pre id="trash-banner-content" class="trash-banner-content"></pre>
</div>
```

Place this inside the editor panel, above the normal editor content area.
The banner hides the textarea/meta-panel and shows read-only content instead.

---

### `spa/css/app.css` — trash styles (~90 lines)

```css
/* ── Trash badge ── */
.trash-badge {
  font-size: 10px;
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: 99px;
  padding: 0 5px;
  min-width: 16px;
  text-align: center;
  font-family: var(--font-mono);
  line-height: 16px;
}

/* ── Trash toolbar ── */
#trash-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-mid);
  flex-shrink: 0;
}
.trash-toolbar-label {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-2);
}

/* ── Trash row ── */
.trash-row {
  display: flex;
  align-items: center;
  padding: 7px 10px;
  gap: 8px;
}
.trash-row-icon { flex-shrink: 0; color: var(--text-3); opacity: 0.6; }
.trash-row-info  { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.trash-row-name {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trash-row-meta {
  font-size: 10px;
  color: var(--text-3);
  font-family: var(--font-mono);
}
.trash-row-source {
  font-size: 9px;
  color: var(--accent-dim);
  margin-left: 4px;
}

/* ⋯ button — same pattern as tree.ts .file-item-more */
.trash-row .file-item-more {
  flex-shrink: 0;
}

/* ── Trash empty state ── */
.trash-empty {
  padding: 20px 12px;
  text-align: center;
  font-size: 11px;
  color: var(--text-3);
  font-family: var(--font-mono);
}

/* ── Trash footer ── */
#trash-footer {
  padding: 8px 10px;
  border-top: 1px solid var(--border-mid);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
#trash-item-count {
  font-size: 11px;
  color: var(--text-3);
  font-family: var(--font-mono);
}

/* ── Trash preview banner ── */
#trash-banner {
  border-bottom: 1px solid var(--border-mid);
  background: var(--bg-2);
}
.trash-banner-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-2);
}
.trash-banner-icon { font-size: 14px; }
.trash-banner-content {
  padding: 12px 16px;
  margin: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-1);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 60vh;
  overflow-y: auto;
  user-select: text;        /* read-only but copyable */
}

/* ── Shared ── */
.btn-small.danger { color: var(--danger); border-color: rgba(224,80,80,.3); }
.btn-small.danger:hover { background: var(--danger-bg); }
```

---

### `src/php/trash.php` — preview action + changelog on restore (~45 lines)

Add `require_once` for the audit logger (needed by the new `audit_log` call
in the changelog-on-restore patch below):

```php
require_once __DIR__ . '/audit.php';  // added after storage.php and auth_guard.php
```

#### New `preview` action

Returns the full content of a deleted tombstone without restoring it.
Needed so the UI can show a read-only preview of server-only tombstones
(items that exist on the server but haven't been synced to local IndexedDB).

Add a new case to the `switch ($action)` block in `trash.php`:

```php
case 'preview':
    $id = (string)($body['id'] ?? '');
    if ($id === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Missing "id" parameter']);
        exit;
    }
    $deletedPath = deleted_path($id);
    if (!file_exists($deletedPath)) {
        http_response_code(404);
        echo json_encode(['error' => 'Tombstone not found']);
        exit;
    }
    $data = json_decode(file_get_contents($deletedPath), true);
    $current = $data['current'] ?? null;
    $content = ($current && isset($data['versions'][$current]))
        ? $data['versions'][$current]['content']
        : '';
    echo json_encode([
        'ok'   => true,
        'note' => ['id' => $id, 'content' => $content],
    ], JSON_UNESCAPED_UNICODE);
    exit;
```

#### Changelog on restore

The server's restore action revives the file but doesn't append a changelog entry.
Other clients won't know the note exists again until they do a full re-sync.

Also add `created_by` to the existing restore response so the client can
write the authoritative author into IndexedDB on restore:

```php
    // In the existing response (before json_encode):
    'created_by' => $note['created_by'] ?? '',
```

Add after the existing `storage_revive_note($id)` and before the response:

```php
case 'restore':
    // ... existing validation and storage_revive_note ...
    $note = storage_get_note($id);
    // ... existing checks ...

    // Append changelog entry so other clients sync the revived note
    $rev = next_rev();
    changelog_append([
        'rev'          => $rev,
        'file'         => $id,
        'type'         => 'CREATE',
        'ts'           => time(),
        'version'      => $note['current'] ?? null,
        'prev_version' => null,
    ]);
    audit_log('NOTE_RESTORE', ['user' => $author, 'note_id' => $id]);

    // ... existing response (also add created_by to the note object) ...
```

---

## Implementation order

**Prerequisite:** `context-menu-plan.md` completed first (`context-menu.ts`, HTML element rename, `tree.ts` refactor).

1. **`db.ts`** — `dbListDeletedNotes`, `dbRestoreNote`, `dbPermanentDelete`, `dbGetNoteAny`
2. **`trash-service.ts`** — API calls + merge logic + offline purge tracking + orchestration + `getTrashContent` (including `fetchTrashPreview`)
3. **`trash.php`** — `preview` action + changelog on restore + audit log
4. **`view.ts`** — make `SidebarView` generic, extend `UIEventHandlers` with trash callbacks
5. **`sidebar-chrome.ts`** — add `setCurrentView`
6. **`trash-view.ts`** — renders trash list in sidebar, implements `SidebarView<TrashEntry>`, uses `context-menu.ts` for ⋯ dropdown
7. **`ui.ts`** — sidebar mode toggle, trash count badge, toolbar swap, trash preview banner
8. **`cross-tab.ts`** — add `'restored'` and `'trash-emptied'` message types
9. **`app.ts`** — wiring + handlers + mode-aware `onRemoteChange` + mode-aware `handleCrossTabChange` + `flushPendingPurges` on online event
10. **`index.html`** — trash button, trash toolbar, trash footer, trash preview banner
11. **`app.css`** — trash styles (list + banner)

---

## Test considerations

- `db.test.ts`: Add tests for `dbListDeletedNotes`, `dbRestoreNote`, `dbPermanentDelete`, `dbGetNoteAny`
- `sync.test.ts`: Verify restored notes propagate correctly; verify offline purge tracking flushed on reconnect
- `trash-service.test.ts`: Tests for `mergeTrashEntries` (dedup, source flags, sort order)
- `trash-service.test.ts`: Test `getTrashContent` returns content for local tombstones, null for missing or non-deleted
- `trash-service.test.ts`: Test `loadTrashEntries` offline-only (no server call), online merge, server-failure fallback
- `trash-service.test.ts`: Test pending purge tracking (offline server-side purge → filters on reload → flushed on reconnect)
- `trash-view.test.ts`: Test rendering edge cases (empty state, server-only indicator, row events, context menu)
- `app.test.ts`: Test `onRemoteChange` doesn't clobber trash mode (different from cross-tab `server-sync` path)
- Manual: Offline trash → list → preview content → restore; verify content shown read-only
- Manual: Online trash → list → restore; verify sync
- Manual: Purge server-side tombstone while offline → go online → verify it does NOT reappear in trash list
- Manual: Purge server-side tombstone while online → verify removed from server immediately
- Manual: Purge single item; Empty all; Confirm dialogs
- Manual: Trash count badge updates after delete/restore/sync
- Manual: Server-only items show (↑) indicator; ⋯ dropdown actions work
- Manual: Toolbar swap when toggling trash mode; back button returns to notes
- Manual: Click trash row → preview banner appears with read-only content; banner buttons work
- Manual: Preview banner hidden when switching back to notes mode or after restore/purge
- Manual: Remote sync arrives while in trash mode → list refreshes, mode stays on trash
- Cross-tab: Open two tabs. Tab A in notes mode, Tab B in trash mode. Restore in Tab B → Tab A sees note appear
- Cross-tab: Open two tabs both in trash mode. Purge in Tab A → Tab B sees item disappear
- Cross-tab: Open two tabs both in trash mode. Empty in Tab A → Tab B sees "Trash was emptied" toast + empty list
- Cross-tab: Open two tabs both in trash mode. Remote sync arrives → both tabs refresh trash list
- Cross-tab: Open two tabs both in trash mode. Tab A restores a note → Tab B's trash list updates + count badge

---

## Test cases

All new code requires automated test coverage. Below are specific cases to cover.

### `db.test.ts`

```
describe('dbListDeletedNotes', () => {
  it('returns only notes with deleted: 1')
  it('excludes notes with deleted: 0')
  it('excludes purged (fully deleted) notes')
  it('returns empty array when no tombstones exist')
  it('maps updated_at → deleted_at and includes updated_by')
})

describe('dbRestoreNote', () => {
  it('flips deleted from 1 to 0 and updates updated_at')
  it('sets updated_by to the current user (consistent with dbSaveNote)')
  it('is a no-op when the note does not exist')
  it('is a no-op when the note is not deleted (deleted: 0)')
})

describe('dbPermanentDelete', () => {
  it('removes the row from IndexedDB entirely')
  it('is a no-op when the note does not exist')
  it('note no longer appears in dbListDeletedNotes after purge')
  it('ensureDbOpen is called before delete (reopens stale connection)')
})

describe('dbGetNoteAny', () => {
  it('returns { id, content, deleted, current } for a live note (deleted: 0)')
  it('returns { id, content, deleted, current } for a tombstone (deleted: 1)')
  it('includes current (version key) so restoreTrashItem can pass it to queueChange')
  it('returns null when the note does not exist at all')
  it('differs from dbGetNote which returns null for tombstones')
  it('content matches what was stored via dbSaveNote or dbDeleteNote')
})
```

### `trash-service.test.ts`

```
describe('mergeTrashEntries', () => {
  it('returns local-only entries with source: local')
  it('returns server-only entries with source: server')
  it('merges by id and sets source: both when present in both')
  it('uses the more recent deleted_at when both have a timestamp')
  it('sorts newest-first by deleted_at')
  it('handles null deleted_at from server (uses local timestamp)')
  it('handles empty local array')
  it('handles empty server array')
  it('handles both arrays empty → returns []')
})

describe('getTrashContent', () => {
  it('returns { id, content } from IndexedDB for a locally deleted note')
  it('returns null from IndexedDB for a missing id')
  it('returns null from IndexedDB for a note that exists but is NOT deleted (deleted: 0)')
  it('uses dbGetNoteAny internally, not dbGetNote (which would always return null for tombstones)')
  it('fetches content from server (fetchTrashPreview) for server-only tombstones when online')
  it('returns null for server-only tombstones when fetchTrashPreview fails')
  it('returns null for server-only tombstones when offline (unreachable path)')
})

describe('loadTrashEntries', () => {
  it('returns only local entries when offline')
  it('merges local + server when online')
  it('returns local-only on server fetch failure (no thrown error)')
  it('does not make a server call when navigator.onLine is false')
  it('filters server results to exclude IDs in pending purge set')
  it('does NOT filter local results (pending purges already removed from IndexedDB)')
})

describe('purgeTrashItem', () => {
  it('local-only tombstone: skips server call, removes from IndexedDB')
  it('server/both tombstone + online: calls fetchTrashPurge + removes from IndexedDB')
  it('server/both tombstone + offline: tracks in pending purge set + removes from IndexedDB')
  it('pending purge prevents the tombstone from reappearing when online sync restores server list')
  it('notifyLocalChange("deleted", id) is called in all paths')
  it('silently ignores 404 from fetchTrashPurge (already purged on server)')
})

describe('emptyTrash', () => {
  it('online: calls fetchTrashEmpty, then bulkDeletes all local tombstones')
  it('offline: tracks all local tombstone IDs as pending purges, then bulkDeletes')
  it('offline: pending purge tracking prevents server tombstones from reappearing on reconnect')
  it('local-only IDs tracked as pending purge are harmless (server returns 404 on flush)')
  it('broadcasts "trash-emptied" after bulk delete')
  it('extracts IDs from dbListDeletedNotes result: tombstones.map(n => n.id)')
})

describe('pending purge tracking', () => {
  it('trackPendingPurge adds id to localStorage set')
  it('getPendingPurges returns Set of tracked ids')
  it('dropPendingPurge removes id from the set')
  it('loadTrashEntries filters pending-purge IDs out of server results')
  it('flushPendingPurges calls fetchTrashPurge for each tracked id, then drops on success')
  it('flushPendingPurges survives individual fetch failures (fire-and-forget per id)')
  it('persisted set is namespace-scoped (matches cross-tab channel pattern)')
})
```

### `cross-tab.test.ts`

```
describe('cross-tab trash messages', () => {
  it('notifyLocalChange("restored", id) sends correct BroadcastChannel message')
  it('notifyLocalChange("trash-emptied", "") sends correct BroadcastChannel message')
  it('restoreTrashItem broadcasts "restored" after IndexedDB write (local source)')
  it('restoreTrashItem broadcasts "restored" after IndexedDB write (server source)')
  it('purgeTrashItem broadcasts "deleted" after IndexedDB write')
  it('emptyTrash broadcasts "trash-emptied" after bulk delete')
})
```

### `app.test.ts` (cross-tab handling + onRemoteChange)

```
describe('handleCrossTabChange in trash mode', () => {
  it('"deleted" message refreshes TrashView when sidebar is in trash mode')
  it('"deleted" message updates trash badge when sidebar is in notes mode')
  it('"restored" message refreshes TrashView when sidebar is in trash mode')
  it('"restored" message refreshes notes list + updates trash badge when sidebar is in notes mode')
  it('"trash-emptied" message refreshes TrashView + shows toast in trash mode')
  it('"trash-emptied" message resets badge to 0 when sidebar is in notes mode')
  it('"server-sync" message refreshes TrashView when sidebar is in trash mode')
  it('"server-sync" message updates trash badge when sidebar is in notes mode')
  it('trash count badge is updated after cross-tab refresh')
})

describe('onRemoteChange in trash mode', () => {
  it('calls refreshTrashList() when sidebar is in trash mode (NOT refreshList)')
  it('calls refreshList() + updates trash badge when sidebar is in notes mode')
  it('does not clobber currentView (remains TrashView in trash mode, TreeView in notes mode)')
  it('hides sidebar loading indicator in both modes')
  it('updates trash count badge even when in notes mode (server may have new tombstones)')
})
```

### `sync.test.ts`

```
describe('trash sync', () => {
  it('local restore queues a CREATE and pushes to server')
  it('server restore writes note to IndexedDB (no CREATE queued — server already has it)')
  it('restored note from server is received via changelog (CREATE entry appended by trash.php)')
  it('other clients detect the restored note via CREATE changelog entry')
  it('online purge removes tombstone from both IndexedDB and server')
  it('offline purge of server-side tombstone: tracks pending purge, flushed on reconnect')
  it('pending purge flush on online event calls fetchTrashPurge for each tracked id')
})
```

### `trash-view.test.ts`

```
describe('TrashView rendering', () => {
  it('renders empty state when entries array is empty')
  it('renders each entry with trash icon, id, and relative time')
  it('shows (↑) indicator for server-only entries')
  it('shows updated_by when present (local/both entries)')
  it('does NOT show updated_by for server-only entries')
  it('sorts entries by deleted_at newest-first')
})

describe('TrashView event handling', () => {
  it('row click fires onTrashPreview(id, source)')
  it('normalizes source: both → server when calling onTrashRestore')
  it('normalizes source: both → server when calling onTrashPreview')
  it('passes source: both unchanged to onTrashPurge (purge needs both flag)')
  it('⋯ button opens context-menu with [Restore] and [Delete forever]')
  it('context-menu Delete-forever fires onTrashPurge(id, source)')
  it('context-menu Restore fires onTrashRestore(id, source)')
  it('updateNoteCount updates footer count and enables Empty button when count > 0')
  it('destroy() closes context menu and clears file-list innerHTML')
})
```
