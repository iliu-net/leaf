/**
 * trash-view.ts — Trash list sidebar view
 *
 * Implements SidebarView<TrashEntry> so it slots into the sidebar event
 * delegation system (sidebar-chrome.ts) the same way TreeView does.
 * Uses context-menu.ts for the ⋯ dropdown menu.
 * Supports client-side filter/search on tombstone IDs.
 */

import type { SidebarView, UIEventHandlers } from './sidebar.js';
import { hydrate } from './fence-hydrate.js';
import type { TrashEntry } from './trash.js';
import * as contextMenu from './context-menu.js';
import { relativeTime, html } from './utils.js';
import { parseFrontmatter } from './frontmatter.js';
import { DOM, $, $maybe } from './dom-ids.js';
import { ICONS, createIcon } from './icons.js';

// ── DOM refs ────────────────────────────────────────────────────────────────

function getFileList(): HTMLElement {
  return $(DOM.FILE_LIST);
}

// ── Filter state ────────────────────────────────────────────────────────────

let _entries: TrashEntry[] = [];
let _filter = '';

function filteredEntries(): TrashEntry[] {
  if (!_filter) return _entries;
  const q = _filter;
  return _entries.filter(e => e.id.toLowerCase().includes(q));
}

// ── Source normalization ────────────────────────────────────────────────────

function normSource(src: 'local' | 'server' | 'both'): 'local' | 'server' {
  return src === 'local' ? 'local' : 'server';
}

// ── Internal render ─────────────────────────────────────────────────────────

function _renderFiltered(): void {
  const fileList = getFileList();
  fileList.innerHTML = '';

  const entries = filteredEntries();

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText =
      'padding:20px 12px;text-align:center;font-size:11px;' +
      'color:var(--text-3);font-family:var(--font-mono)';
    empty.textContent = _filter ? 'No matching items' : 'Trash is empty';
    fileList.appendChild(empty);
    // Update count
    const countEl = $maybe(DOM.TRASH_ITEM_COUNT);
    if (countEl) countEl.textContent = `0 items`;
    return;
  }

  const frag = document.createDocumentFragment();

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'trash-row';
    row.dataset.id = entry.id;
    row.dataset.source = entry.source;

    const icon = createIcon(ICONS.TRASH, { 'stroke-width': '2' });
    icon.classList.add('trash-row-icon');
    row.appendChild(icon);

    const info = document.createElement('div');
    info.className = 'trash-row-info';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'trash-row-name';
    nameSpan.textContent = entry.id;
    nameSpan.title = entry.id;
    info.appendChild(nameSpan);

    const meta = document.createElement('span');
    meta.className = 'trash-row-meta';
    const rel = relativeTime(entry.deleted_at);
    let metaText = `deleted ${rel}`;
    if (entry.updated_by) metaText += ` — ${entry.updated_by}`;
    if (entry.source === 'server') metaText += ' (↑)';
    meta.textContent = metaText;
    info.appendChild(meta);

    row.appendChild(info);

    const more = document.createElement('button');
    more.className = 'file-item-more btn-icon';
    more.textContent = '⋯';
    more.title = 'More actions';
    more.setAttribute('aria-label', `More actions for ${entry.id}`);
    row.appendChild(more);

    frag.appendChild(row);
  }

  fileList.appendChild(frag);

  // Update filtered count in footer
  const countEl = $maybe(DOM.TRASH_ITEM_COUNT);
  const total = _entries.length;
  const shown = entries.length;
  if (countEl) {
    if (shown === total) {
      countEl.textContent = `${total} item${total !== 1 ? 's' : ''}`;
    } else {
      countEl.textContent = `${shown} / ${total}`;
    }
  }
}

// ── TrashView object ────────────────────────────────────────────────────────

