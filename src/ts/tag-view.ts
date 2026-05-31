/**
 * tag-view.ts — Tags mode sidebar view
 *
 * Groups notes by their merged tags (user-tags + auto-tags via mergeTags)
 * and renders expandable tag sections. Untagged notes appear at the bottom
 * under "Untagged". Implements SidebarView<TagViewItem> so it slots into
 * the sidebar event delegation system the same way TreeView does.
 */

import type { SidebarView, UIEventHandlers } from './sidebar.js';
import type { NoteMeta } from './notes.js';
import { DOM, $, $maybe } from './dom-ids.js';
import { ICONS, createIcon } from './icons.js';
import { naturalCompare } from './utils.js';

// ── Types ────────────────────────────────────────────────────────────────

/** NoteMeta enriched with the final merged tag set for display grouping. */
export interface TagViewItem extends NoteMeta {
  tags: string[];   // merged user-tags + auto-tags (sorted, deduped)
}

interface TagGroup {
  tag: string;
  notes: TagViewItem[];
}

// ── Module state ─────────────────────────────────────────────────────────

let _groups: TagGroup[] = [];
let _untagged: TagViewItem[] = [];
let _expanded = new Set<string>();
let _filter = '';
let _currentId: string | null = null;

// ── DOM refs ─────────────────────────────────────────────────────────────

function getFileList(): HTMLElement {
  return $(DOM.FILE_LIST);
}

// ── Group builder ────────────────────────────────────────────────────────

function buildGroups(items: TagViewItem[]): { groups: TagGroup[]; untagged: TagViewItem[] } {
  const tagMap = new Map<string, TagViewItem[]>();
  const untagged: TagViewItem[] = [];

  for (const item of items) {
    if (item.tags.length === 0) {
      untagged.push(item);
      continue;
    }
    for (const tag of item.tags) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag)!.push(item);
    }
  }

  const groups: TagGroup[] = [...tagMap.entries()]
    .sort(([a], [b]) => naturalCompare(a, b))
    .map(([tag, notes]) => ({
      tag,
      notes: notes.sort((a, b) => naturalCompare(a.id, b.id)),
    }));

  return {
    groups,
    untagged: untagged.sort((a, b) => naturalCompare(a.id, b.id)),
  };
}

// ── Filter ────────────────────────────────────────────────────────────────

function applyFilter(): { groups: TagGroup[]; untagged: TagViewItem[] } {
  if (!_filter) return { groups: _groups, untagged: _untagged };
  const q = _filter.toLowerCase();

  const filteredGroups = _groups
    .map(({ tag, notes }) => ({
      tag,
      notes: notes.filter(n => n.id.toLowerCase().includes(q) || n.tags.some(t => t.toLowerCase().includes(q))),
    }))
    .filter(g => g.tag.toLowerCase().includes(q) || g.notes.length > 0);

  const filteredUntagged = _untagged.filter(n => n.id.toLowerCase().includes(q));

  return { groups: filteredGroups, untagged: filteredUntagged };
}

// ── Render ────────────────────────────────────────────────────────────────

function _renderTagRow(
  frag: DocumentFragment,
  tag: string,
  notes: TagViewItem[],
  indent: number,
): void {
  // Auto-expand during search or if previously expanded
  const isSearching = _filter.length > 0;
  const isExpanded = isSearching || _expanded.has(tag);

  // ── Header bar ──────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'tree-bar';
  bar.dataset.tag = tag;
  bar.style.paddingLeft = `${12 + indent * 16}px`;

  // Toggle arrow
  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  toggle.textContent = isExpanded ? '▼' : '▶';
  toggle.setAttribute('aria-label', isExpanded ? 'Collapse' : 'Expand');
  bar.appendChild(toggle);

  // Tag icon
  const icon = createIcon(ICONS.DOCUMENT);
  icon.classList.add('file-item-icon');
  bar.appendChild(icon);

  // Tag name
  const label = document.createElement('span');
  label.className = 'file-item-name';
  label.textContent = tag;
  bar.appendChild(label);

  // Count badge
  const badge = document.createElement('span');
  badge.className = 'tag-count';
  badge.textContent = String(notes.length);
  bar.appendChild(badge);

  frag.appendChild(bar);

  // ── Children ────────────────────────────────────────────────────────────
  const container = document.createElement('div');
  container.className = 'tree-children';
  container.dataset.tag = tag;
  container.style.display = isExpanded ? 'block' : 'none';

  for (const note of notes) {
    const item = document.createElement('div');
    item.className = 'file-item' + (note.id === _currentId ? ' active' : '');
    item.dataset.id = note.id;
    item.style.paddingLeft = `${28 + indent * 16}px`;

    const noteIcon = createIcon(ICONS.DOCUMENT);
    noteIcon.classList.add('file-item-icon');
    item.appendChild(noteIcon);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-item-name';
    nameSpan.title = note.id;
    nameSpan.textContent = note.id;
    item.appendChild(nameSpan);

    // Show note's other tags (excluding the current group tag)
    const otherTags = note.tags.filter(t => t !== tag);
    if (otherTags.length > 0) {
      const tagsSpan = document.createElement('span');
      tagsSpan.className = 'file-item-tags';
      tagsSpan.textContent = otherTags.join(', ');
      item.appendChild(tagsSpan);
    }

    container.appendChild(item);
  }

  frag.appendChild(container);
}

