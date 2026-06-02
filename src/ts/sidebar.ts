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

import type { NoteMeta, FullTextResult } from './notes.js';
import { TreeView, SystemTreeView } from './tree-view.js';
import type { SystemNoteDef } from './system-notes/registry.js';
import { listSystemNotes } from './system-notes/registry.js';
import { TrashView } from './trash-view.js';
import { TagView, type TagViewItem } from './tag-view.js';
import { DOM, $, $maybe } from './dom-ids.js';
import { sidebarWidth } from './local-store.js';
import { ICONS, createIcon } from './icons.js';

// ── Interfaces ─────────────────────────────────────────────────────────────────

/** Event handler callbacks wired from app.ts. */
export interface UIEventHandlers {
  onOpen:          (id: string) => void;
  onDelete:        (id: string) => void;
  onSearch:        (q: string) => void;
  onFullTextSearch:(q: string) => void;
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
  onToggleTags:   () => void;
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

type SidebarMode = 'notes' | 'trash' | 'tags';
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

  // Clear search when switching between modes (shared search input)
  const si = $maybe(DOM.SEARCH) as HTMLInputElement | null;
  if (si && si.value.trim()) {
    si.value = '';
  }

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
  } else if (mode === 'tags') {
    sidebarToolbar.style.display = 'flex';
    noteFooter.style.display     = '';
    if (trashToolbar) trashToolbar.style.display = 'none';
    if (trashFooter)  trashFooter.style.display  = 'none';
    if (sysSection)   sysSection.style.display   = 'none';
    _currentView = TagView;
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

/**
 * Render full-text search results as a flat list with content snippets.
 */
export function renderFullTextResults(results: FullTextResult[], currentId: string | null): void {
  const fileList = $(DOM.FILE_LIST);
  fileList.innerHTML = '';

  if (results.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText =
      'padding:20px 12px;text-align:center;font-size:11px;' +
      'color:var(--text-3);font-family:var(--font-mono)';
    empty.textContent = 'No results found';
    fileList.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();

  for (const r of results) {
    const item = document.createElement('div');
    item.className = 'file-item' + (r.id === currentId ? ' active' : '');
    item.dataset.id = r.id;
    item.setAttribute('role', 'listitem');

    const icon = createIcon(ICONS.DOCUMENT);
    icon.classList.add('file-item-icon');
    item.appendChild(icon);

    const text = document.createElement('div');
    text.className = 'file-item-text';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-item-name';
    nameSpan.title = r.id;
    nameSpan.textContent = r.id;
    text.appendChild(nameSpan);

    const snippet = document.createElement('span');
    snippet.className = 'file-item-snippet';
    snippet.textContent = r.snippet;
    text.appendChild(snippet);

    item.appendChild(text);
    frag.appendChild(item);
  }

  fileList.appendChild(frag);
}

/**
 * Render the tag-view list.
 * Called by notes-ctrl.ts when switching to tags mode or refreshing tags.
 */
export function renderTagList(items: TagViewItem[], currentId: string | null): void {
  _currentView = TagView;
  TagView.render(items, currentId);
}

export function setSidebarLoading(loading: boolean): void {
  const el = $maybe(DOM.SIDEBAR_LOADING);
  if (!el) return;
  el.style.display = loading ? 'flex' : 'none';
}

/** Toggle sidebar visibility — collapsed on desktop, slide-over on mobile. */
export function toggleSidebar(): void {
  const app = $(DOM.APP);
  const isMobile = window.matchMedia('(max-width: 768px)').matches;

  if (isMobile) {
    app.classList.toggle('sidebar-open');
  } else {
    app.classList.toggle('sidebar-collapsed');
  }
}

export function clearSearch(): void {
  const si = $(DOM.SEARCH) as HTMLInputElement;
  if (si.value) {
    si.value = '';
    si.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// ── Menu checkmarks ────────────────────────────────────────────────────────────

/** Close the mobile sidebar only when a note/trash-item was actually opened. */
function _closeMobileSidebarIfNoteOpened(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  // Don't close on tree toggles, branch-only rows, or context-menu buttons
  if (target.closest('.tree-toggle, .tree-branch-only, .file-item-more')) return;
  // Close only when a note or trash item was actually clicked
  if (!target.closest('.file-item') && !target.closest('.trash-row')) return;
  const app = $(DOM.APP);
  app.classList.remove('sidebar-open');
}

function _updateMenuChecks(): void {
  const menuFolder = $maybe(DOM.MENU_FOLDER);
  const menuTags   = $maybe(DOM.MENU_TAGS);
  const menuTrash  = $maybe(DOM.MENU_TRASH);
  if (menuFolder) {
    const chk = menuFolder.querySelector('.dropdown-check') as HTMLElement | null;
    if (chk) chk.style.visibility = _mode === 'notes' ? 'visible' : 'hidden';
  }
  if (menuTags) {
    const chk = menuTags.querySelector('.dropdown-check') as HTMLElement | null;
    if (chk) chk.style.visibility = _mode === 'tags' ? 'visible' : 'hidden';
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
  // ── Sidebar backdrop for mobile slide-over ────────────────────────────
  // Created once; shown/hidden via CSS when .sidebar-open is toggled.
  let backdrop = document.getElementById('sidebar-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'sidebar-backdrop';
    document.getElementById(DOM.APP)!.appendChild(backdrop);
  }
  backdrop.addEventListener('click', () => {
    const app = $(DOM.APP);
    app.classList.remove('sidebar-open');
  });

  // ── Escape key closes mobile sidebar ──────────────────────────────────
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      const app = $(DOM.APP);
      if (app.classList.contains('sidebar-open')) {
        e.preventDefault();
        app.classList.remove('sidebar-open');
      }
    }
  });

  // File list — event delegation to the active sidebar view
  $(DOM.FILE_LIST).addEventListener('click', e => {
    _currentView?.handleClick(e, handlers);
    _closeMobileSidebarIfNoteOpened(e);
  });

  // System notes — click delegation to SystemTreeView
  $maybe(DOM.SYSTEM_NOTES_LIST)?.addEventListener('click', e => {
    SystemTreeView.handleClick(e, handlers);
    _closeMobileSidebarIfNoteOpened(e);
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
    if (e.key === 'Enter' && si.value.trim()) {
      e.preventDefault();
      handlers.onFullTextSearch(si.value.trim());
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
  const menuTags    = $maybe(DOM.MENU_TAGS);
  const menuTrash   = $maybe(DOM.MENU_TRASH);

  menuFolder?.addEventListener('click', () => {
    if (_mode === 'trash') handlers.onToggleTrash?.();
    else if (_mode === 'tags') handlers.onToggleTags?.();
    headerBrand.classList.remove('open');
  });

  menuTags?.addEventListener('click', () => {
    if (_mode === 'trash') {
      // Two-step: trash → notes → tags
      _mode = 'notes';
      handlers.onToggleTags?.();
    } else if (_mode !== 'tags') {
      handlers.onToggleTags?.();
    }
    headerBrand.classList.remove('open');
  });

  menuTrash?.addEventListener('click', () => {
    if (_mode === 'tags') {
      // Two-step: tags → notes → trash
      _mode = 'notes';
      handlers.onToggleTrash?.();
    } else if (_mode !== 'trash') {
      handlers.onToggleTrash?.();
    }
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
