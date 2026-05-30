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
import { DOM, $, $maybe } from './dom-ids.js';

import * as sidebar       from './sidebar.js';
import * as modal         from './modal.js';
import * as loginView     from './login-view.js';
import * as cookmode      from './cookmode.js';
import { initThemeSwitcher } from './themes.js';
import { init as initKeyboard } from './keyboard.js';

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
  renderSystemSection,
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

  // ── Cookmode ────────────────────────────────────────────────────────────
  const btnCookmode = $maybe(DOM.BTN_COOKMODE) as HTMLButtonElement | null;
  btnCookmode?.addEventListener('click', async () => {
    const active = await cookmode.toggle();
    console.log('[cookmode] User toggled, active =', active);
    btnCookmode.classList.toggle('active', active);
    btnCookmode.setAttribute('aria-pressed', String(active));
    btnCookmode.title = active
      ? 'Cookmode: ON — screen will stay awake'
      : 'Cookmode: OFF — click to keep screen awake';
    setStatus(active ? 'Cookmode: screen will stay awake' : 'Cookmode off');
  });

  // ── Global keyboard shortcuts ──────────────────────────────────────────
  initKeyboard(onSave);

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

  // ── Theme switching ────────────────────────────────────────────────────
  initThemeSwitcher(closeMenu);
}
