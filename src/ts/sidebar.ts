/**
 * sidebar.ts — Sidebar shell, mode switching, and view delegation
 *
 * Owns all sidebar DOM chrome (#file-list, toolbars, footers, search inputs,
 * menu dropdowns, loading indicator).  View modules (tree-view.ts, trash-view.ts,
 * future tag-view.ts) implement SidebarView<T> and are imported directly.
 *
 * Previously this logic was split across sidebar-chrome.ts, ui.ts (mode
 * state + trash chrome), and view.ts (interfaces).  Consolidating into one
 * module lets the shell own all chrome decisions — views are pure renderers.
 */

import type { NoteMeta } from './notes.js';
import { TreeView, SystemTreeView } from './tree-view.js';
import type { SystemNoteDef } from './system-notes/registry.js';
import { listSystemNotes } from './system-notes/registry.js';
import { TrashView } from './trash-view.js';
import { DOM, $, $maybe } from './dom-ids.js';
import { sidebarWidth } from './local-store.js';

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

// ── Mode ───────────────────────────────────────────────────────────────────────

export function getMode(): SidebarMode { return _mode; }

/** Return the active sidebar view (for direct render calls). */
export function getView(): SidebarView<any> | null { return _currentView; }

export function setMode(mode: SidebarMode): void {
  _mode = mode;
  _updateMenuChecks();

  const sidebarToolbar = $(DOM.SIDEBAR_TOOLBAR);
  const noteFooter     = $(DOM.SIDEBAR_FOOTER);
  const trashToolbar   = $maybe(DOM.TRASH_TOOLBAR);
  const trashFooter    = $maybe(DOM.TRASH_FOOTER);
  const sysSection     = $maybe(DOM.SYSTEM_NOTES_SECTION);

  if (mode === 'trash') {
    sidebarToolbar.style.display = 'none';
    noteFooter.style.display     = 'none';
    if (trashToolbar) trashToolbar.style.display = 'flex';
    if (trashFooter)  trashFooter.style.display  = 'flex';
    if (sysSection)   sysSection.style.display   = 'none';
    _currentView = TrashView;
  } else {
    sidebarToolbar.style.display = 'flex';
    noteFooter.style.display     = '';
    if (trashToolbar) trashToolbar.style.display = 'none';
    if (trashFooter)  trashFooter.style.display  = 'none';
    _currentView = TreeView;
    renderSystemSection();
  }
}

// ── Trash count badge ──────────────────────────────────────────────────────────

export function setTrashCount(n: number): void {
  _trashCount = n;
  const menuTrash = $maybe(DOM.MENU_TRASH) as HTMLButtonElement | null;
  if (menuTrash) {
    const label = n > 0 ? `Trash (${n})` : 'Trash';
    const chk = menuTrash.querySelector('.dropdown-check');
    menuTrash.childNodes.forEach(c => { if (c !== chk) c.remove(); });
    menuTrash.appendChild(document.createTextNode(' ' + label));
  }
}

// ── Note list ──────────────────────────────────────────────────────────────────

export function renderNoteList(notes: NoteMeta[], currentId: string | null): void {
  _currentView = TreeView;
  TreeView.render(notes, currentId);
}

export function setActiveNote(id: string): void {
  // Update active state in both the user file list and the system notes list
  [DOM.FILE_LIST, DOM.SYSTEM_NOTES_LIST].forEach(listId => {
    const el = $maybe(listId);
    if (!el) return;
    el.querySelectorAll('.file-item').forEach(item => {
      item.classList.toggle('active', (item as HTMLElement).dataset.id === id);
    });
  });
}

/**
 * Render (or re-render) the system notes section below the user note list.
 */
