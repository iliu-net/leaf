/**
 * ui.ts — DOM rendering & interaction layer
 *
 * All direct DOM manipulation lives here (or in the sub-modules it delegates to).
 * Communicates with the rest of the app only via
 * the callbacks passed in from app.js (no imports of api/store).
 *
 * Sub-modules:
 *   editor.ts       — textarea / meta-panel lifecycle
 *   sidebar.ts      — sidebar chrome, mode switching, view delegation
 *   login-view.ts — login overlay
 *   modal.ts        — create / rename dialogs
 */

import type { UIEventHandlers } from './sidebar.js';

import * as editor        from './editor.js';
import * as sidebar       from './sidebar.js';
import * as modal         from './modal.js';
import * as loginView     from './login-view.js';
import { parseFrontmatter } from './frontmatter.js';

// Re-exports so consumers of ui.* don't break
export {
  initPanels, showEditor, hideEditor,
  flushAndGetContent, getRawContent, setRawContent,
  setDirty, getCurrentNoteId,
} from './editor.js';
export {
  renderNoteList, setActiveNote, updateNoteCount,
  setSidebarLoading, toggleSidebar, clearSearch,
  setMode, getMode, setTrashCount,
} from './sidebar.js';

// ── DOM refs (for bindEvents & status bar) ─────────────────────────────────

const $ = (id: string): HTMLElement => document.getElementById(id)!;
// _q is for elements that may not exist in test fixtures
const _q = (id: string): HTMLElement | null => document.getElementById(id);

const dirtyDot       = $('dirty-dot');
const btnSave        = $('btn-save') as HTMLButtonElement;
const statusMsg      = $('status-msg');
const offlineBadge   = $('offline-badge');
const toastCont      = $('toast-container');
const syncStatus     = $('sync-status');
const editorTabs     = $('editor-tabs');

// Menu refs ($ — must exist; _q — may be absent in test fixtures)
const btnMenu     = $('btn-menu')     as HTMLButtonElement;
const menuResetDb = $('menu-reset-db') as HTMLButtonElement;

// Trash banner (editor area — stays in ui.ts)
const trashBanner      = _q('trash-banner');
const trashBannerBody   = _q('trash-banner-body');
const trashBannerTitle   = _q('trash-banner-title');
const trashBannerRestore = _q('trash-banner-restore') as HTMLButtonElement | null;
const trashBannerPurge   = _q('trash-banner-purge') as HTMLButtonElement | null;

let statusTimer: ReturnType<typeof setTimeout> | null = null;

// ── Status bar ──────────────────────────────────────────────────────────────

export function setStatus(msg: string, ttl: number = 3000): void {
  statusMsg.textContent = msg;
  if (statusTimer !== null) clearTimeout(statusTimer);
  if (ttl > 0) {
    statusTimer = setTimeout(() => {
      if (statusMsg.textContent === msg) statusMsg.textContent = '';
    }, ttl);
  }
}

export function setOffline(offline: boolean): void {
  offlineBadge.classList.toggle('visible', offline);
}

/**
 * Update the sync status indicator in the status bar.
 * @param text  e.g. 'ONLINE', 'SYNCING', 'OFFLINE', 'ERROR'
 */
export function setSyncStatus(text: string): void {
  if (!syncStatus) return;
  syncStatus.textContent = text === 'ONLINE' ? '' : text.toLowerCase();
}

// ── Toast ───────────────────────────────────────────────────────────────────

