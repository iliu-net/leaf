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
import * as ui    from './ui.js';
import { db, dbPurgeDeletedNotes } from './db.js';
import { syncStart, syncNow, stopSync, clearRevision, onSyncStatus, onRemoteChange } from './sync.js';
import {
  login, logout, getUsername,
  tryRestoreSession, onAuthFailure,
} from './auth.js';
import { safeName } from './utils.js';
import type { NoteData } from './notes.js';

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
  if (!confirm(`Delete "${id}"? This cannot be undone.`)) return;
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
}

function showLogin(): void {
  stopSync();
  ui.showLoginScreen();
}

// ── Login form handler ────────────────────────────────────────────────────

async function handleLogin(username: string, password: string): Promise<void> {
  ui.setLoginError('');
  ui.setLoginLoading(true);

  const result = await login(username, password);

  ui.setLoginLoading(false);

  if (!result.ok) {
    ui.setLoginError(result.error ?? '');
    return;
  }

  showApp(true);
}

// ── Dismiss login overlay ─────────────────────────────────────────────────

function handleDismissLogin(): void {
  ui.hideLoginScreen();
  // Stay in offline mode — user chose not to authenticate
}

// ── Manual sign-in trigger ────────────────────────────────────────────────

function handleSignIn(): void {
  ui.showLoginScreen();
}

// ── Logout handler ────────────────────────────────────────────────────────

async function handleLogout(): Promise<void> {
  await logout();
  // onAuthFailure will fire and call showLogin()
}

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
  refreshList();
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
  onLogin:         (u, p)   => handleLogin(u, p),
  onLogout:        ()       => handleLogout(),
  onRename:        id       => handleRenameClick(id),
  onRenameConfirm: oldId    => handleRenameConfirm(oldId),
  onUpdateSW:      ()       => handleUpdateApp(),
  onResetDB:       ()       => handleResetDB(),
  onSignIn:        ()       => handleSignIn(),
  onDismissLogin:  ()       => handleDismissLogin(),
});

// Initialize panels (tab system, meta panel, etc.)
ui.initPanels(() => store.updateContent(ui.getRawContent()));

// Listen for textarea changes (raw tab) — use getRawContent() for plain read
document.addEventListener('note-changed', () => store.updateContent(ui.getRawContent()));

// ── PWA: service worker ───────────────────────────────────────────────────

let swRegistration: ServiceWorkerRegistration | null = null;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(reg => {
      swRegistration = reg;
      console.log('[SW] Registered, scope:', reg.scope);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (worker) {
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              ui.toast('Update available — refresh to apply.');
            }
          });
        }
      });
    })
    .catch(err => console.warn('[SW] Registration failed:', err));
}

async function handleUpdateApp(): Promise<void> {
  if (!swRegistration) {
    ui.toast('No service worker registration found', true);
    return;
  }

  try {
    await swRegistration.update();

    // If a new worker is installing, wait for it to finish
    if (swRegistration.installing) {
      await new Promise<void>(resolve => {
        swRegistration!.installing!.addEventListener('statechange', () => {
          if (swRegistration?.installing?.state === 'installed') {
            resolve();
          }
        });
      });

      // Tell the waiting worker to activate immediately
      swRegistration.active?.postMessage({ action: 'SKIP_WAITING' });
    }

    location.reload();
  } catch (err) {
    ui.toast(`Update failed: ${(err as Error).message}`, true);
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
