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
import * as modal      from './modal.js';
import * as loginScreen from './login-screen.js';
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
const toastCont    = $('toast-container');
const syncStatus   = $('sync-status');
const sidebarLoad  = $('sidebar-loading');
const editorTabs   = $('editor-tabs');
const tabRaw       = $('tab-raw');
const tabMeta      = $('tab-meta');

// Menu / dropdown refs
const btnMenu     = $('btn-menu')     as HTMLButtonElement;
const menuUpdate  = $('menu-update')  as HTMLButtonElement;
const menuResetDb = $('menu-reset-db') as HTMLButtonElement;
const appMenu     = $('app-menu');

// App shell (for sidebar collapse)
const appShell = $('app');

// Sidebar toggle
const btnToggleSidebar = $('btn-toggle-sidebar') as HTMLButtonElement;

let statusTimer: ReturnType<typeof setTimeout> | null = null;

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

/**
 * Programmatic write to the textarea (e.g. from history restore).
 * Publicly exposed for external callers.
 */
export function setRawContent(content: string): void {
  rawPanel.setRawContent(content);
}

export function setDirty(val: boolean): void {
  dirtyDot.classList.toggle('visible', val);
  btnSave.disabled = !val;
}

/** Get the ID of the currently open note. */
export function getCurrentNoteId(): string | null {
  return _currentNoteId;
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
  const newValues = metaPanel.getMetaFormValues();
  _pendingMeta = newValues;
  _pendingMetaDirty = true;
  if (_onDirty) _onDirty();
}

function handleAddCustomField(): void {
  metaPanel.addCustomRow();
  handleMetaFieldChange();
}

function handleRemoveCustomField(key: string): void {
  delete _pendingMeta.custom[key];
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

// ── Modal (delegated to modal.ts) ─────────────────────────────────────────

export function openModal(currentNoteId?: string | null, searchValue?: string): void {
  modal.openModal(currentNoteId ?? _currentNoteId, searchValue ?? searchInput.value);
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

// ── Login screen (delegated to login-screen.ts) ───────────────────────────

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

// ── Event wiring ──────────────────────────────────────────────────────────

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
