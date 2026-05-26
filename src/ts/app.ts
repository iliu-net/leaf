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
 *
 * File, trash, and cross-tab operations are extracted to app-files.ts,
 * app-trash.ts, and app-cross-tab.ts respectively.
 */

import * as notes from './notes.js';
import * as store from './store.js';
import * as ui      from './ui.js';
import * as pwa     from './pwa.js';
import * as appAuth from './app-auth.js';
import * as sidebar from './sidebar-chrome.js';
import { db, dbPurgeDeletedNotes } from './db.js';
import { syncStart, syncNow, stopSync, clearRevision, onSyncStatus, onRemoteChange } from './sync.js';
import {
  getUsername, tryRestoreSession, onAuthFailure,
} from './auth.js';
import { onCrossTabChange } from './cross-tab.js';
import { loadConfig, fetchSpaConfig } from './config.js';
import {
  loadTrashEntries, flushPendingPurges,
} from './trash-service.js';

import { createFileOps } from './app-files.js';
import { createTrashOps } from './app-trash.js';
import { createCrossTabHandler } from './app-cross-tab.js';

// ── Operation modules (initialized in boot) ────────────────────────────────

let files: ReturnType<typeof createFileOps>;
let trash: ReturnType<typeof createTrashOps>;
let crossTab: ReturnType<typeof createCrossTabHandler>;

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
  await files.refreshList();

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
    crossTab.handleCrossTabChange(msg).catch(err =>
      console.warn('[cross-tab] Handler error:', err)
    );
  });
}

function showLogin(): void {
  stopSync();
  ui.showLoginScreen();
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
  if (ui.getSidebarMode() === 'trash') {
    trash.refreshTrashList();
  } else {
    files.refreshList();
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
// Arrow closures dereference files/trash at call time, so they work
// even though the factories haven't run yet at module init.

ui.bindEvents({
  onOpen:          id       => files.openFile(id),
  onDelete:        id       => files.deleteFile(id),
  onSearch:        q        => files.handleSearch(q),
  onSave:          ()       => files.saveFile(),
  onNew:           ()       => ui.openModal(),
  onCreate:        ()       => files.createFile(),
  onCancelModal:   ()       => ui.closeModal(),
  onLogin:         (u, p)   => appAuth.handleLogin(u, p, () => showApp(true)),
  onLogout:        ()       => appAuth.handleLogout(),
  onRename:        id       => files.handleRenameClick(id),
  onRenameConfirm: oldId    => files.handleRenameConfirm(oldId),
  onResetDB:       ()       => handleResetDB(),
  onSignIn:        ()       => appAuth.handleSignIn(),
  onDismissLogin:  ()       => appAuth.handleDismissLogin(),
  onToggleTrash:   ()       => trash.handleToggleTrash(),
  onTrashPreview:  (id, src) => trash.handleTrashPreview(id, src),
  onTrashRestore:  (id, src) => trash.handleTrashRestore(id, src),
  onTrashPurge:    (id, src) => trash.handleTrashPurge(id, src),
  onTrashEmpty:    ()       => trash.handleTrashEmpty(),
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

  // Wire up operation modules (must happen before showApp / any UI event)
  files = createFileOps({ store, ui, notes, syncNow });
  trash = createTrashOps({
    store, ui, sidebar,
    refreshList: (id) => files.refreshList(id),
  });
  crossTab = createCrossTabHandler({
    store, ui, notes,
    refreshList: (id) => files.refreshList(id),
    refreshTrashList: () => trash.refreshTrashList(),
    loadTrashEntries,
  });

  // Register service worker (fire-and-forget)
  pwa.initPwa().catch(err => console.warn('[boot] PWA init failed:', err));
  pwa.onUpdateFound(msg => ui.toast(msg));

  ui.setOffline(!navigator.onLine);

  // Always show the app shell first
  await showApp(false /* no session yet */);

  // Fetch SPA config in background (fire-and-forget, populates cache)
  fetchSpaConfig().catch(err => console.warn('[boot] SPA config fetch failed:', err));

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
