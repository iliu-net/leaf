# Refactor — split ui.ts, app.ts, and history.ts

## Goal

Reduce `ui.ts` (~521→~290), `app.ts` (~488→~370), and `history.ts` (577→*deleted*)
by extracting cohesive chunks into new self-contained modules.
No behavioral changes — just file organisation.

---

## Part 1: Split ui.ts → ui.ts + editor.ts + sidebar-chrome.ts

### New file: `editor.ts` (~130 lines)

Extracts all editor/textarea/meta-panel lifecycle code.

```
Exports:
  initPanels(onDirty)
  showEditor(noteData: NoteData)
  hideEditor()
  flushAndGetContent(): string
  getRawContent(): string
  setRawContent(content: string)
  setDirty(val: boolean)
  getCurrentNoteId(): string | null

Internal (module-private):
  switchTab(tab)
  updateTabButtons()
  handleMetaFieldChange()
  handleAddCustomField()
  handleRemoveCustomField(key)
  flushPendingMeta()

State (module-private):
  _currentNoteId: string | null
  _activeTab: 'raw' | 'meta'
  _pendingMeta: PendingMeta
  _pendingMetaDirty: boolean
  _onDirty: (() => void) | null
```

**What moves from ui.ts:**
- Lines 71–117  (initPanels)
- Lines 87–117  (_currentNoteId, _activeTab, _pendingMeta, _pendingMetaDirty, _onDirty)
- Lines 166–249 (showEditor, hideEditor, flushAndGetContent, getRawContent, setRawContent, setDirty, getCurrentNoteId)
- Lines 254–332 (switchTab, updateTabButtons, handleMetaFieldChange, handleAddCustomField, handleRemoveCustomField, flushPendingMeta)

**What stays in ui.ts:**
- `bindEvents` wires `note-changed` listener → calls `store.updateContent(editor.getRawContent())`
- Re-exports `initPanels` so `app.ts` doesn't need a second import

### New file: `sidebar-chrome.ts` (~50 lines)

Extracts sidebar shell operations — the DOM chrome around `#file-list`, not what gets rendered inside it.

```
Exports:
  renderFileList(notes, currentId)   // delegates to currentView
  setActiveFile(id)
  updateNoteCount(total, shown)      // delegates to currentView
  setSidebarLoading(loading: boolean)
  toggleSidebar()
  clearSearch()
  setCurrentView(view: SidebarView)  // switches the active sidebar view
```

**State (module-private):**
- `currentView: SidebarView | null`

**What moves from ui.ts:**
- Lines 62–68  (currentView + `let` declarations for it)
- Lines 119–162 (renderFileList, setActiveFile, updateNoteCount, setSidebarLoading, toggleSidebar, clearSearch)

### What stays in ui.ts (~290 lines)

| Section | Lines |
|---------|-------|
| DOM refs (`$()` calls for header, buttons, statusbar, etc.) | ~30 |
| Status bar (`setStatus`, `setOffline`, `setSyncStatus`) | ~30 |
| Toast | ~10 |
| Modal delegation (`openModal`, `closeModal`, etc.) | ~25 |
| Login screen delegation (`showLoginScreen`, `showAppShell`, etc.) | ~20 |
| Sidebar mode toggle (`_sidebarMode`, `getSidebarMode()`, `setSidebarMode()`) (future: trash) | ~25 |
| Trash count badge (`setTrashCount`) (future: trash) | ~10 |
| `bindEvents` (wiring hub) | ~100 |
| Re-exports from editor / sidebar-chrome | ~15 |
| Trash sidebar toolbar swap (future: trash) | ~15 |

---

## Part 2: Split app.ts → app.ts + pwa.ts + app-auth.ts

### New file: `pwa.ts` (~60 lines)

Extracts the service worker registration and update logic.

```
Exports:
  initPwa(): Promise<void>   // registers SW, sets up updatefound listener
  updateApp(): Promise<void> // forces SW update + skipWaiting + reload
```

**What moves from app.ts:**
- Lines 386–446 (`swRegistration` state, `'serviceWorker' in navigator` block, `handleUpdateApp`)

### New file: `app-auth.ts` (~60 lines)