export function renderSystemSection(): void {
  const section = $maybe(DOM.SYSTEM_NOTES_SECTION);
  if (!section) return;

  const sysNotes = listSystemNotes();
  if (sysNotes.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  // Query the search input to determine if a search is active.
  // During search, system notes are merged into the main file list
  // and the system section is hidden.
  const searchInput = $maybe(DOM.SEARCH) as HTMLInputElement | null;
  if (searchInput && searchInput.value.trim()) {
    section.style.display = 'none';
    return;
  }

  SystemTreeView.render(sysNotes, null);
}

export function updateNoteCount(total: number, shown: number): void {
  (_currentView ?? TreeView).updateNoteCount(total, shown);
}

export function setSidebarLoading(loading: boolean): void {
  const el = $maybe(DOM.SIDEBAR_LOADING);
  if (!el) return;
  el.style.display = loading ? 'flex' : 'none';
}

export function toggleSidebar(): void {
  $(DOM.APP).classList.toggle('sidebar-collapsed');
}

export function clearSearch(): void {
  const si = $(DOM.SEARCH) as HTMLInputElement;
  if (si.value) {
    si.value = '';
    si.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// ── Menu checkmarks ────────────────────────────────────────────────────────────

function _updateMenuChecks(): void {
  const menuFolder = $maybe(DOM.MENU_FOLDER);
  const menuTrash  = $maybe(DOM.MENU_TRASH);
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
  $(DOM.FILE_LIST).addEventListener('click', e => {
    _currentView?.handleClick(e, handlers);
  });

  // System notes — click delegation to SystemTreeView
  $maybe(DOM.SYSTEM_NOTES_LIST)?.addEventListener('click', e => {
    SystemTreeView.handleClick(e, handlers);
  });

  // Notes search
  const si = $(DOM.SEARCH) as HTMLInputElement;
  si.addEventListener('input', () => handlers.onSearch(si.value));
  si.addEventListener('keydown', e => {
    if (e.key === 'Escape' && si.value) {
      e.preventDefault();
      si.value = '';
      handlers.onSearch('');
    }
  });

  // Trash search
  const ts = $maybe(DOM.TRASH_SEARCH) as HTMLInputElement | null;
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
  $maybe(DOM.BTN_EMPTY_TRASH)?.addEventListener('click', () => handlers.onTrashEmpty?.());

  // App menu dropdown — view switching
  const headerBrand = $(DOM.HEADER_BRAND);
  const menuFolder  = $maybe(DOM.MENU_FOLDER);
  const menuTrash   = $maybe(DOM.MENU_TRASH);

  menuFolder?.addEventListener('click', () => {
    if (_mode !== 'notes') handlers.onToggleTrash?.();
    headerBrand.classList.remove('open');
  });

  menuTrash?.addEventListener('click', () => {
    if (_mode !== 'trash') handlers.onToggleTrash?.();
    headerBrand.classList.remove('open');
  });
}

// ── Resizable sidebar ──────────────────────────────────────────────────────────

const RESIZER_MIN = 120;
const RESIZER_MAX = 500;

let _resizerDragging = false;

/**
 * Initialise the sidebar drag-resize handle.
 *
 * Drag the `#sidebar-resizer` element to resize the sidebar (and the
 * header-brand) between {@link RESIZER_MIN}px and {@link RESIZER_MAX}px.
 * The width is persisted to localStorage and restored on page load.
 */
export function initResizer(): void {
  const sidebar = $maybe(DOM.SIDEBAR);
  const resizer = $maybe(DOM.SIDEBAR_RESIZER);
  const app     = $(DOM.APP);
  if (!sidebar || !resizer) return;

  // ── Restore persisted width ──
  const saved = sidebarWidth.get();
  if (saved) {
    const w = Math.min(RESIZER_MAX, Math.max(RESIZER_MIN, Number(saved)));
    if (!Number.isNaN(w)) _setResizerWidth(app, w);
  }

  // ── Drag state ──
  let startX = 0;
  let startW = 0;

  resizer.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    _resizerDragging = true;
    startX = e.clientX;
    startW = sidebar.getBoundingClientRect().width;
    resizer.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp, { once: true });
  });

  function onMouseMove(e: MouseEvent): void {
    if (!_resizerDragging) return;
    const dx = e.clientX - startX;
    const w = Math.min(RESIZER_MAX, Math.max(RESIZER_MIN, startW + dx));
    _setResizerWidth(app, w);
  }

  function onMouseUp(): void {
    _resizerDragging = false;
    resizer!.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMouseMove);

    const w = sidebar!.getBoundingClientRect().width;
    sidebarWidth.set(w);
  }
}

function _setResizerWidth(container: HTMLElement, w: number): void {
  container.style.setProperty('--sidebar-w', `${w}px`);
}
