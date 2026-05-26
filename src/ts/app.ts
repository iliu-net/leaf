/**
 * app.ts — entry point
 *
 * Boot sequence:
 *   1. Try silent session restore via refresh cookie
 *   2a. Session restored → render sidebar from IndexedDB, start sync loop
 *   2b. No session       → show login screen
 *
 * Auth events:
 *   onAuthFailure → stop sync, show login screen
 *   login success → hide login screen, render sidebar, start sync loop
 *   logout        → stop sync, clear UI, show login screen
 */

import * as notes from './notes.js';
import * as store from './store.js';
import * as ui      from './ui.js';
import * as pwa     from './pwa.js';
import * as appAuth from './app-auth.js';
import { db, dbPurgeDeletedNotes } from './db.js';
import { syncStart, syncNow, stopSync, clearRevision, onSyncStatus, onRemoteChange } from './sync.js';
import {
  getUsername, tryRestoreSession, onAuthFailure,
} from './auth.js';
import { safeName } from './utils.js';
import type { NoteData } from './notes.js';
import { onCrossTabChange } from './cross-tab.js';
import type { CrossTabMessage } from './cross-tab.js';
import { loadConfig } from './config.js';
import * as sidebar from './sidebar-chrome.js';
import { TrashView } from './trash-view.js';
import type { TrashEntry } from './trash-service.js';
import {
  loadTrashEntries, getTrashContent,
  restoreTrashItem, purgeTrashItem, emptyTrash,
  flushPendingPurges,
} from './trash-service.js';

// ── App state ─────────────────────────────────────────────────────────────

async function refreshList(selectId: string | null = null): Promise<void> {
  try {
    const items = await notes.listNotes();
    store.setNotes(items);
    ui.renderFileList(store.getNotes(), store.getCurrent());
    ui.updateNoteCount(store.getState().notes.length, store.getNotes().length);
    if (selectId) await openFile(selectId);
  } catch (err) {
    ui.toast(`Failed to load notes: ${(err as Error).message}`, true);
  }
}

async function openFile(id: string): Promise<void> {
  if (store.isDirty() && !confirm('You have unsaved changes. Discard?')) return;
  try {
    const data: NoteData = await notes.loadNote(id);
    store.openNote(id, data.content);
    ui.showEditor(data);
    ui.setActiveFile(id);
    ui.setDirty(false);
    ui.setStatus(`Opened "${id}"`);
  } catch (err) {
    ui.toast(`Could not open "${id}": ${(err as Error).message}`, true);
  }
}

async function saveFile(): Promise<void> {
  const id = store.getCurrent();
  if (!id) return;
  const content = ui.flushAndGetContent();
  try {
    await notes.saveNote(id, content);
    store.markClean();
    ui.setDirty(false);
    ui.setStatus(`Saved "${id}"`);
    ui.toast(`Saved "${id}"`);
    syncNow();
  } catch (err) {
    ui.toast(`Save failed: ${(err as Error).message}`, true);
  }
}

async function deleteFile(id: string): Promise<void> {
  if (!confirm(`Move "${id}" to trash?`)) return;
  try {
    await notes.deleteNote(id);
    if (store.getCurrent() === id) {
      store.closeNote();
      ui.hideEditor();
    }
    await refreshList();
    ui.setStatus(`Deleted "${id}"`);
    ui.toast(`Deleted "${id}"`);
    syncNow();
  } catch (err) {
    ui.toast(`Delete failed: ${(err as Error).message}`, true);
  }
}

async function handleRenameClick(id: string): Promise<void> {
  ui.openRenameModal(id);
}

async function handleRenameConfirm(oldId: string): Promise<void> {
  const raw = ui.getModalValue();
  if (!raw) { ui.setModalError('Please enter a name.'); return; }
  const newId = safeName(raw);
  if (!newId) { ui.setModalError('Name contains no valid characters.'); return; }
  if (newId === oldId) { ui.closeModal(); return; }
  try {
    await notes.renameNote(oldId, newId);
    ui.closeModal();
    await refreshList(newId);
    ui.toast(`Renamed to "${newId}"`);
    syncNow();
  } catch (err) {
    ui.setModalError((err as Error).message || 'Could not rename note.');
  }
}