function _renderAll(): void {
  const fileList = getFileList();
  fileList.innerHTML = '';

  const { groups, untagged } = applyFilter();
  const totalGroups = groups.length + (untagged.length > 0 ? 1 : 0);

  if (totalGroups === 0) {
    const empty = document.createElement('div');
    empty.style.cssText =
      'padding:20px 12px;text-align:center;font-size:11px;' +
      'color:var(--text-3);font-family:var(--font-mono)';
    empty.textContent = _filter ? 'No matching tags or notes' : 'No tags';
    fileList.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();

  for (const { tag, notes } of groups) {
    _renderTagRow(frag, tag, notes, 0);
  }

  if (untagged.length > 0) {
    _renderTagRow(frag, 'Untagged', untagged, 0);
  }

  fileList.appendChild(frag);
}

// ── Exported: TagView object ─────────────────────────────────────────────

export const TagView: SidebarView<TagViewItem> = {

  render(items: TagViewItem[], currentId: string | null): void {
    _currentId = currentId;
    _filter = '';
    const { groups, untagged } = buildGroups(items);
    _groups = groups;
    _untagged = untagged;
    // Preserve expansion state across refreshes — only auto-expand on
    // first render (empty set means fresh view)
    if (_expanded.size === 0 && _groups.length > 0) {
      // Auto-expand the first tag group for discoverability
      _expanded.add(_groups[0].tag);
    }
    _renderAll();
  },

  handleClick(e: MouseEvent, handlers: UIEventHandlers): void {
    const target = e.target as HTMLElement;

    // Toggle arrow
    const toggle = target.closest('.tree-toggle');
    if (toggle) {
      const bar = (toggle as HTMLElement).closest('[data-tag]') as HTMLElement | null;
      if (bar?.dataset.tag) {
        const tag = bar.dataset.tag;
        const container = document.querySelector(
          `.tree-children[data-tag="${CSS.escape(tag)}"]`
        ) as HTMLElement | null;
        if (container) {
          const isVisible = container.style.display !== 'none';
          container.style.display = isVisible ? 'none' : 'block';
          toggle.textContent = isVisible ? '▶' : '▼';
          toggle.setAttribute('aria-label', isVisible ? 'Expand' : 'Collapse');
          if (isVisible) _expanded.delete(tag);
          else _expanded.add(tag);
        }
      }
      return;
    }

    // Tag bar click (not on toggle) → toggle the group.
    // Only match the header row (.tree-bar), not the children container
    // (which also carries data-tag).
    const tagBar = target.closest('.tree-bar[data-tag]');
    if (tagBar) {
      const toggleEl = tagBar.querySelector('.tree-toggle') as HTMLElement | null;
      if (toggleEl) {
        toggleEl.click();
        return;
      }
    }

    // Note item → open
    const item = target.closest('.file-item');
    if (item) {
      const id = (item as HTMLElement).dataset.id;
      if (id) handlers.onOpen(id);
    }
  },

  setFilter(query: string): void {
    _filter = query.toLowerCase().trim();
    _renderAll();
  },

  updateNoteCount(total: number, _shown: number): void {
    const el = $maybe(DOM.NOTE_COUNT);
    if (el) el.textContent = `${total} note${total !== 1 ? 's' : ''}`;
  },

  destroy(): void {
    getFileList().innerHTML = '';
    _groups = [];
    _untagged = [];
    _filter = '';
    _expanded.clear();
    _currentId = null;
  },
};
