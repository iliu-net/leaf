# Auto-Save

## Overview

Replace the manual save workflow (Ctrl+S / Save button) with debounced
auto-save.  After the user stops typing for a configurable delay (default
2 s), the note is automatically persisted to IndexedDB.  Explicit saves
(Ctrl+S / button) still work as a force-flush.

When `enabled: false` is set in SpaConfig, the editor reverts to manual
save — the dirty dot appears as an unsaved warning, and the user must
press Ctrl+S or click Save.

## Motivation

Modern note-taking applications (Obsidian, Notion, Apple Notes) all
auto-save.  The manual-save model introduces friction: dirty-dot anxiety,
"Unsaved changes — discard?" dialogs on navigation, and `beforeunload`
guards that trap the user.

Because all writes go to IndexedDB first (zero network latency),
auto-save is both fast and fully offline-capable.  Sync to the server
happens asynchronously via the existing change-bus → sync pipeline.

---

## Design

### Debounce timer

```
User types → note-changed → scheduleAutoSave()
                              │
                              ▼
                         reset timer (cfg.delay_ms)
                              │
                    (delay_ms of no typing)
                              │
                              ▼
                         doAutoSave()
                              │
                              ▼
                   notes.saveNote(id, content)
                              │
                              ▼
                   dbGetNote(id) → content same?
                     │                  │
                     │ yes              │ no
                     ▼                  ▼
              return { ok: false }   dbSaveNote()
              (no DB write,          publish('saved')
               no broadcast)         sync picks it up
```

### Content-change guard

`notes.saveNote()` loads the existing record from IndexedDB and compares
content before writing.  If identical, it returns `{ ok: false }` without
touching the database or broadcasting.  This prevents:

- Unnecessary IndexedDB writes (and associated sync-queue entries)
- Spurious `'saved'` change-bus events
- The `handleChange` → `showEditor` → tab-switch chain reaction

### Tab preservation on cross-tab reload

When another tab modifies the currently-open note, the editor refreshes
in-place via `refreshActiveTab()` instead of calling `showEditor()`.
This preserves:

- The active tab (Code / View / Meta)
- Cursor position in CodeMirror
- Pending edits in the Meta tab

### Schedule guard

`scheduleAutoSave()` compares incoming content against `_content`.  If
they match, the timer is not restarted.  This prevents `showEditor` or
`setContent` from accidentally re-arming the auto-save timer after a
programmatic content update.

---

## SpaConfig

```ts
autosave?: {
  delay_ms?: number;   // debounce delay, default 2000
  enabled?: boolean;   // set false to disable, default true
}
```

Server-side (`config.php`):

```php
$spa_config['autosave'] = [
    'enabled'  => true,
    'delay_ms' => 2000,
];
```

---

## UI changes

| Element | Before | After |
|---|---|---|
| Save button | `disabled` until dirty; click to save | Always enabled; click = force save now |
| Dirty dot | Static amber dot (unsaved warning) | Pulsing amber dot (saving soon indicator) |
| Ctrl+S | Save | Force immediate save (clears debounce timer) |
| Navigate away with edits | `confirm('Unsaved changes. Discard?')` | No dialog — always safe |
| `beforeunload` guard | Warns on tab close | Removed |
| Toast | "Saved" on every save | Only on explicit saves (Ctrl+S / button); auto-saves are silent |

---

## Affected modules

| Module | Change |
|---|---|
| `app.ts` | Add `scheduleAutoSave()`, `doAutoSave()`; remove `_dirty` flag and all confirm dialogs; wire `note-changed` to debounce timer; read `getAutosaveConfig()` |
| `ui.ts` | Remove `beforeunload` listener |
| `editor-ctrl.ts` | `setDirty()` no longer toggles `btnSave.disabled`; add `refreshActiveTab()` for in-place cross-tab reloads |
| `edit-view.ts` | Add `setContentSilent()` (no `note-changed` dispatch) |
| `notes.ts` | `saveNote()` compares content before write; skips if identical |
| `notes-ctrl.ts` | `saveNote()` checks return value before toasting |
| `config.ts` | Add `autosave?` to `SpaConfig` interface, `DEFAULT_SPA_CONFIG`, and `getAutosaveConfig()` helper |
| `api/config.php` | Add `autosave` to production `$spa_config` |
| `demo/cookbook/api/config.php` | Add `autosave` to demo `$spa_config` |
| `tests/integration/config.php` | Add `autosave` to test `$spa_config` |
| `codemirror/setup.ts` | Cursor width increased to 3 px for visibility |
| `spa/index.html` | Remove `disabled` from Save button; update titles |
| `spa/css/app.css` | Dirty dot pulsing animation |
| `tests/spa/ui.test.js` | Remove `beforeunload` test; update `setDirty` tests |