// ── Cross-tab sync handler ─────────────────────────────────────────────────

/**
 * Handle a change notification from another tab via BroadcastChannel.
 * Re-reads IndexedDB and updates the UI accordingly.
 */
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
        await refreshTrashList();
      } else {
        await refreshList();
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
        ui.setTrashCount(0);
      }
      break;
    }

    case 'server-sync': {
      if (inTrashMode) {
        await refreshTrashList();
      } else {
        await refreshList(currentId);
        loadTrashEntries().then(e => ui.setTrashCount(e.length));
        if (currentId && !store.isDirty()) {
          await reloadOpenNote(currentId);
        }
      }
      break;
    }
  }
}

/**
 * Reload the currently-open note from IndexedDB and update the editor.
 * Called when another tab saved or server synced the note we have open.
 */
async function reloadOpenNote(id: string): Promise<void> {
  try {
    const data: NoteData = await notes.loadNote(id);
    if (data.content === store.getContent()) return; // nothing changed
    store.openNote(id, data.content);
    ui.showEditor(data);
  } catch {
    // Note may have been deleted in the other tab
    store.closeNote();
    ui.hideEditor();
  }
}

/**
 * Reload a note under a new id (after a rename in another tab).
 */
async function reloadOpenNoteAs(newId: string): Promise<void> {
  try {
    const data: NoteData = await notes.loadNote(newId);
    store.openNote(newId, data.content);
    ui.showEditor(data);
    ui.setActiveFile(newId);
  } catch {
    store.closeNote();
    ui.hideEditor();
  }
}

async function createFile(): Promise<void> {
  const raw = ui.getModalValue();
  if (!raw) { ui.setModalError('Please enter a name.'); return; }
  const name = safeName(raw);
  if (!name) { ui.setModalError('Name contains no valid characters.'); return; }
  ui.setModalHint(`Will be saved as: ${name}`);
  try {
    const data = await notes.createNote(name);
    ui.closeModal();
    ui.clearSearch();
    await refreshList(data.file);
    ui.toast(`Created "${data.file}"`);
    syncNow();
  } catch (err) {
    ui.setModalError((err as Error).message || 'Could not create note.');
  }
}

function handleSearch(query: string): void {
  store.setQuery(query);
  const filtered = store.getNotes();
  ui.renderFileList(filtered, store.getCurrent());
  ui.updateNoteCount(store.getState().notes.length, filtered.length);
}

// ── Trash helpers ───────────────────────────────────────────────────────────

async function refreshTrashList(): Promise<void> {
  const entries = await loadTrashEntries();
  TrashView.render(entries, null);
  sidebar.setCurrentView(TrashView);
  ui.setTrashCount(entries.length);
}

async function handleToggleTrash(): Promise<void> {
  if (ui.getSidebarMode() === 'trash') {
    ui.setSidebarMode('notes');
    ui.hideTrashBanner();
    await refreshList();
  } else {
    ui.setSidebarMode('trash');
    await refreshTrashList();
  }
}

async function handleTrashPreview(id: string, source: 'local' | 'server'): Promise<void> {
  const result = await getTrashContent(id, source);
  if (!result) {
    ui.toast('Content not available', true);
    return;
  }
  ui.showTrashBanner(id, result.content, {
    created_at: result.created_at,
    updated_at: result.updated_at,
    created_by: result.created_by,
    updated_by: result.updated_by,
    current: result.current,
  },
    () => handleTrashRestore(id, source),
    () => handleTrashPurge(id, source),
  );
}

async function handleTrashRestore(id: string, source: 'local' | 'server'): Promise<void> {
  try {
    await restoreTrashItem(id, source);
    ui.hideTrashBanner();
    ui.setSidebarMode('notes');
    await refreshList(id);
    ui.toast(`Restored "${id}"`);
  } catch (err) {
    ui.toast(`Restore failed: ${(err as Error).message}`, true);
  }
}