export const TrashView: SidebarView<TrashEntry> = {

  render(entries: TrashEntry[], _currentId: string | null): void {
    _entries = entries;
    _filter = '';
    // Clear search input
    const si = $maybe(DOM.TRASH_SEARCH) as HTMLInputElement | null;
    if (si) si.value = '';
    _renderFiltered();
  },

  setFilter(query: string): void {
    _filter = query.toLowerCase().trim();
    _renderFiltered();
  },

  handleClick(e: MouseEvent, handlers: UIEventHandlers): void {
    const target = e.target as HTMLElement;

    // "More" button (⋯)
    const moreBtn = target.closest('.file-item-more');
    if (moreBtn) {
      const row = (moreBtn as HTMLElement).closest('[data-id]') as HTMLElement | null;
      const id = row?.dataset.id;
      const src = (row?.dataset.source ?? 'local') as 'local' | 'server' | 'both';
      if (id) {
        contextMenu.show(moreBtn as HTMLElement, [
          { label: 'Restore', action: () => handlers.onTrashRestore?.(id, normSource(src)) },
          { label: 'Delete forever', action: () => handlers.onTrashPurge?.(id, src), danger: true },
        ]);
      }
      return;
    }

    // Row click → preview
    const row = target.closest('.trash-row');
    if (row) {
      const id = (row as HTMLElement).dataset.id;
      const src = ((row as HTMLElement).dataset.source ?? 'local') as 'local' | 'server' | 'both';
      if (id) handlers.onTrashPreview?.(id, normSource(src));
    }
  },

  updateNoteCount(total: number, _shown: number): void {
    const el = $maybe(DOM.TRASH_ITEM_COUNT);
    if (el) el.textContent = `${total} item${total !== 1 ? 's' : ''}`;
    const emptyBtn = $maybe(DOM.BTN_EMPTY_TRASH) as HTMLButtonElement | null;
    if (emptyBtn) emptyBtn.disabled = total === 0;
  },

  destroy(): void {
    contextMenu.close();
    getFileList().innerHTML = '';
    _entries = [];
    _filter = '';
  },
};

// ── Trash preview (main editor area) ────────────────────────────────────────

/**
 * Show a read-only preview of a deleted note in the editor area.
 * Hides all editor tab panels and delegates content rendering to
 * markdown-view.renderView() — the single shared read-only render path.
 */
export function showTrashPreview(
  id: string,
  content: string,
  meta: { created_at?: number; updated_at?: number; created_by?: string; updated_by?: string; current?: string },
  onRestore: () => void,
  onPurge: () => void,
): void {
  // DOM refs queried on each call (not cached — only shown transiently)
  const trashBanner   = $maybe(DOM.TRASH_BANNER);
  const trashBody     = $maybe(DOM.TRASH_BANNER_BODY);
  const trashTitle    = $maybe(DOM.TRASH_BANNER_TITLE);
  const btnRestore    = $maybe(DOM.TRASH_BANNER_RESTORE) as HTMLButtonElement | null;
  const btnPurge      = $maybe(DOM.TRASH_BANNER_PURGE)   as HTMLButtonElement | null;

  if (!trashBanner || !trashBody) return;

  // Hide all editor panels + empty state
  const editorTabs = $maybe(DOM.EDITOR_TABS);
  for (const panelId of [DOM.TAB_VIEW, DOM.TAB_RAW, DOM.TAB_META]) {
    const panel = $maybe(panelId);
    if (panel) panel.classList.remove('active');
  }
  const emptyState = $maybe(DOM.EMPTY_STATE);
  if (editorTabs) editorTabs.style.display = 'none';
  if (emptyState) emptyState.style.display = 'none';

  // Show banner chrome
  trashBanner.style.display = 'block';
  if (trashTitle) trashTitle.textContent = `"${id}" is in the trash`;
  if (btnRestore) btnRestore.onclick = onRestore;
  if (btnPurge)   btnPurge.onclick   = onPurge;

  // Build synthetic NoteData for the shared renderView
  const fm = parseFrontmatter(content);
  const noteData = {
    id,
    content,
    created_at: meta.created_at ?? 0,
    updated_at: meta.updated_at ?? 0,
    current: meta.current ?? '',
    created_by: meta.created_by ?? '',
    updated_by: meta.updated_by ?? '',
    meta: fm.meta,
  };

  // Delegate to markdown view (single read-only render path)
  import('./markdown-view.js').then(async mod => {
    trashBody.innerHTML = html`<div class="trash-fm-wrap">${await mod.renderView(content, noteData)}</div>`;
    hydrate(trashBody).catch(err =>
      console.warn('[trash-view] hydrate failed:', err)
    );
  });
}

/** Hide the trash preview banner. */
export function hideTrashPreview(): void {
  const trashBanner = $maybe(DOM.TRASH_BANNER);
  if (trashBanner) trashBanner.style.display = 'none';
}
