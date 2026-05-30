/**
 * app.ts — entry point
 *
 * ── Boot sequence ─────────────────────────────────────────────────────────
 *
 * Phase 1 — Show shell (always, no session required):
 *   1. Derive namespace (loadConfig), wire UI events, init PWA
 *   2. Show app shell, load local notes from IndexedDB
 *   3. Fetch SPA config in background
 *
 * Phase 2 — Try to restore session:
 *   4a. Session restored → show username, start sync
 *   4b. Auth failed      → show login screen
 *   4c. Network error    → stay in offline mode (shell already visible)
 *
 * Auth events:
 *   onAuthFailure → stop sync, show login screen
 *   login success → hide login screen, upgrade shell, start sync
 *   logout        → stop sync, clear UI, show login screen
 */

import * as ui       from './ui.js';
import * as pwa      from './pwa.js';
import * as sidebar  from './sidebar.js';
import * as modal    from './modal.js';
import * as loginView from './login-view.js';
import * as notes    from './notes.js';
import type { NoteData } from './notes.js';
import { db, dbPurgeDeletedNotes, dbGetNote } from './db.js';
import { syncStart, stopSync, clearRevision, onSyncStatus } from './sync.js';
import { getUsername, tryRestoreSession, onAuthFailure } from './auth.js';
import { subscribe } from './change-bus.js';
import { handleChange } from './change-handler.js';
import type { ChangeHandlerDeps } from './change-handler.js';
import { loadConfig, fetchSpaConfig, getSpaConfig, getAutosaveConfig, getEditTimeConfig } from './config.js';
import { loadPlugins } from './markdown.js';
import { loadTrashEntries } from './trash-ctrl.js';
import { DOM, $, $maybe } from './dom-ids.js';
import { parseFrontmatter, stripFrontmatterKey, updateFrontmatter } from './frontmatter.js';

import * as loginCtrl  from './login-ctrl.js';
import * as notesCtrl  from './notes-ctrl.js';
import * as trashCtrl  from './trash-ctrl.js';
import * as editTime   from './edit-time.js';
import * as navHistory  from './nav-history.js';
import { lastNote }      from './local-store.js';

// ── Last-note persistence ──────────────────────────────────────────────────

/** Persist the last opened note ID to localStorage (scoped to install path). */
function persistLastNote(id: string): void {
  lastNote.set(id);
}

/**
 * Restore the last opened note on boot.
 * @returns true if a note was restored, false otherwise.
 */
async function restoreLastNote(): Promise<boolean> {
  const lastId = lastNote.get();
  if (!lastId) return false;

  const existing = await dbGetNote(lastId);
  if (!existing) {
    // Note no longer exists — clean up stale key
    lastNote.remove();
    return false;
  }

  try {
    activateNote(lastId, await notes.loadNote(lastId));
    return true;
  } catch {
    return false;
  }
}

// ── Editor state (current note, content, auto-save) ──────────────────────

let _current: string | null = null;
let _content = '';

// ── Auto-save debounce ────────────────────────────────────────────────────

let _autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let _savePending = false;

/** Called on every keystroke/change. Resets the auto-save countdown. */
function scheduleAutoSave(newContent: string): void {
  // Reset edit-time inactivity timer on any content change.
  editTime.noteActivity();

  // Honour the enabled flag — if disabled, revert to manual-save behaviour.
  const cfg = getAutosaveConfig();
  if (!cfg.enabled) {
    _content = newContent;
    if (_current !== null && !_savePending) {
      _savePending = true;
      ui.setDirty(true);
    }
    return;
  }
  // Strip edit-time before comparing so timer drift doesn't look like a
  // content change (would cause spurious auto-saves and server versions).
  if (stripFrontmatterKey(newContent, 'edit-time') === stripFrontmatterKey(_content, 'edit-time')) return;
  _content = newContent;
  if (_current === null) return;
  if (!_savePending) {
    _savePending = true;
    ui.setDirty(true);
  }
  if (_autoSaveTimer !== null) clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => doAutoSave(), cfg.delay_ms);
}

/**
 * Fire auto-save. Silent — no toast.
 * Called by the debounce timer. Ctrl+S goes through notesCtrl.saveNote
 * which shows a toast for explicit saves.
 */
