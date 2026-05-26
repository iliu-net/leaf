/**
 * ui.ts — DOM rendering & interaction layer
 *
 * All direct DOM manipulation lives here.
 * Communicates with the rest of the app only via
 * the callbacks passed in from app.js (no imports of api/store).
 *
 * Note: renderFileList() receives note objects {id, created_at, updated_at}
 * and currentId is a string id, not a full object.
 *
 * Starting with the tree-view sidebar; future sidebar modes (tags, etc.)
 * can be added by implementing SidebarView and switching currentView.
 */

import type { NoteMeta } from './store.js';
import type { SidebarView } from './view.js';
import type { UIEventHandlers } from './view.js';
import { TreeView } from './tree.js';

import * as rawPanel   from './raw-panel.js';
import * as metaPanel  from './meta-panel.js';
import {
  parseFrontmatter,
  updateFrontmatter,
  initPendingMeta,
  pendingMetaToUpdates,
  computeStats,
} from './frontmatter.js';
import type { PendingMeta } from './frontmatter.js';
import type { NoteData } from './notes.js';

// ── DOM refs ──────────────────────────────────────────────────────────────
const $ = (id: string): HTMLElement => document.getElementById(id)!;

const fileList     = $('file-list');
const emptyState   = $('empty-state');
const currentFile  = $('current-file');
const dirtyDot     = $('dirty-dot');
const btnSave      = $('btn-save') as HTMLButtonElement;
const searchInput  = $('search') as HTMLInputElement;
const noteCount    = $('note-count');
const statusMsg    = $('status-msg');
const offlineBadge = $('offline-badge');
const overlay      = $('modal-overlay');
const modalTitle   = $('modal-title');
const modalInput   = $('modal-input') as HTMLInputElement;
const modalHint    = $('modal-hint');
const modalCreate  = $('modal-create');
const modalCancel  = $('modal-cancel');
const toastCont    = $('toast-container');
const syncStatus   = $('sync-status');
const sidebarLoad  = $('sidebar-loading');
const editorTabs   = $('editor-tabs');
const tabRaw       = $('tab-raw');
const tabMeta      = $('tab-meta');

// Login screen refs
const loginScreen  = $('login-screen');
const appShell     = $('app');
const loginForm    = $('login-form');
const loginUser    = $('login-username') as HTMLInputElement;
const loginPass    = $('login-password') as HTMLInputElement;
const loginBtn     = $('login-btn') as HTMLButtonElement;
const loginErr     = $('login-error');
const usernameDisp = $('username-display');
const btnLogout    = $('btn-logout');
const btnSignin    = $('btn-signin') as HTMLButtonElement;
const loginClose   = $('login-close') as HTMLButtonElement;

// Menu / dropdown refs
const btnMenu     = $('btn-menu')     as HTMLButtonElement;
const menuUpdate  = $('menu-update')  as HTMLButtonElement;
const menuResetDb = $('menu-reset-db') as HTMLButtonElement;
const appMenu     = $('app-menu');

// Sidebar toggle
const btnToggleSidebar = $('btn-toggle-sidebar') as HTMLButtonElement;

let statusTimer: ReturnType<typeof setTimeout> | null = null;

/** Non-null when the modal is in rename mode (holds the id being renamed). */
let _renameId: string | null = null;

/** Active sidebar view — defaults to TreeView on first render. */
let currentView: SidebarView | null = null;

/** ID of the note currently open in the editor (not DOM-dependent). */
let _currentNoteId: string | null = null;

/** Currently active tab: 'raw' or 'meta'. */
let _activeTab: 'raw' | 'meta' = 'raw';

/** Pending meta state (form values before flush to textarea). */
let _pendingMeta: PendingMeta = { title: '', summary: '', tags: [], custom: {} };

/** True when meta edits have been made that haven't been flushed to textarea. */
let _pendingMetaDirty = false;

/**
 * Callback to mark the store as dirty.
 * Set by initPanels() — avoids circular import of store.ts.
 */
let _onDirty: (() => void) | null = null;

// ── Init ──────────────────────────────────────────────────────────────────

/**
 * One-time panel initialisation.
 * @param onDirty  Callback to mark store dirty (called when meta changes occur)
 */
