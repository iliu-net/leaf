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
import { DOM, $ } from './dom-ids.js';

import * as editor        from './editor-ctrl.js';
import * as sidebar       from './sidebar.js';
import * as modal         from './modal.js';
import * as loginView     from './login-view.js';

// Re-exports so consumers of ui.* don't break
export {
  initPanels, showEditor, hideEditor,
  flushAndGetContent, getRawContent, setRawContent,
  refreshActiveTab, setDirty, getCurrentNoteId,
} from './editor-ctrl.js';
export {
  renderNoteList, setActiveNote, updateNoteCount,
  setSidebarLoading, toggleSidebar, clearSearch,
  setMode, getMode, setTrashCount, initResizer,
} from './sidebar.js';

// ── DOM refs (for bindEvents & status bar) ─────────────────────────────────

const btnSave        = $(DOM.BTN_SAVE) as HTMLButtonElement;
const statusMsg      = $(DOM.STATUS_MSG);
const offlineBadge   = $(DOM.OFFLINE_BADGE);
const toastCont      = $(DOM.TOAST_CONTAINER);
const syncStatus     = $(DOM.SYNC_STATUS);

// Menu refs
const btnMenu     = $(DOM.BTN_MENU)     as HTMLButtonElement;
const menuResetDb = $(DOM.MENU_RESET_DB) as HTMLButtonElement;

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
  sidebar.initResizer();

  // Buttons
  btnSave.addEventListener('click', onSave);
  $(DOM.BTN_NEW).addEventListener('click', onNew);
  $(DOM.BTN_TOGGLE_SIDEBAR).addEventListener('click', sidebar.toggleSidebar);

  // ── Global keyboard shortcuts ──────────────────────────────────────────
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    // ── CTRL+S — save, then switch to view (no-op on VIEW tab) ─────────
    if (e.key === 's') {
      e.preventDefault();
      if (editor.getActiveTab() === 'view') return;  // VIEW: no-op
      onSave();
      editor.switchEditorTab('view');
      return;
    }

    // ── CTRL+E — toggle edit/view (pass-through on CODE tab) ───────────
    if (e.key === 'e') {
      const active = editor.getActiveTab();
      // On CODE tab: let the browser / CodeMirror handle it
      if (active === 'code') return;

      e.preventDefault();
      if (!editor.getCurrentNoteId()) return;

      if (active === 'view' || active === 'meta') {
        // → CODE (if CM available) or RAW
        editor.switchEditorTab(editor.isCmAvailable() ? 'code' : 'raw');
      } else {
        // active === 'raw' → VIEW
        editor.switchEditorTab('view');
      }
      return;
    }

    // ── CTRL+M — switch to META tab ────────────────────────────────────
    if (e.key === 'm') {
      e.preventDefault();
      if (!editor.getCurrentNoteId()) return;
      if (editor.getActiveTab() === 'meta') {
        // Already on META — re-focus the title field
        editor.focusActiveTab();
      } else {
        editor.switchEditorTab('meta');
      }
      return;
    }
  });

  // ── App menu dropdown ──────────────────────────────────────────────────
  const headerBrand = $(DOM.HEADER_BRAND);

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
