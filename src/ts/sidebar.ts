/**
 * sidebar.ts — Sidebar shell, mode switching, and view delegation
 *
 * Owns all sidebar DOM chrome (#file-list, toolbars, footers, search inputs,
 * menu dropdowns, loading indicator).  View modules (tree.ts, trash-view.ts,
 * future tag-view.ts) implement SidebarView<T> and are imported directly.
 *
 * Previously this logic was split across sidebar-chrome.ts, ui.ts (mode
 * state + trash chrome), and view.ts (interfaces).  Consolidating into one
 * module lets the shell own all chrome decisions — views are pure renderers.
 */

import type { NoteMeta } from './notes.js';
import { TreeView } from './tree.js';
import { TrashView } from './trash-view.js';

// ── Interfaces ─────────────────────────────────────────────────────────────────

/** Event handler callbacks wired from app.ts. */
export interface UIEventHandlers {
  onOpen:          (id: string) => void;
  onDelete:        (id: string) => void;
  onSearch:        (q: string) => void;
  onSave:          () => void;
  onNew:           () => void;
  onCreate:        () => void;
  onCancelModal:   () => void;
  onLogin:         (u: string, p: string) => void;
  onLogout:        () => void;
  onRename:        (id: string) => void;
  onRenameConfirm: (oldId: string) => void;
  onResetDB:       () => void;
  onSignIn:        () => void;
  onDismissLogin:  () => void;
  // ── Trash ──
  onToggleTrash:   () => void;
  onTrashPreview:  (id: string, source: 'local' | 'server') => void;
  onTrashRestore:  (id: string, source: 'local' | 'server') => void;
  onTrashPurge:    (id: string, source: 'local' | 'server' | 'both') => void;
  onTrashEmpty:    () => void;
}

/** Sidebar view contract — each sidebar mode implements one of these. */
export interface SidebarView<T = NoteMeta> {
  render(items: T[], currentId: string | null): void;
  handleClick(e: MouseEvent, handlers: UIEventHandlers): void;
  updateNoteCount(total: number, shown: number): void;
  destroy(): void;
  setFilter?(query: string): void;
}

// ── State ──────────────────────────────────────────────────────────────────────

type SidebarMode = 'notes' | 'trash';
let _mode: SidebarMode = 'notes';
let _currentView: SidebarView<any> | null = null;
let _trashCount = 0;

// ── DOM refs (lazy — queried once on first access) ─────────────────────────────

let _fileList: HTMLElement | null = null;
function fileList(): HTMLElement { return _fileList ??= document.getElementById('file-list')!; }

let _searchInput: HTMLInputElement | null = null;
function searchInput(): HTMLInputElement { return _searchInput ??= document.getElementById('search') as HTMLInputElement; }

let _sidebarLoad: HTMLElement | null = null;
function sidebarLoad(): HTMLElement { return _sidebarLoad ??= document.getElementById('sidebar-loading')!; }

let _appShell: HTMLElement | null = null;
function appShell(): HTMLElement { return _appShell ??= document.getElementById('app')!; }

function getEl(id: string): HTMLElement | null { return document.getElementById(id); }

// ── Mode ───────────────────────────────────────────────────────────────────────

export function getMode(): SidebarMode { return _mode; }

/** Return the active sidebar view (for direct render calls). */
export function getView(): SidebarView<any> | null { return _currentView; }

export function setMode(mode: SidebarMode): void {
  _mode = mode;
  _updateMenuChecks();

  const sidebarToolbar = getEl('sidebar-toolbar')!;
  const noteFooter     = getEl('sidebar-footer')!;
  const trashToolbar   = getEl('trash-toolbar');
  const trashFooter    = getEl('trash-footer');

  if (mode === 'trash') {
    sidebarToolbar.style.display = 'none';
    noteFooter.style.display     = 'none';
    if (trashToolbar) trashToolbar.style.display = 'flex';
    if (trashFooter)  trashFooter.style.display  = 'flex';
    _currentView = TrashView;
  } else {
    sidebarToolbar.style.display = 'flex';
    noteFooter.style.display     = '';
    if (trashToolbar) trashToolbar.style.display = 'none';
    if (trashFooter)  trashFooter.style.display  = 'none';
    _currentView = TreeView;
  }
}

