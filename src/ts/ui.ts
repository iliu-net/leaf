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
import { TrashView }      from './trash-view.js';
import { parseFrontmatter } from './frontmatter.js';

// Re-exports so consumers of ui.* don't break
export {
  initPanels, showEditor, hideEditor,
  flushAndGetContent, getRawContent, setRawContent,
  setDirty, getCurrentNoteId,
} from './editor.js';
export {
  renderFileList, setActiveFile, updateNoteCount,
  setSidebarLoading, toggleSidebar, clearSearch,
  setCurrentView,
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
const menuResetDb = $('menu-reset-db') as HTMLButtonElement;
const appMenu     = $('app-menu');

// Sidebar toggle
const btnToggleSidebar = $('btn-toggle-sidebar') as HTMLButtonElement;

// Trash (guarded — test fixtures may omit these elements)
const _q = (id: string): HTMLElement | null => document.getElementById(id);
const sidebarToolbar = $('sidebar-toolbar');
const trashToolbar   = _q('trash-toolbar');
const trashFooter    = _q('trash-footer');
const noteFooter     = $('sidebar-footer');
const menuTrash      = _q('menu-trash') as HTMLButtonElement | null;
const menuFolder     = _q('menu-folder') as HTMLButtonElement | null;
const trashSearchInput = _q('trash-search') as HTMLInputElement | null;
const trashBanner    = _q('trash-banner');
const trashBannerBody = _q('trash-banner-body');
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

// ── Trash mode ──────────────────────────────────────────────────────────────

type SidebarMode = 'notes' | 'trash';
let _sidebarMode: SidebarMode = 'notes';

function _updateMenuChecks(): void {
  const mode = _sidebarMode;
  if (menuFolder) {
    const chk = menuFolder.querySelector('.dropdown-check') as HTMLElement | null;
    if (chk) chk.style.visibility = mode === 'notes' ? 'visible' : 'hidden';
  }
  if (menuTrash) {
    const chk = menuTrash.querySelector('.dropdown-check') as HTMLElement | null;
    if (chk) chk.style.visibility = mode === 'trash' ? 'visible' : 'hidden';
  }
}

let _trashCount = 0;

export function setSidebarMode(mode: SidebarMode): void {
  _sidebarMode = mode;
  _updateMenuChecks();
  if (mode === 'trash') {
    sidebarToolbar.style.display   = 'none';
    noteFooter.style.display       = 'none';
    if (trashToolbar) trashToolbar.style.display     = 'flex';
    if (trashFooter) trashFooter.style.display      = 'flex';
    hideTrashBanner();
  } else {
    sidebarToolbar.style.display   = 'flex';
    noteFooter.style.display       = '';
    if (trashToolbar) trashToolbar.style.display     = 'none';
    if (trashFooter) trashFooter.style.display      = 'none';
  }
}

export function getSidebarMode(): SidebarMode { return _sidebarMode; }

export function setTrashCount(n: number): void {
  _trashCount = n;
  if (menuTrash) {
    const label = n > 0 ? `Trash (${n})` : 'Trash';
    // Preserve the checkmark span
    const chk = menuTrash.querySelector('.dropdown-check');
    menuTrash.childNodes.forEach(c => { if (c !== chk) c.remove(); });
    menuTrash.appendChild(document.createTextNode(' ' + label));
  }
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
  const editorTabs = document.getElementById('editor-tabs');
  const tabRaw = document.getElementById('tab-raw');
  const tabMeta = document.getElementById('tab-meta');
  const emptyState = document.getElementById('empty-state');

  if (editorTabs) editorTabs.style.display = 'none';
  if (tabRaw) tabRaw.classList.remove('active');
  if (tabMeta) tabMeta.classList.remove('active');
  if (emptyState) emptyState.style.display = 'none';

  trashBanner.style.display = 'block';
  if (trashBannerTitle) trashBannerTitle.textContent = `"${id}" is in the trash`;
  if (trashBannerRestore) trashBannerRestore.onclick = onRestore;
  if (trashBannerPurge) trashBannerPurge.onclick = onPurge;

  // ── Parse frontmatter ──────────────────────────────────────────────
  const fm = parseFrontmatter(content);
  const fmMeta = fm.meta;
  const body = fm.body;

  const knownKeys = new Set(['title', 'summary', 'user-tags', 'created', 'updated', 'created_by', 'updated_by']);
  const customFields: [string, string][] = [];
  for (const [k, v] of Object.entries(fmMeta)) {
    if (!knownKeys.has(k)) customFields.push([k, fmtVal(v)]);
  }

  // ── Build body HTML ─────────────────────────────────────────────────
  const parts: string[] = [];

  // Title
  parts.push('<div class="trash-meta-row">');
  parts.push('<label>Title</label>');
  parts.push(`<div class="trash-meta-value">${esc(fmtVal(fmMeta['title']))}</div>`);
  parts.push('</div>');

  // Summary
  parts.push('<div class="trash-meta-row">');
  parts.push('<label>Summary</label>');
  parts.push(`<div class="trash-meta-value">${esc(fmtVal(fmMeta['summary']))}</div>`);
  parts.push('</div>');

  // Tags
  parts.push('<div class="trash-meta-row">');
  parts.push('<label>Tags</label>');
  parts.push(`<div class="trash-meta-value">${esc(fmtVal(fmMeta['user-tags']))}</div>`);
  parts.push('</div>');

  // Custom fields
  if (customFields.length > 0) {
    parts.push('<div class="meta-section-header">Custom Fields</div>');
    parts.push('<table class="trash-fm-table">');
    for (const [k, v] of customFields) {
      parts.push(`<tr><td class="trash-fm-key">${esc(k)}</td><td class="trash-fm-val">${esc(v)}</td></tr>`);
    }
    parts.push('</table>');
  }

  // Content stats (body only)
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;
  const charCount = body.length;
  const lineCount = body ? body.split('\n').length : 0;
  parts.push('<div class="meta-section-header">Size (body only)</div>');
  parts.push(`<div class="meta-stats">${wordCount} words · ${charCount} chars · ${lineCount} lines</div>`);

  // System info
  const fmt = (ts: number | undefined): string => {
    if (!ts) return '—';
    return new Date(ts).toLocaleString();
  };
  parts.push('<div class="meta-section-header">System Info</div>');
  parts.push('<table class="meta-system-table">');
  if (meta.current) parts.push(`<tr><td>Version</td><td>${esc(meta.current)}</td></tr>`);
  if (meta.created_at) parts.push(`<tr><td>Created</td><td>${fmt(meta.created_at)}</td></tr>`);
  if (meta.updated_at) parts.push(`<tr><td>Updated</td><td>${fmt(meta.updated_at)}</td></tr>`);
  if (meta.created_by) parts.push(`<tr><td>Created by</td><td>${esc(meta.created_by)}</td></tr>`);
  if (meta.updated_by) parts.push(`<tr><td>Updated by</td><td>${esc(meta.updated_by)}</td></tr>`);
  parts.push('</table>');

  // Content
  parts.push('<div class="meta-section-header">Content</div>');
  parts.push(`<pre class="trash-banner-content">${esc(body)}</pre>`);

  trashBannerBody.innerHTML = parts.join('');
}

/** Convert frontmatter value to display string. */
function fmtVal(v: string | string[] | undefined): string {
  if (v === undefined) return '—';
  if (Array.isArray(v)) return v.join(', ');
  return v;
}

/** Minimal HTML-escaping for display values. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function hideTrashBanner(): void {
  if (trashBanner) trashBanner.style.display = 'none';
}

// ── Event wiring ────────────────────────────────────────────────────────────

export function bindEvents(handlers: UIEventHandlers): void {
  const {
    onOpen, onDelete, onSearch, onSave, onNew, onRename,
    onResetDB,
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

  // Trash search
  if (trashSearchInput) {
    trashSearchInput.addEventListener('input', () => {
      TrashView.setFilter?.(trashSearchInput.value);
    });
    trashSearchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape' && trashSearchInput.value) {
        e.preventDefault();
        trashSearchInput.value = '';
        TrashView.setFilter?.('');
      }
    });
  }

  // Buttons
  btnSave.addEventListener('click', onSave);
  $('btn-new').addEventListener('click', onNew);
  btnToggleSidebar.addEventListener('click', sidebar.toggleSidebar);

  // Trash buttons (guard against missing elements in test fixtures)
  document.getElementById('btn-empty-trash')?.addEventListener('click', () => handlers.onTrashEmpty?.());

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

  function toggleMenu(): void {
    headerBrand.classList.toggle('open');
  }

  // View-switching menu items
  menuFolder?.addEventListener('click', () => {
    if (getSidebarMode() !== 'notes') handlers.onToggleTrash?.();
    closeMenu();
  });

  menuTrash?.addEventListener('click', () => {
    if (getSidebarMode() !== 'trash') handlers.onToggleTrash?.();
    closeMenu();
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

  // Initialize menu checks on first bind
  _updateMenuChecks();
}