export function initPanels(onDirty: () => void): void {
  _onDirty = onDirty;
  rawPanel.initRawPanel();
  metaPanel.initMetaPanel();

  // Bind panel-level events
  rawPanel.bindRawEvents({
    onInput: () => {
      // textarea input — handled by note-changed listener in app.ts
    },
  });

  metaPanel.bindMetaEvents({
    onFieldChange:        () => handleMetaFieldChange(),
    onAddCustomField:     () => handleAddCustomField(),
    onRemoveCustomField:  (key: string) => handleRemoveCustomField(key),
  });

  // Tab button clicks
  const tabBtnRaw  = document.getElementById('tab-btn-raw');
  const tabBtnMeta = document.getElementById('tab-btn-meta');
  if (tabBtnRaw)  tabBtnRaw.addEventListener('click',  () => switchTab('raw'));
  if (tabBtnMeta) tabBtnMeta.addEventListener('click', () => switchTab('meta'));
}

// ── File list ─────────────────────────────────────────────────────────────

/**
 * Render the sidebar note list.
 *
 * @param notes  Array of note metadata objects
 * @param currentId  id of the currently open note (or null)
 */
export function renderFileList(notes: NoteMeta[], currentId: string | null): void {
  currentView = TreeView;
  TreeView.render(notes, currentId);
}

export function setActiveFile(id: string): void {
  fileList.querySelectorAll('.file-item').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset.id === id);
  });
}

export function updateNoteCount(total: number, shown: number): void {
  (currentView ?? TreeView).updateNoteCount(total, shown);
}

/**
 * Show or hide the sidebar loading indicator.
 * Only shown on first visit when IndexedDB is empty and sync is in progress.
 */
export function setSidebarLoading(loading: boolean): void {
  if (!sidebarLoad) return;
  sidebarLoad.style.display = loading ? 'flex' : 'none';
}

/** Toggle sidebar visibility (collapsed / shown). */
export function toggleSidebar(): void {
  appShell.classList.toggle('sidebar-collapsed');
}