Extracts auth lifecycle handlers.  Accepts callbacks for UI transitions to
avoid a circular dependency (the UI transition functions `showApp` and
`showLogin` stay in `app.ts` because they call `refreshList`, `syncStart`,
and `cross-tab` which all live there).

```
Exports:
  handleLogin(username, password, onSuccess): Promise<void>
    - Calls login(), shows loading/error states, calls onSuccess() on ok
  handleLogout(): Promise<void>
    - Calls logout() — auth.ts fires onAuthFailure listeners automatically,
      which app.ts already hooks to showLogin()
  handleSignIn(): void
    - Shows the login screen
  handleDismissLogin(): void
    - Hides the login screen
```

**What moves from app.ts:**
- `handleLogin`  (lines 270–285) — refactored to take `onSuccess` callback
- `handleLogout` (lines 301–304) — unchanged, just calls `logout()` from auth.ts
- `handleSignIn` (lines 295–298)
- `handleDismissLogin` (lines 288–292)

**What stays in app.ts:**
- `showApp(hasSession)` (lines 222–261) — calls `refreshList`, stays here
- `showLogin()` (lines 263–266) — calls `stopSync`, stays here
- `onAuthFailure` handler (line 331–337) — calls `showLogin()`, stays here
- `showApp(true)` is passed as the `onSuccess` callback to `handleLogin`
- `handleLogout` needs no callback; `logout()` → `notifyAuthFailure()` → `showLogin()`

### What stays in app.ts (~370 lines)

| Section | Lines |
|---------|-------|
| `refreshList`, `openFile` | ~25 |
| `saveFile`, `deleteFile`, `handleRenameClick`, `handleRenameConfirm` | ~50 |
| `createFile` | ~20 |
| `handleSearch` | ~6 |
| `handleCrossTabChange` + helpers (`reloadOpenNote`, `reloadOpenNoteAs`) | ~45 |
| `showApp` (boot shell — calls refreshList, syncStart, cross-tab) | ~40 |
| `showLogin` (stopSync + showLoginScreen) | ~5 |
| Store subscriptions (`store.on`) | ~5 |
| Sync status → UI (`onSyncStatus`, `onRemoteChange`) | ~20 |
| Auth failure handler (`onAuthFailure`) | ~10 |
| Wiring (`ui.bindEvents({...})`) — passes callbacks to app-auth handlers | ~45 |
| View History button binding | ~15 |
| Trash handlers (toggle, restore, purge, empty) (future: trash) | ~20 |
| `boot()` | ~30 |
| Init panels | ~5 |
| `note-changed` listener | ~5 |

---

## Part 3: Split history.ts → history-service.ts + history-view.ts + diff.ts

Current `history.ts` is 577 lines — a single file mixing network, algorithm, and
a 360-line self-contained DOM widget (`buildModal`). Same service/view split
as the trash plan.

### New file: `diff.ts` (~50 lines)

Pure algorithm. Zero dependencies. Reusable by trash content preview.

```
Types:
  DiffLine = { type: '+' | '-' | ' '; text: string }

Exports:
  computeDiff(a: string, b: string): DiffLine[]
```

**What moves:** lines 27–30 (DiffLine type) + 75–114 (computeDiff function).

---

### New file: `history-service.ts` (~55 lines)