async function handleTrashPurge(id: string, source: 'local' | 'server' | 'both'): Promise<void> {
  if (!confirm(`Permanently delete "${id}"? This cannot be undone.`)) return;
  await purgeTrashItem(id, source);
  ui.hideTrashBanner();
  await refreshTrashList();
  ui.toast(`Permanently deleted "${id}"`);
}

async function handleTrashEmpty(): Promise<void> {
  if (!confirm('Permanently delete ALL items in trash?')) return;
  await emptyTrash();
  ui.hideTrashBanner();
  await refreshTrashList();
  ui.toast('Trash emptied');
}

// ── Auth screens ──────────────────────────────────────────────────────────

async function showApp(hasSession: boolean = false): Promise<void> {
  ui.showAppShell(hasSession ? getUsername() : null);

  // Purge stale soft-deleted notes from IndexedDB (fire-and-forget)
  dbPurgeDeletedNotes().catch(err =>
    console.warn('[purge] Failed to purge deleted notes:', err)
  );

  // Check if IndexedDB is empty — first visit has no local notes yet
  const localCount = await db.notes.count();
  const isFirstVisit = localCount === 0;

  // Render whatever is already local (instant — empty on first visit)
  await refreshList();

  // Initialize trash count badge
  loadTrashEntries().then(entries => ui.setTrashCount(entries.length));

  // When coming back online, flush any server-side tombstones that were
  // permanently deleted while offline.
  window.addEventListener('online', () => {
    flushPendingPurges().catch(err =>
      console.warn('[trash] flushPendingPurges failed:', err)
    );
  });

  // Show loading indicator only on first visit while sync pulls from server
  if (isFirstVisit && navigator.onLine && hasSession) {
    ui.setSidebarLoading(true);
  }

  // On first visit when offline and no session, show inline prompt
  if (isFirstVisit && !navigator.onLine && !hasSession) {
    ui.showOfflineFirstVisit();
  }

  // Start sync only if we have a valid session
  if (hasSession) {
    syncStart().catch(err => {
      console.error('[sync] Start failed:', err);
      ui.setSidebarLoading(false);
    });
  }

  // Listen for changes from other tabs via BroadcastChannel
  onCrossTabChange(msg => {
    handleCrossTabChange(msg).catch(err =>
      console.warn('[cross-tab] Handler error:', err)
    );
  });
}

function showLogin(): void {
  stopSync();
  ui.showLoginScreen();
}

// ── Auth handlers (delegated to app-auth.ts) ───────────────────────────────

// ── Store subscriptions ───────────────────────────────────────────────────

store.on('dirty-changed',  val => ui.setDirty(val as boolean));
store.on('online-changed', val => ui.setOffline(!(val as boolean)));

// ── Sync status → UI ─────────────────────────────────────────────────────

onSyncStatus((statusText, isOnline) => {
  store.setOnline(isOnline);
  ui.setSyncStatus(statusText);
  if (statusText === 'SYNCING') ui.setStatus('Syncing…', 2000);
  // Hide the first-visit loading indicator once sync resolves
  if (statusText === 'IDLE' || statusText === 'ERROR' || statusText === 'OFFLINE') {
    ui.setSidebarLoading(false);
  }
  if (statusText === 'ERROR') ui.toast('Sync error — will retry shortly', true);
});

onRemoteChange(() => {
  ui.setSidebarLoading(false);
  if (ui.getSidebarMode() === 'trash') {
    refreshTrashList();
  } else {
    refreshList();
    loadTrashEntries().then(entries => ui.setTrashCount(entries.length));
  }
});

// ── Auth failure → show login ─────────────────────────────────────────────

onAuthFailure(() => {
  stopSync();
  if (navigator.onLine) {
    ui.showLoginScreen();
  }
  // If offline, auth failure is expected — silently stay in offline mode
});

// ── UI event wiring ───────────────────────────────────────────────────────

