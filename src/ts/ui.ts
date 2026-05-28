/**
 * ui.ts — DOM rendering & interaction layer
 *
 * All direct DOM manipulation lives here (or in the sub-modules it delegates to).
 * Communicates with the rest of the app only via
 * the callbacks passed in from app.js (no imports of api/store).
 *
 * Sub-modules:
 *   editor-ctrl.ts  — tab coordinator
 *   sidebar.ts      — sidebar chrome, mode switching, view delegation
 *   login-view.ts   — login overlay
 *   modal.ts        — create / rename dialogs
 */

import type { UIEventHandlers } from './sidebar.js';

import * as editor        from './editor-ctrl.js';
import * as sidebar       from './sidebar.js';
import * as modal         from './modal.js';
import * as loginView     from './login-view.js';

// Re-exports so consumers of ui.* don't break
export {
  initPanels, showEditor, hideEditor,
  flushAndGetContent, getRawContent, setRawContent,
  setDirty, getCurrentNoteId,
} from './editor-ctrl.js';
export {
  renderNoteList, setActiveNote, updateNoteCount,
  setSidebarLoading, toggleSidebar, clearSearch,
  setMode, getMode, setTrashCount,
} from './sidebar.js';

// ── DOM refs (for bindEvents & status bar) ─────────────────────────────────

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const dirtyDot       = $('dirty-dot');
const btnSave        = $('btn-save') as HTMLButtonElement;
const statusMsg      = $('status-msg');
const offlineBadge   = $('offline-badge');
const toastCont      = $('toast-container');
const syncStatus     = $('sync-status');
const editorTabs     = $('editor-tabs');

// Menu refs
const btnMenu     = $('btn-menu')     as HTMLButtonElement;
const menuResetDb = $('menu-reset-db') as HTMLButtonElement;

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
