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
import { loadConfig, fetchSpaConfig, getSpaConfig } from './config.js';
import { loadPlugins } from './markdown.js';
import { loadTrashEntries } from './trash-ctrl.js';

import * as loginCtrl  from './login-ctrl.js';
import * as notesCtrl  from './notes-ctrl.js';
import * as trashCtrl  from './trash-ctrl.js';

// ── Editor state (current note, content, dirty flag) ─────────────────────

let _current: string | null = null;
let _content = '';
let _dirty   = false;

/** Track textarea content changes — called by textarea event listeners. */
function updateContent(newContent: string): void {
  _content = newContent;
  if (_current === null) return;
  if (!_dirty) {
    _dirty = true;
    ui.setDirty(true);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function clearEditorState(): void {
  _current = null;
  _content = '';
  _dirty   = false;
}

function updateTrashCount(): void {
  loadTrashEntries().then(e => ui.setTrashCount(e.length));
}

// ── Cross-tab helpers ─────────────────────────────────────────────────────

async function reloadOpenNote(id: string): Promise<void> {
  try {
    const data: NoteData = await notes.loadNote(id);
    if (data.content === _content) return;
    _current = id;
    _content = data.content;
    _dirty   = false;
    ui.showEditor(data);
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
    _dirty   = false;
    ui.showEditor(data);
    ui.setActiveNote(newId);
  } catch {
    clearEditorState();
    ui.hideEditor();
  }
}

// ── Cross-tab change handler ──────────────────────────────────────────────

async function handleChange(msg: import('./change-bus.js').ChangeEvent): Promise<void> {
  const currentId = _current;
  const inTrashMode = sidebar.getMode() === 'trash';

  switch (msg.type) {
    case 'saved':
    case 'created': {
      await notesCtrl.refreshList(currentId);
      if (currentId && currentId === msg.id && !_dirty) {
        await reloadOpenNote(currentId);
      }
      break;
    }

    case 'deleted': {
      if (inTrashMode) {
        await trashCtrl.refreshTrashList();
      } else {
        await notesCtrl.refreshList();
        updateTrashCount();
        if (currentId && currentId === msg.id) {
          clearEditorState();
          ui.hideEditor();
          ui.toast(`"${msg.id}" was deleted in another tab`);
        }
      }
      break;
    }

    case 'renamed': {
      const newId = msg.newId;
      await notesCtrl.refreshList(newId);
      if (currentId && currentId === msg.id && newId && !_dirty) {
        await reloadOpenNoteAs(newId);
        ui.toast(`Renamed to "${newId}" in another tab`);
      }
      break;
    }

    case 'restored': {
      if (inTrashMode) {
        await trashCtrl.refreshTrashList();
      } else {
        await notesCtrl.refreshList(currentId);
        updateTrashCount();
        if (currentId && currentId === msg.id && !_dirty) {
          await reloadOpenNote(currentId);
        }
      }
      break;
    }

    case 'trash-emptied': {
      if (inTrashMode) {
        await trashCtrl.refreshTrashList();
        ui.toast('Trash was emptied in another tab');
      } else {
        ui.setTrashCount(0);
      }
      break;
    }

    case 'server-sync': {
      if (inTrashMode) {
        await trashCtrl.refreshTrashList();
      } else {
        await notesCtrl.refreshList(currentId);
        updateTrashCount();
        if (currentId && !_dirty) {
          await reloadOpenNote(currentId);
        }
      }
      break;
    }
  }
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
      if (_dirty && !confirm('You have unsaved changes. Discard?')) return;
      try {
        const data = await notesCtrl.openNote(id);
        _current = id;
        _content = data.content;
        _dirty   = false;
        ui.setDirty(false);
      } catch { /* error toast handled in openNote */ }
    },
    onDelete:        async id => {
      const { wasCurrent } = await notesCtrl.deleteNote(id);
      if (wasCurrent) {
        _current = null;
        _content = '';
        _dirty   = false;
        ui.setDirty(false);
      }
    },
    onSearch:        q        => notesCtrl.handleSearch(q),
    onSave:          async () => {
      if (!_current) return;
      await notesCtrl.saveNote(_current);
      _dirty = false;
      ui.setDirty(false);
    },
    onNew:           ()       => modal.openModal(ui.getCurrentNoteId(), ''),
    onCreate:        ()       => notesCtrl.createNote(),
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

  subscribe(event => {
    ui.setSidebarLoading(false);
    handleChange(event).catch(err =>
      console.warn('[change-bus] Handler error:', err)
    );
  });

  document.addEventListener('note-changed', () =>
    updateContent(ui.getRawContent())
  );

  document.addEventListener('navigate-note', async (e) => {
    const id = (e as CustomEvent).detail?.id as string | undefined;
    if (!id) return;

    // Same dirty-check flow as the sidebar onOpen handler
    if (_dirty && !confirm('You have unsaved changes. Discard?')) return;

    const existing = await dbGetNote(id);
    if (!existing) {
      // Note doesn't exist yet — open create modal with name pre-filled.
      modal.openModal(null, id);
      return;
    }

    // Note exists — open it normally
    try {
      const data = await notesCtrl.openNote(id);
      _current = id;
      _content = data.content;
      _dirty   = false;
      ui.setDirty(false);
    } catch (err) {
      console.warn('[app] navigate-note failed:', err);
    }
  });

  document.getElementById('btn-view-history')?.addEventListener('click', async () => {
    const id = _current;
    if (!id) return;
    try {
      const { open } = await import('./history.js');
      open(id, {
        onRestore: (content: string) => {
          ui.setRawContent(content);
          updateContent(content);
        },
      });
    } catch (err) {
      ui.toast(`Failed to open history: ${(err as Error).message}`, true);
    }
  });

  ui.initPanels(() => updateContent(ui.getRawContent()));
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

  _dirty = false;
  ui.setDirty(false);

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
