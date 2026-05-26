/**
 * sidebar-chrome.ts — sidebar shell operations
 *
 * Extracted from ui.ts. Owns the DOM chrome around #file-list:
 * rendering, active-file highlighting, note count, loading indicator,
 * sidebar toggle, and search clear.
 *
 * Delegates list rendering to the active SidebarView (default: TreeView).
 */

import type { NoteMeta } from './store.js';
import type { SidebarView } from './view.js';
import { TreeView } from './tree.js';

// ── DOM refs ────────────────────────────────────────────────────────────────

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const fileList    = $('file-list');
const searchInput  = $('search') as HTMLInputElement;
const sidebarLoad  = $('sidebar-loading');
const appShell     = $('app');

// ── State ───────────────────────────────────────────────────────────────────

/** Active sidebar view — defaults to TreeView on first render. */
let currentView: SidebarView | null = null;

// ── File list ───────────────────────────────────────────────────────────────

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

/** Get the active sidebar view (for event delegation in bindEvents). */
export function getCurrentView(): SidebarView | null {
  return currentView;
}

/** Clear the search input and reset the note list. */
export function clearSearch(): void {
  if (searchInput.value) {
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
