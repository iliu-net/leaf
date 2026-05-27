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

import * as store    from './store.js';
import * as ui       from './ui.js';
import * as pwa      from './pwa.js';
import * as sidebar  from './sidebar-chrome.js';
import { db, dbPurgeDeletedNotes } from './db.js';
import { syncStart, stopSync, clearRevision, onSyncStatus } from './sync.js';
import { getUsername, tryRestoreSession, onAuthFailure } from './auth.js';
import { subscribe } from './change-bus.js';
import { loadConfig, fetchSpaConfig } from './config.js';
import { loadTrashEntries, flushPendingPurges } from './trash-service.js';

import * as appAuth    from './app-auth.js';
import * as appFiles   from './app-files.js';
import * as appTrash   from './app-trash.js';
import * as appCrossTab from './app-cross-tab.js';

// ── Store subscriptions ──────────────────────────────────────────────────

store.on('dirty-changed', val => ui.setDirty(val as boolean));

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
  if (navigator.onLine) ui.showLoginScreen();
});

// ── PWA / DB reset ───────────────────────────────────────────────────────

async function handleUpdateApp(): Promise<void> {
  const result = await pwa.updateApp();
  if (!result.ok) ui.toast(result.message, true);
}

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
    onOpen:          id       => appFiles.openFile(id),
    onDelete:        id       => appFiles.deleteFile(id),
    onSearch:        q        => appFiles.handleSearch(q),
    onSave:          ()       => appFiles.saveFile(),
    onNew:           ()       => ui.openModal(),
    onCreate:        ()       => appFiles.createFile(),
    onCancelModal:   ()       => ui.closeModal(),
    onLogin:         async (u, p) => { if (await appAuth.handleLogin(u, p)) showAppFull(); },
    onLogout:        ()       => appAuth.handleLogout(),
    onRename:        id       => appFiles.handleRenameClick(id),
    onRenameConfirm: oldId    => appFiles.handleRenameConfirm(oldId),
    onResetDB:       ()       => handleResetDB(),
    onSignIn:        ()       => appAuth.handleSignIn(),
    onDismissLogin:  ()       => appAuth.handleDismissLogin(),
    onToggleTrash:   ()       => appTrash.handleToggleTrash(),
    onTrashPreview:  (id, src) => appTrash.handleTrashPreview(id, src),
    onTrashRestore:  (id, src) => appTrash.handleTrashRestore(id, src),
    onTrashPurge:    (id, src) => appTrash.handleTrashPurge(id, src),
    onTrashEmpty:    ()       => appTrash.handleTrashEmpty(),
  });
}

// ── Boot phases ───────────────────────────────────────────────────────────

/**
 * Phase 1: Show the app shell immediately. Loads local notes, wires
 * cross-tab listeners, registers PWA. No session required.
 */
async function showShell(): Promise<void> {
  ui.showAppShell(null);

  dbPurgeDeletedNotes().catch(err =>
    console.warn('[purge] Failed to purge deleted notes:', err)
  );

  await appFiles.refreshList();
  loadTrashEntries().then(e => ui.setTrashCount(e.length));

  window.addEventListener('online', () => {
    flushPendingPurges().catch(err =>
      console.warn('[trash] flushPendingPurges failed:', err)
    );
  });

  subscribe(event => {
    ui.setSidebarLoading(false);
    appCrossTab.handleChange(event).catch(err =>
      console.warn('[change-bus] Handler error:', err)
    );
  });

  document.addEventListener('note-changed', () =>
    store.updateContent(ui.getRawContent())
  );

  document.getElementById('btn-view-history')?.addEventListener('click', async () => {
    const id = store.getCurrent();
    if (!id) return;
    try {
      const { open } = await import('./history-view.js');
      open(id, {
        onRestore: (content: string) => {
          ui.setRawContent(content);
          store.updateContent(content);
        },
      });
    } catch (err) {
      ui.toast(`Failed to open history: ${(err as Error).message}`, true);
    }
  });

  ui.initPanels(() => store.updateContent(ui.getRawContent()));
}

/** Phase 2: Upgrade shell to full-app mode (authenticated user). */
function showAppFull(): void {
  ui.showAppShell(getUsername()!);
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

  // Background: cache server config
  fetchSpaConfig().catch(err => console.warn('[boot] SPA config fetch failed:', err));

  // Phase 2: try silent session restore
  const result = await tryRestoreSession();

  if (result === 'ok') {
    showAppFull();
  } else if (result === 'auth-failed') {
    ui.showLoginScreen();
  }
  // network-error → stay offline, shell is already visible

  store.markClean();

  // ?action=new query param
  if (new URLSearchParams(location.search).get('action') === 'new') {
    window.addEventListener('load', () => ui.openModal(), { once: true });
  }
}

boot().catch(err => {
  console.error('[app] Boot failed:', err);
  ui.toast('Failed to start — try refreshing', true);
  stopSync();
  ui.showLoginScreen();
});
