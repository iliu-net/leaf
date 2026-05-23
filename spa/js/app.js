/**
 * app.js — entry point
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
import { db } from './db.js';
import { syncStart, syncNow, stopSync, onSyncStatus, onRemoteChange } from './sync.js';
import {
  login, logout, getUsername,
  tryRestoreSession, onAuthFailure,
} from './auth.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function safeName(raw) {
  let name = raw.replace(/\//g, ':');
  name = name.replace(/[^a-zA-Z0-9_\-\.$%'@~!(){}^#&`:]/g, '_');
  return name.slice(0, 80);
}

// ── App state ─────────────────────────────────────────────────────────────

async function refreshList(selectId = null) {
  try {
    const items = await notes.listNotes();
    store.setNotes(items);
    ui.renderFileList(store.getNotes(), store.getCurrent());
    ui.updateNoteCount(store.getState().notes.length, store.getNotes().length);
    if (selectId) await openFile(selectId);
  } catch (err) {
    ui.toast(`Failed to load notes: ${err.message}`, true);
  }
}

async function openFile(id) {
  if (store.isDirty() && !confirm('You have unsaved changes. Discard?')) return;
  try {
    const data = await notes.loadNote(id);
    store.openNote(id, data.content);
    ui.showEditor(id, data.content);
    ui.setActiveFile(id);
    ui.setDirty(false);
    ui.setStatus(`Opened "${id}"`);
  } catch (err) {
    ui.toast(`Could not open "${id}": ${err.message}`, true);
  }
}

async function saveFile() {
  const id = store.getCurrent();
  if (!id) return;
  const content = ui.getEditorContent();
  try {
    await notes.saveNote(id, content);
    store.markClean();
    ui.setDirty(false);
    ui.setStatus(`Saved "${id}"`);
    ui.toast(`Saved "${id}"`);
    syncNow();
  } catch (err) {
    ui.toast(`Save failed: ${err.message}`, true);
  }
}

async function deleteFile(id) {
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
    ui.toast(`Delete failed: ${err.message}`, true);
  }
}

async function createFile() {
  const raw = ui.getModalValue();
  if (!raw) { ui.setModalError('Please enter a name.'); return; }
  const name = safeName(raw);
  if (!name) { ui.setModalError('Name contains no valid characters.'); return; }
  ui.setModalHint(`Will be saved as: ${name}`);
  try {
    const data = await notes.createNote(name);
    ui.closeModal();
    await refreshList(data.file);
    ui.toast(`Created "${data.file}"`);
    syncNow();
  } catch (err) {
    ui.setModalError(err.message || 'Could not create note.');
  }
}

function handleSearch(query) {
  store.setQuery(query);
  const filtered = store.getNotes();
  ui.renderFileList(filtered, store.getCurrent());
  ui.updateNoteCount(store.getState().notes.length, filtered.length);
}

// ── Auth screens ──────────────────────────────────────────────────────────

async function showApp() {
  ui.showAppShell(getUsername());

  // Check if IndexedDB is empty — first visit has no local notes yet
  const localCount = await db.notes.count();
  const isFirstVisit = localCount === 0;

  // Render whatever is already local (instant — empty on first visit)
  await refreshList();

  // Show loading indicator only on first visit while sync pulls from server
  if (isFirstVisit && navigator.onLine) {
    ui.setSidebarLoading(true);
  }

  syncStart().catch(err => {
    console.error('[sync] Start failed:', err);
    ui.setSidebarLoading(false);
  });
}

function showLogin() {
  stopSync();
  store.closeNote();
  ui.hideEditor();
  ui.showLoginScreen();
}

// ── Login form handler ────────────────────────────────────────────────────

async function handleLogin(username, password) {
  ui.setLoginError('');
  ui.setLoginLoading(true);

  const result = await login(username, password);

  ui.setLoginLoading(false);

  if (!result.ok) {
    ui.setLoginError(result.error);
    return;
  }

  showApp();
}

// ── Logout handler ────────────────────────────────────────────────────────

async function handleLogout() {
  await logout();
  // onAuthFailure will fire and call showLogin()
}

// ── Store subscriptions ───────────────────────────────────────────────────

store.on('dirty-changed',  val => ui.setDirty(val));
store.on('online-changed', val => ui.setOffline(!val));

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

onAuthFailure(() => showLogin());

// ── UI event wiring ───────────────────────────────────────────────────────

ui.bindEvents({
  onOpen:        id       => openFile(id),
  onDelete:      id       => deleteFile(id),
  onSearch:      q        => handleSearch(q),
  onSave:        ()       => saveFile(),
  onNew:         ()       => ui.openModal(),
  onCreate:      ()       => createFile(),
  onCancelModal: ()       => ui.closeModal(),
  onLogin:       (u, p)   => handleLogin(u, p),
  onLogout:      ()       => handleLogout(),
});

document.addEventListener('note-changed', () => store.updateContent(ui.getEditorContent()));

// ── PWA: service worker ───────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(reg => {
      console.log('[SW] Registered, scope:', reg.scope);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            ui.toast('Update available — refresh to apply.');
          }
        });
      });
    })
    .catch(err => console.warn('[SW] Registration failed:', err));
}

if (new URLSearchParams(location.search).get('action') === 'new') {
  window.addEventListener('load', () => ui.openModal(), { once: true });
}

// ── Boot ──────────────────────────────────────────────────────────────────

async function boot() {
  ui.setOffline(!navigator.onLine);

  // Try to restore session silently from the refresh cookie
  const restored = await tryRestoreSession();

  if (restored) {
    showApp();
  } else {
    showLogin();
  }
}

boot().catch(err => {
  console.error('[app] Boot failed:', err);
  ui.toast('Failed to start — try refreshing', true);
  showLogin();
});
