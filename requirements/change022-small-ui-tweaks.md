# Small UI Tweaks — Relative Time, New-Note Behaviour, Last-Note Persistence

## Overview

Three small but impactful UI improvements:

1. **Relative timestamps** in the system-meta table (View and Trash preview) —
   show "3 hours ago" alongside the absolute timestamp and author name.
2. **New-note → edit-mode** — creating a note switches to the Code (or Raw)
   tab so the user can start typing immediately, rather than landing on the
   rendered View tab.
3. **Last-note persistence** — the most recently opened note ID is saved to
   `localStorage` (scoped to the install path) and restored on the next page
   load.

---

## Motivation

### Relative timestamps

The system-meta table in the View and Trash preview panels shows absolute
timestamps (e.g. "2026-05-29 18:24") and the author name.  A relative
indicator — "3 hours ago", "just now" — gives the user an immediate sense
of recency without parsing a full date string.

The `relativeTime()` utility already existed in `utils.ts` but was only
used internally; wiring it into the renderer was a one-line addition per
timestamp row.

### New-note → edit-mode

Before this change, creating a note always landed on the rendered View tab.
The user had to manually click the Code or Raw tab before they could type.
For a brand-new empty note, the View tab shows nothing useful — the
immediate need is to start writing.

Now `showEditor()` detects empty content and switches directly to the Code
tab (or Raw fallback if CodeMirror hasn't loaded).  Non-empty notes still
default to the View tab as before.

### Last-note persistence

When the user returns to the app after closing the tab or refreshing the
page, they must manually re-open the note they were last working on.  This
is particularly jarring when the Service Worker updates the app and forces
a reload, or when the user has a deep note hierarchy and must navigate
back to their working context.

The persistence is scoped to **same origin + same path** (not just same
origin) so multiple Leaf instances on the same domain do not interfere.

---

## Implementation

### 1. Relative timestamps (`render-fm.ts`)

`renderSystemInfo()` now appends ` (3 hours ago)` after the author name
in the Created and Updated rows:

```
Created  2026-05-29 18:24 by alice (3 hours ago)
Updated  2026-05-29 20:13 by bob   (just now)
```

The `relativeTime()` function from `utils.ts` (already present, computes
"just now" / "N minutes ago" / "N hours ago" / "N days ago" / "N months ago")
is now imported and called in `render-fm.ts`.

### 2. New-note → edit-mode (`editor-ctrl.ts`)

In `showEditor()`, the tab-switch logic changed from a hardcoded `switchTab('view')`
to a conditional:

```
const isEmpty = !noteData.content.trim();
if (isEmpty) {
  await switchTab(_cmAvailable ? 'code' : 'raw');
} else {
  await switchTab('view');
}
```

Notes with existing content still open on the View tab.  Only truly empty
notes (whitespace-only counts as empty) jump to the editor.

### 3. Last-note persistence (`app.ts`)

**Storage key:** `leaf:last-note:<namespace>` (or `leaf:last-note` for
root deployments), matching the existing namespace pattern from `config.ts`.

**Persist on open:** `persistLastNote(id)` is called in three user-initiated
open paths:
- Sidebar click (`onOpen` handler)
- WikiLink navigation (`navigate-note` handler)
- Back button (`handleBack`)

**Restore on boot:** After `notesCtrl.refreshList()` in `showShell()`,
`restoreLastNote()` reads the stored ID, validates the note still exists in
IndexedDB (cleaning up stale keys), loads it, and opens it in the editor.
Failures are logged but never block the boot sequence.

---

## Bug fixes included

### Sidebar highlight race on note creation

When `notes.createNote()` calls `publish('created')`, the change-bus fires
synchronously — meaning `handleChange('created')` starts executing before
`notesCtrl.createNote()` returns.  Both functions call `refreshList()`,
and the change handler's version highlights the sidebar based on
`_current` (app-level state), which still points to the old note.

**Fix A — `onCreate` handler** (`app.ts`): After `notesCtrl.createNote()`
returns, the handler updates `_current`, `_content`, and clears dirty /
auto-save state to match the note now open in the editor.

**Fix B — `handleChange` for `'created'`/`'saved'`** (`app.ts`): After
`refreshList()`, the handler cross-checks the editor's actual current note
(`ui.getCurrentNoteId()`) against app-level `_current`.  If they differ
(race condition), `ui.setActiveNote()` corrects the sidebar highlight.

### Search text in New-note modal

The `onNew` handler was passing `''` as the search-value argument to
`modal.openModal()`, so the "New note" modal only received the current
note's colon prefix but never the sidebar search text.

**Fix:** `onNew` now reads `$(DOM.SEARCH).value` and passes it as the
second argument, restoring the pre-refactor behaviour where typing in the
sidebar search then clicking New pre-fills the modal with both the prefix
and the search text.

---

## Affected modules

| Module | Change |
|--------|--------|
| `src/ts/render-fm.ts` | Import `relativeTime`; append ` (relativeTime(...))` after author in Created/Updated rows |
| `src/ts/editor-ctrl.ts` | `showEditor()` detects empty content, switches to code/raw instead of view |
| `src/ts/app.ts` | Add `persistLastNote`/`restoreLastNote`; update `onCreate` to sync `_current`; fix `onNew` search-value; add `setActiveNote` guard in `handleChange`; import `$`, `getNamespace` |

---

## Edge cases

| Scenario | Behaviour |
|----------|-----------|
| `relativeTime` on 0 timestamp | Returns `'just now'` (caught by early return in `relativeTime`) |
| Note with whitespace-only content → New | Detected as empty → code/raw tab |
| `localStorage` unavailable (private browsing) | `persistLastNote` silently ignores; `restoreLastNote` returns false |
| Stale last-note ID (note deleted in another tab) | `restoreLastNote` cleans up the stale key and returns false |
| Create note while `_current` is null (no note open) | `onCreate` reads `ui.getCurrentNoteId()` (new note); no crash |
| Multiple create/save events during creation flow | `setActiveNote` guard only fires when editor and `_current` disagree |