export function toast(msg: string, isErr: boolean = false): void {
  const el = document.createElement('div');
  el.className   = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  toastCont.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Modal (delegated to modal.ts) ───────────────────────────────────────────

export function openModal(currentNoteId?: string | null, searchValue?: string): void {
  const si = (document.getElementById('search') as HTMLInputElement);
  modal.openModal(currentNoteId ?? editor.getCurrentNoteId(), searchValue ?? si?.value ?? '');
}

export function openRenameModal(id: string): void {
  modal.openRenameModal(id);
}

export function closeModal(): void {
  modal.closeModal();
}

export function setModalError(msg: string): void {
  modal.setModalError(msg);
}

export function setModalHint(msg: string): void {
  modal.setModalHint(msg);
}

export function getModalValue(): string {
  return modal.getModalValue();
}

// ── Login screen (delegated to login-view.ts) ─────────────────────────────

export function showLoginScreen(): void {
  loginView.showLoginScreen();
}

export function showAppShell(username: string | null): void {
  loginView.showAppShell(username);
}

export function setLoginError(msg: string): void {
  loginView.setLoginError(msg);
}

export function setLoginLoading(loading: boolean): void {
  loginView.setLoginLoading(loading);
}

export function hideLoginScreen(): void {
  loginView.hideLoginScreen();
}

export function showOfflineFirstVisit(): void {
  loginView.showOfflineFirstVisit();
}

// ── Trash preview banner ────────────────────────────────────────────────────

/**
 * Show a read-only preview of a deleted note, styled like the Meta tab.
 * Shows frontmatter fields (title, summary, tags, custom fields),
 * system metadata (version, timestamps, authors), content stats,
 * and the note body.
 */
export function showTrashBanner(
  id: string,
  content: string,
  meta: { created_at?: number; updated_at?: number; created_by?: string; updated_by?: string; current?: string },
  onRestore: () => void,
  onPurge: () => void,
): void {
  if (!trashBanner || !trashBannerBody) return;

  // Hide all editor panels
  const editorTabs = document.getElementById('editor-tabs');
  for (const panelId of ['tab-view', 'tab-raw', 'tab-meta']) {
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.remove('active');
  }
  const emptyState = document.getElementById('empty-state');
  if (editorTabs) editorTabs.style.display = 'none';
  if (emptyState) emptyState.style.display = 'none';

  trashBanner.style.display = 'block';
  if (trashBannerTitle) trashBannerTitle.textContent = `"${id}" is in the trash`;
  if (trashBannerRestore) trashBannerRestore.onclick = onRestore;
  if (trashBannerPurge) trashBannerPurge.onclick = onPurge;

  // ── Build synthetic NoteData ───────────────────────────────────────
  const fm = parseFrontmatter(content);
  const noteData = {
    id,
    content,
    created_at: meta.created_at ?? 0,
    updated_at: meta.updated_at ?? 0,
    current: meta.current ?? '',
    created_by: meta.created_by ?? '',
    updated_by: meta.updated_by ?? '',
    meta: fm.meta,
  };

  // ── Delegate to view panel (single read-only render path) ──────────
  import('./view-panel.js').then(mod => {
    trashBannerBody.innerHTML = `<div class="trash-fm-wrap">${mod.renderView(content, noteData)}</div>`;
  });
}

export function hideTrashBanner(): void {
  if (trashBanner) trashBanner.style.display = 'none';
}

// ── Event wiring ────────────────────────────────────────────────────────────

export function bindEvents(handlers: UIEventHandlers): void {
  const { onSave, onNew, onResetDB } = handlers;

  // Login form events → login-view.ts
  loginView.bindLoginEvents({
    onLogin:        (u, p) => handlers.onLogin?.(u, p),
    onSignIn:       () => handlers.onSignIn?.(),
    onLogout:       () => handlers.onLogout?.(),
    onDismissLogin: () => handlers.onDismissLogin?.(),
  });

  // Modal events → modal.ts
  modal.bindModalEvents({
    onCreate:        () => handlers.onCreate?.(),
    onCancel:        () => handlers.onCancelModal?.(),
    onRenameConfirm: (oldId: string) => handlers.onRenameConfirm?.(oldId),
  });

  // ── Sidebar — all sidebar DOM wiring (file-list, search, chrome, menu)
  sidebar.init(handlers);

  // Buttons
  btnSave.addEventListener('click', onSave);
  $('btn-new').addEventListener('click', onNew);
  $('btn-toggle-sidebar').addEventListener('click', sidebar.toggleSidebar);

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      onSave();
    }
  });

  // Unload guard — warn if unsaved changes
  window.addEventListener('beforeunload', e => {
    if (editorTabs.style.display !== 'none' && dirtyDot.classList.contains('visible')) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ── App menu dropdown ──────────────────────────────────────────────────
  const headerBrand = $('header-brand');

  function closeMenu(): void {
    headerBrand.classList.remove('open');
  }

  menuResetDb.addEventListener('click', () => {
    closeMenu();
    onResetDB();
  });

  // Toggle button
  btnMenu.addEventListener('click', e => {
    e.stopPropagation();
    headerBrand.classList.toggle('open');
  });

  // Click outside closes the dropdown
  document.addEventListener('click', (e: MouseEvent) => {
    if (
      headerBrand.classList.contains('open') &&
      !e.composedPath().includes(headerBrand)
    ) {
      closeMenu();
    }
  });
}