ui.bindEvents({
  onOpen:          id       => openFile(id),
  onDelete:        id       => deleteFile(id),
  onSearch:        q        => handleSearch(q),
  onSave:          ()       => saveFile(),
  onNew:           ()       => ui.openModal(),
  onCreate:        ()       => createFile(),
  onCancelModal:   ()       => ui.closeModal(),
  onLogin:         (u, p)   => appAuth.handleLogin(u, p, () => showApp(true)),
  onLogout:        ()       => appAuth.handleLogout(),
  onRename:        id       => handleRenameClick(id),
  onRenameConfirm: oldId    => handleRenameConfirm(oldId),
  onResetDB:       ()       => handleResetDB(),
  onSignIn:        ()       => appAuth.handleSignIn(),
  onDismissLogin:  ()       => appAuth.handleDismissLogin(),
  onToggleTrash:   ()       => handleToggleTrash(),
  onTrashPreview:  (id, src) => handleTrashPreview(id, src),
  onTrashRestore:  (id, src) => handleTrashRestore(id, src),
  onTrashPurge:    (id, src) => handleTrashPurge(id, src),
  onTrashEmpty:    ()       => handleTrashEmpty(),
});

// Initialize panels (tab system, meta panel, etc.)
ui.initPanels(() => store.updateContent(ui.getRawContent()));

// Listen for textarea changes (raw tab) — use getRawContent() for plain read
document.addEventListener('note-changed', () => store.updateContent(ui.getRawContent()));

// ── View History button ──────────────────────────────────────────────────
// Lazy-load the history module when the user clicks View History
document.getElementById('btn-view-history')?.addEventListener('click', async () => {
  const currentId = store.getCurrent();
  if (!currentId) return;
  try {
    const { open } = await import('./history-view.js');
    open(currentId, {
      onRestore: (content: string) => {
        ui.setRawContent(content);
        store.updateContent(content);  // marks dirty automatically
      },
    });
  } catch (err) {
    ui.toast(`Failed to open history: ${(err as Error).message}`, true);
  }
});

// ── PWA: service worker (delegated to pwa.ts) ──────────────────────────────

async function handleUpdateApp(): Promise<void> {
  const result = await pwa.updateApp();
  if (!result.ok) {
    ui.toast(result.message, true);
  }
}

async function handleResetDB(): Promise<void> {
  if (!confirm('This will delete all local data and re-download everything from the server. Continue?')) return;

  stopSync();
  clearRevision();
  try {
    await db.delete();
  } catch (err) {
    console.warn('[app] DB delete error (ignored on reload):', err);
  }
  location.reload();
}

if (new URLSearchParams(location.search).get('action') === 'new') {
  window.addEventListener('load', () => ui.openModal(), { once: true });
}

// ── Boot ──────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  // Must be first — derives namespace before any storage is accessed
  loadConfig();

  // Register service worker (fire-and-forget)
  pwa.initPwa().catch(err => console.warn('[boot] PWA init failed:', err));
  pwa.onUpdateFound(msg => ui.toast(msg));

  ui.setOffline(!navigator.onLine);

  // Always show the app shell first
  await showApp(false /* no session yet */);

  // Try to restore session silently in the background
  const result = await tryRestoreSession();

  if (result === 'ok') {
    // We have a session! Upgrade the UI and start sync
    ui.showAppShell(getUsername()!);
    syncStart();
  } else if (result === 'auth-failed') {
    // Server is reachable but session is invalid — user must sign in
    ui.showLoginScreen();
  }
  // result === 'network-error': server is unreachable, stay in offline mode
  // (app already visible, no gate, user can work locally)

  // Safety net: ensure dirty state is clean after boot.  Browser form
  // restoration can trigger spurious input events that mark content as
  // dirty even when no note is open.  This resets any such false flag.
  store.markClean();
}

boot().catch(err => {
  console.error('[app] Boot failed:', err);
  ui.toast('Failed to start — try refreshing', true);
  showLogin();
});