/** Clear the search input and reset the note list. */
export function clearSearch(): void {
  if (searchInput.value) {
    searchInput.value = '';
    // Dispatch an input event so the store query is updated
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// ── Editor ────────────────────────────────────────────────────────────────

export function showEditor(noteData: NoteData): void {
  _currentNoteId = noteData.id;

  // Parse frontmatter for initial pending state
  const fm = parseFrontmatter(noteData.content);
  _pendingMeta = initPendingMeta(fm.meta);
  _pendingMetaDirty = false;

  // Hide empty state, show tab bar
  emptyState.style.display = 'none';
  editorTabs.style.display = 'flex';

  // Show raw tab by default
  _activeTab = 'raw';
  tabRaw.classList.add('active');
  tabMeta.classList.remove('active');
  updateTabButtons();

  // Fill textarea
  rawPanel.showRawPanel(noteData.content);

  // Populate system info fields
  metaPanel.populateSystemFields(noteData);

  // Show note name
  currentFile.innerHTML = `<span class="fname">${noteData.id}</span>`;

  rawPanel.focusRawPanel();
}

export function hideEditor(): void {
  _currentNoteId = null;
  _pendingMeta = { title: '', summary: '', tags: [], custom: {} };
  _pendingMetaDirty = false;

  // Hide panels
  editorTabs.style.display = 'none';
  tabRaw.classList.remove('active');
  tabMeta.classList.remove('active');

  // Clear textarea and meta panel
  rawPanel.hideRawPanel();
  metaPanel.resetMetaPanel();

  // Show empty state
  emptyState.style.display = 'flex';
  currentFile.innerHTML = 'No file selected';
}

/**
 * Get the current editor content, flushing pending meta if on the Meta tab.
 * Use this for saving — it has the side-effect of flushing meta to the textarea.
 */
export function flushAndGetContent(): string {
  if (_activeTab === 'meta' && _pendingMetaDirty) {
    flushPendingMeta();
  }
  return rawPanel.getRawContent();
}

/**
 * Plain read of the textarea value with no side-effects.
 * Use this for diagnostics or when you need the raw value without flushing.
 */
export function getRawContent(): string {
  return rawPanel.getRawContent();
}

export function setDirty(val: boolean): void {
  dirtyDot.classList.toggle('visible', val);
  btnSave.disabled = !val;
}

// ── Tab switching ─────────────────────────────────────────────────────────

function switchTab(tab: 'raw' | 'meta'): void {
  if (tab === _activeTab) return;

  if (tab === 'raw') {
    // Meta → Raw: flush pending meta to textarea if dirty
    if (_pendingMetaDirty) {
      flushPendingMeta();
    }
    _activeTab = 'raw';
    tabRaw.classList.add('active');
    tabMeta.classList.remove('active');
    rawPanel.focusRawPanel();
  } else {
    // Raw → Meta: re-parse frontmatter from current textarea
    const raw = rawPanel.getRawContent();
    const fm = parseFrontmatter(raw);
    _pendingMeta = initPendingMeta(fm.meta);
    _pendingMetaDirty = false;

    // Compute stats from body (frontmatter stripped)
    const stats = computeStats(fm.body);

    // Render meta panel
    metaPanel.renderMetaPanel(_pendingMeta, stats);

    _activeTab = 'meta';
    tabRaw.classList.remove('active');
    tabMeta.classList.add('active');
  }

  updateTabButtons();
}

function updateTabButtons(): void {
  const btnRaw  = document.getElementById('tab-btn-raw');
  const btnMeta = document.getElementById('tab-btn-meta');
  if (btnRaw) {
    btnRaw.classList.toggle('active', _activeTab === 'raw');
    btnRaw.setAttribute('aria-selected', String(_activeTab === 'raw'));
  }
  if (btnMeta) {
    btnMeta.classList.toggle('active', _activeTab === 'meta');
    btnMeta.setAttribute('aria-selected', String(_activeTab === 'meta'));
  }
}

// ── Meta panel handlers ──────────────────────────────────────────────────

function handleMetaFieldChange(): void {
  // Read form values and update pending meta
  const newValues = metaPanel.getMetaFormValues();
  _pendingMeta = newValues;
  _pendingMetaDirty = true;

  // Mark store dirty so Save button is enabled
  if (_onDirty) _onDirty();
}

function handleAddCustomField(): void {
  metaPanel.addCustomRow();
  handleMetaFieldChange();
}

function handleRemoveCustomField(key: string): void {
  // Remove from custom record
  delete _pendingMeta.custom[key];
  // Re-render custom rows
  metaPanel.renderCustomRows(_pendingMeta.custom);
  _pendingMetaDirty = true;
  if (_onDirty) _onDirty();
}

// ── Internal helpers ──────────────────────────────────────────────────────

/**
 * Flush pending meta changes to the textarea and reset dirty flag.
 */
function flushPendingMeta(): void {
  const raw = rawPanel.getRawContent();
  const updates = pendingMetaToUpdates(_pendingMeta);
  const merged = updateFrontmatter(raw, updates);
  rawPanel.setRawContent(merged);
  _pendingMetaDirty = false;
}

// ── Status bar ────────────────────────────────────────────────────────────

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

// ── Toast ─────────────────────────────────────────────────────────────────

export function toast(msg: string, isErr: boolean = false): void {
  const el = document.createElement('div');
  el.className   = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  toastCont.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Modal ─────────────────────────────────────────────────────────────────

export function openModal(): void {
  _renameId = null;
  if (modalTitle) modalTitle.textContent = 'New note';

  // Derive the pre-fill value:
  //   prefix = parent path of the currently open note (if any)
  //   name   = current search text (if any)
  //   result = prefix + name
  // This keeps new notes in the same tree branch by default.
  // Note: we read _currentNoteId rather than querying the DOM because
  // the current note may be filtered out of the visible list by search.
  const searchVal = searchInput.value || '';
  let prefix = '';

  if (_currentNoteId) {
    const lastColon = _currentNoteId.lastIndexOf(':');
    if (lastColon !== -1) {
      prefix = _currentNoteId.substring(0, lastColon + 1); // includes the ':'
    }
  }

  modalInput.value = prefix + searchVal;
  modalHint.textContent = '';
  modalHint.className = 'modal-hint';
  if (modalCreate) modalCreate.textContent = 'Create';
  overlay.classList.add('open');
  requestAnimationFrame(() => modalInput.focus());
}

/**
 * Open the modal in rename mode.
 * @param id — current note id being renamed
 */
export function openRenameModal(id: string): void {
  _renameId = id;
  if (modalTitle) modalTitle.textContent = 'Rename note';
  modalInput.value      = id;
  modalInput.select();
  modalHint.textContent = '';
  modalHint.className   = 'modal-hint';
  if (modalCreate) modalCreate.textContent = 'Rename';
  overlay.classList.add('open');
  requestAnimationFrame(() => modalInput.focus());
}

export function closeModal(): void {
  _renameId = null;
  overlay.classList.remove('open');
}

export function setModalError(msg: string): void {
  modalHint.textContent = msg;
  modalHint.className   = 'modal-hint err';
}

export function setModalHint(msg: string): void {
  modalHint.textContent = msg;
  modalHint.className   = 'modal-hint';
}

export function getModalValue(): string {
  return modalInput.value.trim();
}

// ── Login screen ──────────────────────────────────────────────────────────

/** Show the login screen, hide the app shell. */
export function showLoginScreen(): void {
  loginScreen.classList.add('visible');
  if (loginScreen) loginScreen.style.display = 'flex';
  if (appShell)    appShell.style.display    = 'none';
  if (loginUser)   { loginUser.value = ''; loginUser.focus(); }
  if (loginPass)   loginPass.value = '';
  if (loginErr)    loginErr.textContent = '';
}

/**
 * Hide the login screen, show the app shell.
 * @param username — displayed in the header, or null for offline/unauthenticated state
 */
export function showAppShell(username: string | null): void {
  loginScreen.classList.remove('visible');
  if (loginScreen) loginScreen.style.display = 'none';
  if (appShell)    appShell.style.display    = 'flex';

  if (username) {
    if (usernameDisp) usernameDisp.textContent = username;
    if (usernameDisp) usernameDisp.style.display = 'inline';
    btnSignin.style.display = 'none';
    btnLogout.style.display = 'inline-block';
  } else {
    if (usernameDisp) usernameDisp.style.display = 'none';
    btnSignin.style.display = 'inline-block';
    btnLogout.style.display = 'none';
  }
}

/**
 * Show an error message on the login form.
 */
export function setLoginError(msg: string): void {
  if (loginErr) loginErr.textContent = msg;
}

/**
 * Show/hide a loading state on the login button.
 */
export function setLoginLoading(loading: boolean): void {
  if (!loginBtn) return;
  loginBtn.disabled     = loading;
  loginBtn.textContent  = loading ? 'Signing in…' : 'Sign in';
}

/**
 * Hide the login screen, show the app shell (dismiss dismiss).
 */
export function hideLoginScreen(): void {
  loginScreen.classList.remove('visible');
  if (loginScreen) loginScreen.style.display = 'none';
  if (appShell)    appShell.style.display    = 'flex';
}

/**
 * Show an inline message in the sidebar when there are no notes,
 * we're offline, and there's no session.
 */
export function showOfflineFirstVisit(): void {
  if (!fileList) return;
  fileList.innerHTML = '';
  const el = document.createElement('div');
  el.style.cssText = 'padding:20px 12px;text-align:center;font-size:11px;'
    + 'color:var(--text-3);font-family:var(--font-mono);line-height:1.6';
  el.innerHTML = 'No notes yet.<br>Sign in to sync or<br>create one locally.';
  fileList.appendChild(el);
}

// ── Event wiring ──────────────────────────────────────────────────────────

export function bindEvents(handlers: UIEventHandlers): void {
  const {
    onOpen, onDelete, onSearch, onSave, onNew, onCreate, onCancelModal,
    onLogin, onLogout, onRename, onRenameConfirm, onUpdateSW, onResetDB,
    onSignIn, onDismissLogin,
  } = handlers;

  // Login form
  if (loginForm) {
    loginForm.addEventListener('submit', e => {
      e.preventDefault();
      const u = loginUser?.value.trim() ?? '';
      const p = loginPass?.value ?? '';
      if (u && p && onLogin) onLogin(u, p);
    });
  }

  // Sign-in button
  if (btnSignin) {
    btnSignin.addEventListener('click', () => onSignIn?.());
  }

  // Logout button
  if (btnLogout) {
    btnLogout.addEventListener('click', () => onLogout?.());
  }

  // Login close / dismiss button
  if (loginClose) {
    loginClose.addEventListener('click', () => onDismissLogin?.());
  }

  // Escape key to dismiss login overlay
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && loginScreen.classList.contains('visible')) {
      onDismissLogin?.();
    }
  });

  // File list — event delegation (delegated to current sidebar view)
  fileList.addEventListener('click', e => {
    if (currentView) currentView.handleClick(e, handlers);
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
  btnToggleSidebar.addEventListener('click', toggleSidebar);

  // Modal — create or rename
  modalCreate.addEventListener('click', () => {
    if (_renameId) onRenameConfirm(_renameId);
    else           onCreate();
  });
  modalCancel.addEventListener('click', onCancelModal);

  modalInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if (_renameId) onRenameConfirm(_renameId);
      else           onCreate();
    }
    if (e.key === 'Escape') onCancelModal();
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) onCancelModal();
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      onSave();
    }
    if (e.key === 'Escape' && overlay.classList.contains('open')) {
      onCancelModal();
    }
  });

  // Unload guard — warn if unsaved changes
  window.addEventListener('beforeunload', e => {
    if (editorTabs.style.display !== 'none' && dirtyDot.classList.contains('visible')) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ── App menu dropdown ────────────────────────────────────────────────
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