Data fetching. Has its own `authFetch` wrapper (lazy-loaded, avoids coupling
to the main auth module's state).

```
Types:
  VersionMeta       = { key, author, saved_at, prev }
  VersionListResponse = { ok, current, versions: VersionMeta[] }

Exports:
  fetchVersionList(id): Promise<VersionListResponse>
  fetchVersionContent(id, versions): Promise<Record<string, string|null>>
```

**What moves:** lines 14–25 (types) + 38–66 (authFetch + fetch functions).

---

### New file: `history-view.ts` (~440 lines)

All DOM, state management, and event handling. Entry point.

```
Imports:
  fetchVersionList, fetchVersionContent         from history-service.ts
  VersionMeta, VersionListResponse (types only)  from history-service.ts
  computeDiff, DiffLine (types)                  from diff.ts

Types:
  HistoryCallbacks = { onRestore: (content: string) => void }

Exports:
  open(noteId: string, callbacks: HistoryCallbacks): Promise<void>
    - Fetches version list, shows loading/error/empty states
    - Delegates to buildModal() on success

Internal:
  formatDate(ts: number): string
  esc(s: string): string
  renderBranchConnectors(listEl, metaList)
  buildModal(noteId, metaList, currentKey, callbacks): HistoryModal
    - All DOM construction, state (selectedKey, diffTargetKey, contentCache)
    - Diff rendering, restore/popout actions
    - Close handlers (Esc, click-outside)
```

**What moves:** lines 118–129 (formatDate, esc) + 138–498 (buildModal, with
renderBranchConnectors internal) + 510–576 (open entry point).

---

### `history.ts` — deleted

`app.ts` switches from `await import('./history.js')` to
`await import('./history-view.js')`. No backward compat shim — just
update the one call site.

---

### Line count summary

| File | Before | After |
|------|--------|-------|
| `history.ts` | 577 | *deleted* |
| `diff.ts` | — | ~50 |
| `history-service.ts` | — | ~55 |
| `history-view.ts` | — | ~440 |

Total: 577 → ~545.

---

### Pairs with the trash plan

Same three-file pattern, same architectural reasoning:

| Concern | History | Trash |
|---------|---------|-------|
| Pure algorithm | `diff.ts` | *n/a (no diff needed)* |
| Data fetching | `history-service.ts` | `trash-service.ts` |
| DOM rendering | `history-view.ts` | `trash-view.ts` |

---

## Implementation order

1. **`diff.ts`** — extract from `history.ts`, zero deps, trivially testable
2. **`editor.ts`** — extract from `ui.ts`
3. **`sidebar-chrome.ts`** — extract from `ui.ts`
4. **`history-service.ts`** — extract from `history.ts`
5. **`history-view.ts`** — extract from `history.ts`, delete old file
6. **`pwa.ts`** — extract from `app.ts`
7. **`app-auth.ts`** — extract from `app.ts`

Each step is independently testable — the app should build and run identically after each one.

---

## Public API surface (what other modules import)

Before refactor, `app.ts` imports from `ui.ts`:

```
import * as ui from './ui.js'
// uses: ui.bindEvents, ui.initPanels, ui.showEditor, ui.hideEditor,
//       ui.showAppShell, ui.showLoginScreen, ui.setOffline, ui.setSyncStatus,
//       ui.setSidebarLoading, ui.setDirty, ui.toast, ui.setStatus,
//       ui.openModal, ui.closeModal, ui.openRenameModal, ui.setModalError,
//       ui.setModalHint, ui.getModalValue, ui.flushAndGetContent, ui.getRawContent,
//       ui.setRawContent, ui.clearSearch, ui.renderFileList, ui.updateNoteCount,
//       ui.getCurrentNoteId, ui.setActiveFile, ui.setLoginError, ui.setLoginLoading,
//       ui.hideLoginScreen, ui.showOfflineFirstVisit
```

After refactor, `app.ts` imports:

```
import * as ui      from './ui.js'           // bindEvents, setStatus, setOffline, toast, etc.
import * as editor  from './editor.js'       // initPanels, showEditor, hideEditor, flushAndGetContent, etc.
import * as sidebar from './sidebar-chrome.js' // renderFileList, setSidebarLoading, updateNoteCount, etc.
import * as login   from './login-screen.js'  // showLoginScreen, showAppShell, hideLoginScreen, etc.
import * as pwa     from './pwa.js'          // initPwa (called from boot)
import * as appAuth from './app-auth.js'     // handleLogin, handleLogout, handleSignIn, handleDismissLogin
```

`ui.ts` re-exports from `editor` and `sidebar-chrome` so any third-party consumer
of `ui.*` doesn't break — but `app.ts` imports them directly to make the
dependency graph explicit.

### history.ts call site

`app.ts` changes one line:

```
// before
const { open } = await import('./history.js');

// after
const { open } = await import('./history-view.js');
```

`history.ts` is deleted. `diff.ts` is imported directly by any module that
needs `computeDiff` (e.g. trash content preview).
