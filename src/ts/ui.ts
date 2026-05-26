/**
 * ui.ts — DOM rendering & interaction layer
 *
 * All direct DOM manipulation lives here (or in the sub-modules it delegates to).
 * Communicates with the rest of the app only via
 * the callbacks passed in from app.js (no imports of api/store).
 *
 * Sub-modules:
 *   editor.ts         — textarea / meta-panel lifecycle
 *   sidebar-chrome.ts — file-list rendering & sidebar chrome
 *   login-screen.ts   — login overlay
 *   modal.ts          — create / rename dialogs
 */

import type { UIEventHandlers } from './view.js';

import * as editor        from './editor.js';
import * as sidebar       from './sidebar-chrome.js';
import * as modal         from './modal.js';
import * as loginScreen   from './login-screen.js';

// Re-exports so consumers of ui.* don't break
export {
  initPanels, showEditor, hideEditor,
  flushAndGetContent, getRawContent, setRawContent,
  setDirty, getCurrentNoteId,
} from './editor.js';
export {
  renderFileList, setActiveFile, updateNoteCount,
  setSidebarLoading, toggleSidebar, clearSearch,
} from './sidebar-chrome.js';

// ── DOM refs (for bindEvents & status bar) ─────────────────────────────────

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const fileList       = $('file-list');
const dirtyDot       = $('dirty-dot');
const btnSave        = $('btn-save') as HTMLButtonElement;
const searchInput    = $('search') as HTMLInputElement;
const statusMsg      = $('status-msg');
const offlineBadge   = $('offline-badge');
const toastCont      = $('toast-container');
const syncStatus     = $('sync-status');
const editorTabs     = $('editor-tabs');

// Menu / dropdown refs
const btnMenu     = $('btn-menu')     as HTMLButtonElement;
const menuUpdate  = $('menu-update')  as HTMLButtonElement;
const menuResetDb = $('menu-reset-db') as HTMLButtonElement;
const appMenu     = $('app-menu');

// Sidebar toggle
const btnToggleSidebar = $('btn-toggle-sidebar') as HTMLButtonElement;

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
  modal.openModal(currentNoteId ?? editor.getCurrentNoteId(), searchValue ?? searchInput.value);
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

// ── Login screen (delegated to login-screen.ts) ─────────────────────────────

export function showLoginScreen(): void {
  loginScreen.showLoginScreen();
}

export function showAppShell(username: string | null): void {
  loginScreen.showAppShell(username);
}

export function setLoginError(msg: string): void {
  loginScreen.setLoginError(msg);
}

export function setLoginLoading(loading: boolean): void {
  loginScreen.setLoginLoading(loading);
}

export function hideLoginScreen(): void {
  loginScreen.hideLoginScreen();
}

export function showOfflineFirstVisit(): void {
  loginScreen.showOfflineFirstVisit();
}

// ── Event wiring ────────────────────────────────────────────────────────────

export function bindEvents(handlers: UIEventHandlers): void {
  const {
    onOpen, onDelete, onSearch, onSave, onNew, onRename,
    onUpdateSW, onResetDB,
  } = handlers;

  // Login form events → login-screen.ts
  loginScreen.bindLoginEvents({
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

  // File list — event delegation (delegated to current sidebar view)
  fileList.addEventListener('click', e => {
    const cv = sidebar.getCurrentView();
    if (cv) cv.handleClick(e, handlers);
  });

  // Search
  searchInput.addEventListener('input', () => onSearch(searchInput.value));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape' && searchInput.value) {
      e.preventDefault();
      searchInput.value = '';
      onSearch('');
    }
  });

  // Buttons
  btnSave.addEventListener('click', onSave);
  $('btn-new').addEventListener('click', onNew);
  btnToggleSidebar.addEventListener('click', sidebar.toggleSidebar);

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      onSave();
    }
    // Escape closes modal overlay if open (handled in modal.ts bind)
    // and dismisses login (handled in login-screen.ts bind)
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

  function toggleMenu(): void {
    headerBrand.classList.toggle('open');
  }

  // Dropdown items — close menu and call respective handler
  menuUpdate.addEventListener('click', () => {
    closeMenu();
    onUpdateSW();
  });

  menuResetDb.addEventListener('click', () => {
    closeMenu();
    onResetDB();
  });

  // Toggle button — stopPropagation prevents the document listener
  // from immediately re-closing the dropdown
  btnMenu.addEventListener('click', e => {
    e.stopPropagation();
    toggleMenu();
  });

  // Click outside the header-brand area closes the dropdown
  document.addEventListener('click', (e: MouseEvent) => {
    if (
      headerBrand.classList.contains('open') &&
      !e.composedPath().includes(headerBrand)
    ) {
      closeMenu();
    }
  });
}