// ── Trash count badge ──────────────────────────────────────────────────────────

export function setTrashCount(n: number): void {
  _trashCount = n;
  const menuTrash = getEl('menu-trash') as HTMLButtonElement | null;
  if (menuTrash) {
    const label = n > 0 ? `Trash (${n})` : 'Trash';
    const chk = menuTrash.querySelector('.dropdown-check');
    menuTrash.childNodes.forEach(c => { if (c !== chk) c.remove(); });
    menuTrash.appendChild(document.createTextNode(' ' + label));
  }
}

// ── File list ──────────────────────────────────────────────────────────────────

export function renderFileList(notes: NoteMeta[], currentId: string | null): void {
  _currentView = TreeView;
  TreeView.render(notes, currentId);
}

export function setActiveFile(id: string): void {
  fileList().querySelectorAll('.file-item').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset.id === id);
  });
}

export function updateNoteCount(total: number, shown: number): void {
  (_currentView ?? TreeView).updateNoteCount(total, shown);
}

export function setSidebarLoading(loading: boolean): void {
  const el = sidebarLoad();
  if (!el) return;
  el.style.display = loading ? 'flex' : 'none';
}

export function toggleSidebar(): void {
  appShell().classList.toggle('sidebar-collapsed');
}

export function clearSearch(): void {
  const si = searchInput();
  if (si.value) {
    si.value = '';
    si.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// ── Menu checkmarks ────────────────────────────────────────────────────────────

function _updateMenuChecks(): void {
  const menuFolder = getEl('menu-folder');
  const menuTrash  = getEl('menu-trash');
  if (menuFolder) {
    const chk = menuFolder.querySelector('.dropdown-check') as HTMLElement | null;
    if (chk) chk.style.visibility = _mode === 'notes' ? 'visible' : 'hidden';
  }
  if (menuTrash) {
    const chk = menuTrash.querySelector('.dropdown-check') as HTMLElement | null;
    if (chk) chk.style.visibility = _mode === 'trash' ? 'visible' : 'hidden';
  }
}

// ── Event wiring ───────────────────────────────────────────────────────────────

/**
 * Wire all sidebar DOM events. Called once by ui.bindEvents().
 */
export function init(handlers: UIEventHandlers): void {
  // File list — event delegation to the active sidebar view
  fileList().addEventListener('click', e => {
    _currentView?.handleClick(e, handlers);
  });

  // Notes search
  const si = searchInput();
  si.addEventListener('input', () => handlers.onSearch(si.value));
  si.addEventListener('keydown', e => {
    if (e.key === 'Escape' && si.value) {
      e.preventDefault();
      si.value = '';
      handlers.onSearch('');
    }
  });

  // Trash search
  const ts = getEl('trash-search') as HTMLInputElement | null;
  if (ts) {
    ts.addEventListener('input', () => { TrashView.setFilter?.(ts.value); });
    ts.addEventListener('keydown', e => {
      if (e.key === 'Escape' && ts.value) {
        e.preventDefault();
        ts.value = '';
        TrashView.setFilter?.('');
      }
    });
  }

  // Trash buttons
  getEl('btn-empty-trash')?.addEventListener('click', () => handlers.onTrashEmpty?.());

  // App menu dropdown — view switching
  const headerBrand = getEl('header-brand')!;
  const menuFolder  = getEl('menu-folder');
  const menuTrash   = getEl('menu-trash');

  menuFolder?.addEventListener('click', () => {
    if (_mode !== 'notes') handlers.onToggleTrash?.();
    headerBrand.classList.remove('open');
  });

  menuTrash?.addEventListener('click', () => {
    if (_mode !== 'trash') handlers.onToggleTrash?.();
    headerBrand.classList.remove('open');
  });
}
