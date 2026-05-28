/**
 * trash-view.ts — Trash list sidebar view
 *
 * Implements SidebarView<TrashEntry> so it slots into the sidebar event
 * delegation system (sidebar-chrome.ts) the same way TreeView does.
 * Uses context-menu.ts for the ⋯ dropdown menu.
 * Supports client-side filter/search on tombstone IDs.
 */

import type { SidebarView, UIEventHandlers } from './view.js';
import type { TrashEntry } from './trash-service.js';
import * as contextMenu from './context-menu.js';
import { relativeTime } from './utils.js';

// ── DOM refs ────────────────────────────────────────────────────────────────

function getFileList(): HTMLElement {
  return document.getElementById('file-list')!;
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
    const countEl = document.getElementById('trash-item-count');
    if (countEl) countEl.textContent = `0 items`;
    return;
  }

  const frag = document.createDocumentFragment();

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'trash-row';
    row.dataset.id = entry.id;
    row.dataset.source = entry.source;

    const ns = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(ns, 'svg');
    icon.setAttribute('width', '13');
    icon.setAttribute('height', '13');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.classList.add('trash-row-icon');
    icon.innerHTML =
      '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14"/>';
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
  const countEl = document.getElementById('trash-item-count');
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
    const si = document.getElementById('trash-search') as HTMLInputElement | null;
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
    const el = document.getElementById('trash-item-count');
    if (el) el.textContent = `${total} item${total !== 1 ? 's' : ''}`;
    const emptyBtn = document.getElementById('btn-empty-trash') as HTMLButtonElement | null;
    if (emptyBtn) emptyBtn.disabled = total === 0;
  },

  destroy(): void {
    contextMenu.close();
    getFileList().innerHTML = '';
    _entries = [];
    _filter = '';
  },
};