async function doAutoSave(): Promise<void> {
  if (_autoSaveTimer !== null) {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
  }
  if (!_current) return;
  const content = getContentWithEditTime();
  if (!content.trim()) return; // don't save empty content

  await notes.saveNote(_current, content);
  _content = content;  // keep cache in sync with DB (includes merged edit-time)
  _savePending = false;
  ui.setDirty(false);
  ui.setStatus('Saved');
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Get editor content with current edit-time merged into frontmatter. */
function getContentWithEditTime(): string {
  let content = ui.flushAndGetContent();
  const et = editTime.getCurrentSeconds();
  if (et > 0) {
    content = updateFrontmatter(content, { 'edit-time': String(et) });
  }
  return content;
}

function clearEditorState(): void {
  _current = null;
  _content = '';
  _savePending = false;
  if (_autoSaveTimer !== null) {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
  }
}

/**
 * Save the current note if there are pending changes, then stop edit-time
 * tracking.  Called before navigating away from the current note.
 */
async function saveAndStop(): Promise<void> {
  if (_current && _savePending) {
    if (_autoSaveTimer !== null) {
      clearTimeout(_autoSaveTimer);
      _autoSaveTimer = null;
    }
    await doAutoSave();
  }
  editTime.stop();
}

/**
 * Activate a fully-loaded note in the editor.
 * Sets all app-level state, shows the editor, highlights the sidebar,
 * pushes nav history, persists last-note, and starts edit-time tracking.
 */
function activateNote(id: string, data: NoteData): void {
  _current = id;
  _content = data.content;
  _savePending = false;
  if (_autoSaveTimer !== null) {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
  }
  ui.setDirty(false);
  ui.showEditor(data);
  ui.setActiveNote(id);
  navHistory.push(id);
  persistLastNote(id);
  const existingSec = parseInt(data.meta['edit-time'] as string || '0', 10) || 0;
  editTime.start(id, existingSec, getEditTimeConfig().inactivity_sec);
}

function updateTrashCount(): void {
  loadTrashEntries().then(e => ui.setTrashCount(e.length));
}

// ── Cross-tab helpers ─────────────────────────────────────────────────────

async function reloadOpenNote(id: string): Promise<void> {
  try {
    const data: NoteData = await notes.loadNote(id);
    // Strip edit-time before comparing — server version may have newer
    // edit-time from another client, but the body/metadata may be identical.
    if (stripFrontmatterKey(data.content, 'edit-time') === stripFrontmatterKey(_content, 'edit-time')) return;
    _current = id;
    _content = data.content;
    _savePending = false;
    ui.setDirty(false);
    // In-place refresh — no tab switch, no note-changed, preserves cursor.
    ui.refreshActiveTab(data);
  } catch {
    clearEditorState();
    ui.hideEditor();
  }
}

async function reloadOpenNoteAs(newId: string): Promise<void> {
  try {
    const data: NoteData = await notes.loadNote(newId);
    _current = newId;
    _content = data.content;
    _savePending = false;
    ui.setDirty(false);
    ui.refreshActiveTab(data);
    ui.setActiveNote(newId);
  } catch {
    clearEditorState();
    ui.hideEditor();
  }
}

// ── Change-handler dependencies (captured once per event) ────────────────

function buildChangeHandlerDeps(): ChangeHandlerDeps {
  return {
    currentId: _current,
    isTrashMode: sidebar.getMode() === 'trash',
    reloadCurrentNote: () => reloadOpenNote(_current!),
    reloadNoteAs: (newId: string) => reloadOpenNoteAs(newId),
    editorNoteId: () => ui.getCurrentNoteId(),
    refreshSidebar: () => notesCtrl.refreshList(),
    refreshTrash: () => trashCtrl.refreshTrashList(),
    clearEditor: () => { clearEditorState(); ui.hideEditor(); },
    updateTrashCount: () => updateTrashCount(),
    toast: (msg: string) => ui.toast(msg),
    setTrashCount: (n: number) => ui.setTrashCount(n),
    navRemove: (id: string) => navHistory.remove(id),
    setActiveNote: (id: string) => ui.setActiveNote(id),
  };
}

// ── Sync status → UI ─────────────────────────────────────────────────────

onSyncStatus((statusText, isOnline) => {
  ui.setOffline(!isOnline);
  ui.setSyncStatus(statusText);
  if (statusText === 'SYNCING') ui.setStatus('Syncing…', 2000);
  if (statusText === 'IDLE' || statusText === 'ERROR' || statusText === 'OFFLINE') {
    ui.setSidebarLoading(false);
  }
  if (statusText === 'ERROR') ui.toast('Sync error — will retry shortly', true);
});

// ── Auth failure → show login ─────────────────────────────────────────────

onAuthFailure(() => {
  stopSync();
  if (navigator.onLine) loginView.showLoginScreen();
});

// ── PWA / DB reset ───────────────────────────────────────────────────────

async function handleResetDB(): Promise<void> {
  if (!confirm('This will delete all local data and re-download everything from the server. Continue?')) return;
  stopSync();
  clearRevision();
  try { await db.delete(); } catch (err) { console.warn('[app] DB delete error:', err); }
  location.reload();
}

// ── Wiring ────────────────────────────────────────────────────────────────

function wireUiEvents(): void {
  ui.bindEvents({
    onOpen:          async id => {
      await saveAndStop();
      try {
        activateNote(id, await notes.loadNote(id));
      } catch { /* error toast handled in openNote */ }
    },
    onDelete:        async id => {
      const { wasCurrent } = await notesCtrl.deleteNote(id);
      if (wasCurrent) {
        editTime.stop();
        clearEditorState();
        navHistory.remove(id);
      }
    },
    onSearch:        q        => notesCtrl.handleSearch(q),
    onSave:          async () => {
      // Force immediate save (Ctrl+S / button) — clear debounce, save with toast.
      if (_autoSaveTimer !== null) {
        clearTimeout(_autoSaveTimer);
        _autoSaveTimer = null;
      }
      if (!_current) return;

      const content = getContentWithEditTime();
      const result = await notes.saveNote(_current, content);
      _content = content;
      _savePending = false;
      ui.setDirty(false);
      if (result.ok) {
        ui.setStatus(`Saved "${_current}"`);
        ui.toast(`Saved "${_current}"`);
      }
    },
    onNew:           ()       => {
      const searchVal = ($(DOM.SEARCH) as HTMLInputElement).value;
      modal.openModal(ui.getCurrentNoteId(), searchVal);
    },
    onCreate:        async () => {
      // Persist pending changes + edit-time for the current note before
      // switching to the newly created one.
      if (_current && _savePending) {
        if (_autoSaveTimer !== null) {
          clearTimeout(_autoSaveTimer);
          _autoSaveTimer = null;
        }
        await doAutoSave();
      }
      editTime.stop();

      await notesCtrl.createNote();
      // Sync app-level state to the note just opened in the editor.
      _current = ui.getCurrentNoteId();
      _content = ui.getRawContent();
      _savePending = false;
      if (_autoSaveTimer !== null) {
        clearTimeout(_autoSaveTimer);
        _autoSaveTimer = null;
      }
      ui.setDirty(false);

      // Start edit-time tracking for the newly created note (starts at 0).
      if (_current) {
        editTime.start(_current, 0, getEditTimeConfig().inactivity_sec);
      }
    },
    onCancelModal:   ()       => modal.closeModal(),
    onLogin:         async (u, p) => { if (await loginCtrl.handleLogin(u, p)) showAppFull(); },
    onLogout:        ()       => loginCtrl.handleLogout(),
    onRename:        id       => notesCtrl.handleRename(id),
    onRenameConfirm: oldId    => notesCtrl.handleRenameConfirm(oldId),
    onResetDB:       ()       => handleResetDB(),
    onSignIn:        ()       => loginCtrl.handleSignIn(),
    onDismissLogin:  ()       => loginCtrl.handleDismissLogin(),
    onToggleTrash:   ()       => trashCtrl.handleToggleTrash(),
    onTrashPreview:  (id, src) => trashCtrl.handleTrashPreview(id, src),
    onTrashRestore:  (id, src) => trashCtrl.handleTrashRestore(id, src),
    onTrashPurge:    (id, src) => trashCtrl.handleTrashPurge(id, src),
    onTrashEmpty:    ()       => trashCtrl.handleTrashEmpty(),
  });

  // ── Back button ───────────────────────────────────────────────────────
  $maybe(DOM.BTN_BACK)?.addEventListener('click', () => handleBack());
}

/** Navigate to the previous note in the history stack. */
async function handleBack(): Promise<void> {
  const prevId = navHistory.pop();
  if (!prevId) return;

  await saveAndStop();
  try {
    activateNote(prevId, await notes.loadNote(prevId));
  } catch {
    ui.toast(`Failed to open "${prevId}"`, true);
  }
}

// ── Boot phases ───────────────────────────────────────────────────────────

/**
 * Phase 1: Show the app shell immediately. Loads local notes, wires
 * cross-tab listeners, registers PWA. No session required.
 */
async function showShell(): Promise<void> {
  loginView.showAppShell(null);

  notesCtrl.init(() => _current);

  dbPurgeDeletedNotes().catch(err =>
    console.warn('[purge] Failed to purge deleted notes:', err)
  );

  await notesCtrl.refreshList();
  updateTrashCount();

  // Restore the last opened note (persisted across page loads)
  restoreLastNote().catch(err =>
    console.warn('[boot] Failed to restore last note:', err)
  );

  subscribe(event => {
    ui.setSidebarLoading(false);
    handleChange(buildChangeHandlerDeps(), event).catch(err =>
      console.warn('[change-bus] Handler error:', err)
    );
  });

  document.addEventListener('note-changed', () =>
    scheduleAutoSave(ui.getRawContent())
  );

  document.addEventListener('navigate-note', async (e) => {
    const id = (e as CustomEvent).detail?.id as string | undefined;
    if (!id) return;

    const existing = await dbGetNote(id);
    if (!existing) {
      // Note doesn't exist yet — open create modal with name pre-filled.
      modal.openModal(null, id);
      return;
    }

    await saveAndStop();
    try {
      activateNote(id, await notes.loadNote(id));
    } catch (err) {
      console.warn('[app] navigate-note failed:', err);
    }
  });

  $maybe(DOM.BTN_VIEW_HISTORY)?.addEventListener('click', async () => {
    const id = _current;
    if (!id) return;
    try {
      const { open } = await import('./history.js');
      open(id, {
        onRestore: (content: string) => {
          ui.setRawContent(content);
          scheduleAutoSave(content);
          // Reset edit-time timer to the restored version's value.
          const fm = parseFrontmatter(content);
          const existingSec = parseInt(fm.meta['edit-time'] as string || '0', 10) || 0;
          editTime.start(id, existingSec, getEditTimeConfig().inactivity_sec);
        },
      });
    } catch (err) {
      ui.toast(`Failed to open history: ${(err as Error).message}`, true);
    }
  });

  ui.initPanels(() => scheduleAutoSave(ui.getRawContent()));
}

/** Phase 2: Upgrade shell to full-app mode (authenticated user). */
function showAppFull(): void {
  loginView.showAppShell(getUsername()!);
  syncStart();
}

// ── Entry point ───────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  loadConfig();

  wireUiEvents();

  pwa.initPwa().catch(err => console.warn('[boot] PWA init failed:', err));
  pwa.onUpdateFound(msg => ui.toast(msg));

  ui.setOffline(!navigator.onLine);

  // Phase 1: show shell immediately
  await showShell();

  // Fetch server config, then activate configured markdown plugins
  await fetchSpaConfig();
  const cfg = getSpaConfig();
  if (cfg.markdown.plugins?.length) {
    loadPlugins(cfg.markdown.plugins).catch(err =>
      console.warn('[boot] Plugin loading failed:', err)
    );
  }

  // Phase 2: try silent session restore
  const result = await tryRestoreSession();

  if (result === 'ok') {
    showAppFull();
  } else if (result === 'auth-failed') {
    loginView.showLoginScreen();
  }
  // network-error → stay offline, shell is already visible

  // ?action=new query param
  if (new URLSearchParams(location.search).get('action') === 'new') {
    window.addEventListener('load', () => modal.openModal(ui.getCurrentNoteId(), ''), { once: true });
  }
}

boot().catch(err => {
  console.error('[app] Boot failed:', err);
  ui.toast('Failed to start — try refreshing', true);
  stopSync();
  loginView.showLoginScreen();
});
