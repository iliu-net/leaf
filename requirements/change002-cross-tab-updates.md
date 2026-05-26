# Cross-Tab Sync Implementation Plan

## Goal

When a user has multiple tabs/windows of the SPA open, changes made in one
tab (save, create, delete, rename) are reflected in all other tabs in near
real-time, without waiting for the server poll cycle.  This works fully
offline — all tabs share the same underlying IndexedDB database.

## Design Decision

Use the **BroadcastChannel API** — a simple message-passing channel between
same-origin browsing contexts.  It has zero dependencies, a tiny API surface,
and is well-supported across modern browsers (Chrome 54+, Firefox 38+,
Edge 79+, Safari 15.4+).  For older Safari, the try/catch wrapper ensures
graceful degradation (cross-tab sync simply doesn't happen, same as today).

---

## Architecture Overview

```
  Tab A                              Tab B
  ─────                              ─────
  notes.saveNote()                   (idle)
       │
       ▼
  write to IndexedDB  ◄──────────────┐
       │                             │
       ▼                             │
  broadcastChannel                   │
    .postMessage({                   │
      type: 'saved',                 │  onCrossTabChange handler fires
      id: 'my-note'                  │       │
    })                               │       ▼
       │                          re-read note list from IndexedDB
       ▼                          if currently-open note was affected:
  (nothing — sender                    reload content, or close editor if
   ignores its own                       deleted, or update id if renamed
   broadcasts)                       refresh sidebar
```

### Channel name

`"leaf-notes-cross-tab"` — scoped to the application, won't collide with
other BroadcastChannel usage on the same origin.

---

## Files to Create

### 1. `src/ts/cross-tab.ts` (new file)

A small module that encapsulates all BroadcastChannel logic.

**Exports:**

| Export | Signature | Purpose |
|--------|-----------|---------|
| `notifyLocalChange` | `(type, id, newId?) => void` | Call after any local IndexedDB mutation |
| `notifyServerSync` | `() => void` | Call after server changes are applied locally |
| `onCrossTabChange` | `(listener) => () => void` | Subscribe to cross-tab changes; returns unsubscribe fn |

**Internal details:**

- A lazy-initialised `BroadcastChannel` instance (`getChannel()`)
- `notifyLocalChange` and `notifyServerSync` wrap `postMessage` in try/catch
  so unsupported browsers degrade silently
- `onCrossTabChange` adds an event listener and returns a cleanup function

**Message shape (`CrossTabMessage`):**

```ts
{
  type: 'saved' | 'created' | 'deleted' | 'renamed' | 'server-sync';
  id: string;           // affected note id (old id for renames)
  newId?: string;       // new note id (only present for 'renamed')
}
```

For `'server-sync'`, `id` is set to `''` and treated as a bulk-refresh signal.

`'saved'` and `'created'` are distinct so the listener can, in future,
show different toast messages or animations.

---

## Files to Modify

### 2. `src/ts/notes.ts` — Broadcast after every mutation

Add one line after each successful mutation to notify other tabs.

| Function | After | Call |
|----------|-------|------|
| `saveNote()` | `dbSaveNote(...)` succeeds | `notifyLocalChange('saved', id)` |
| `createNote()` | `dbSaveNote(...)` succeeds | `notifyLocalChange('created', id)` |
| `deleteNote()` | `dbDeleteNote(...)` succeeds | `notifyLocalChange('deleted', id)` |
| `renameNote()` | `dbRenameNote(...)` succeeds | `notifyLocalChange('renamed', oldId, newId)` |

**Rationale for placement:** These calls happen *before* the queue entry is
written and *before* `syncNow()` is triggered.  The broadcast is fire-and-forget
and won't block the save flow.  The receiving tab will read the latest state
from IndexedDB, so broadcast timing relative to the queue write doesn't matter.

### 3. `src/ts/sync.ts` — Broadcast after server changes

After `applyServerChanges()` finishes and `notifyRemoteChange()` fires,
broadcast to other tabs so they know server data arrived.

**Placement:** Inside `applyServerChanges()`, right after `notifyRemoteChange()`:

```ts
if (count > 0) {
  notifyRemoteChange();
  notifyServerSync();   // ← new line
}
```

Also inside `push()`, after the `applyServerChanges()` call there:

```ts
const received = await applyServerChanges(data.changes ?? [], data.currentRevision);
```

This already calls `applyServerChanges` which will hit the new line above.

**Note:** We do NOT broadcast on `push()` for locally-sent changes, because:
- The sending tab already broadcasted the local change (from notes.ts)
- The server may send back the same change, which `applyServerChanges` will
  detect and broadcast via `notifyServerSync`
- Other tabs will pick up the server version, which is the desired outcome

### 4. `src/ts/app.ts` — Listen for cross-tab changes

Add a listener in the `showApp()` function (or in the `boot()` function after
the app shell is shown) that subscribes to `onCrossTabChange`.

#### Handler logic

```
onCrossTabChange(msg):
  switch msg.type:
    case 'saved':
    case 'created':
    case 'server-sync':
      → refreshList(currentId)   // re-read notes from IndexedDB
      → if msg.id matches currently-open note:
          → reload that note's content from IndexedDB
          → if the editor is showing it, update the textarea

    case 'deleted':
      → refreshList()
      → if msg.id matches currently-open note:
          → closeNote(), hideEditor(), toast "Note was deleted in another tab"

    case 'renamed':
      → refreshList(msg.newId)
      → if msg.id matches currently-open note:
          → update current id to msg.newId
          → reload content under new id
          → toast "Note was renamed to … in another tab"
```

#### Implementation details

The handler needs access to `store.getCurrent()` to know which note is open.
For the "reload content" case, it needs to call `notes.loadNote(id)` and then
update the editor via `store.openNote(id, content)` or `ui.showEditor(data)`.

A helper function `async reloadOpenNote(id: string)` should:
1. Load the note from IndexedDB (`notes.loadNote(id)`)
2. If the note exists: call `store.openNote(id, data.content)` and `ui.showEditor(data)`
3. If the note was deleted: call `store.closeNote()` and `ui.hideEditor()`

**Important subtlety:** The BroadcastChannel handler runs in the message event
context.  We must not block — all work should be async (reading from Dexie is
already async).  Also, the handler should not fire if the tab is itself the
originator of the change.  However, BroadcastChannel does NOT deliver messages
to the sending tab, so no deduplication logic is needed.  The sender simply
never receives its own messages.

#### Lifecycle

The listener should be set up once during app boot (`showApp()`) and torn down
if the app is "stopped" (e.g. on logout).  For simplicity, it can live for the
lifetime of the page — the unsubscribe function can be ignored since the page
will be navigated away from or the tab closed on logout.

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Tab A saves a note while Tab B has the same note open with unsaved changes | Tab B's unsaved changes are **not** overwritten.  The cross-tab handler only reloads the content if Tab B hasn't modified it (i.e. `!store.isDirty()`).  If dirty, the handler skips the reload and the user must manually decide (discard or keep). |
| Tab A deletes the note Tab B is currently editing | Tab B sees a toast "Note was deleted in another tab", the editor closes, and the dirty state is discarded.  This is the least-surprising behaviour — the note no longer exists. |
| Tab A renames a note Tab B has open | Tab B updates its current note ID, reloads content under the new ID, and shows a toast. |
| Multiple tabs save different content to the same note simultaneously | The last writer to IndexedDB wins (IndexedDB put semantics).  Each tab's sync queue will push its version to the server; the server resolves conflicts via whatever merge strategy it uses.  Cross-tab sync does not attempt conflict resolution — it just ensures all tabs see the latest IndexedDB state. |
| Browser doesn't support BroadcastChannel | The try/catch in `cross-tab.ts` silently swallows the error.  Cross-tab sync doesn't happen.  The existing server poll (30s) still works as a fallback. |
| Tab is offline | Cross-tab sync works fully offline — all tabs share the same IndexedDB.  No server round-trip needed. |
| Server sync pulls changes while local edits exist | `notifyServerSync()` triggers a bulk refresh in other tabs.  This may cause a brief "flicker" as the sidebar reloads, but the current note's content is preserved (unless it was deleted server-side). |

---

## Files Summary

| File | Action | Lines changed (approx) |
|------|--------|------------------------|
| `src/ts/cross-tab.ts` | **Create** | ~85 lines |
| `src/ts/notes.ts` | Import + 4 new call sites | +6 lines |
| `src/ts/sync.ts` | Import + 1 new call site | +2 lines |
| `src/ts/app.ts` | Import + listener setup + handler (~40 lines) | +45 lines |

**Total: ~1 new file, ~50 lines added across 3 existing files.**

---

## Testing Plan

### Manual test cases

1. **Basic save sync:** Open two tabs.  Edit and save a note in Tab A.  Verify
   Tab B's sidebar updates and the note shows updated content when opened.

2. **Create sync:** Create a new note in Tab A.  Verify it appears in Tab B's
   sidebar.

3. **Delete sync:** Delete a note in Tab A.  Verify it disappears from Tab B's
   sidebar.  If Tab B had that note open, verify the editor closes with a toast.

4. **Rename sync:** Rename a note in Tab A.  Verify Tab B's sidebar reflects
   the new name.  If Tab B had the note open, verify it stays open under the
   new name with a toast.

5. **Offline sync:** Go offline in both tabs.  Make changes in Tab A.  Verify
   Tab B sees them (no server needed).

6. **Dirty-state protection:** In Tab B, make unsaved changes to a note.  In
   Tab A, save that same note.  Verify Tab B does NOT lose its unsaved changes.

7. **Server sync triggers cross-tab refresh:** Wait for a server poll cycle.
   Verify other tabs refresh when server changes arrive.

### Automated test considerations

The BroadcastChannel API is a browser API; testing it requires a browser
environment (jsdom doesn't support it).  If the project adds browser-level
tests (e.g. Playwright or Cypress), these scenarios can be automated.
Otherwise, manual testing against the checklist above is sufficient for now.

---

## Rollout

- **No configuration changes needed.**  BroadcastChannel is a browser API
  with no feature flags or polyfills.

- **No breaking changes.**  The cross-tab sync is purely additive.  If
  BroadcastChannel is unavailable, behaviour is identical to today.

- **No server changes needed.**

- **No schema migration needed.**
