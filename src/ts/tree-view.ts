/**
 * tree-view.ts — Collapsible tree view sidebar
 *
 * Builds a tree from flat NoteMeta[] using colon (:) as the path separator.
 * Implements the SidebarView interface so it can be swapped out for
 * other sidebar views (tag mode, etc.) in the future.
 *
 * Module-level state:
 *   expandedPaths   — which branch paths are currently expanded
 *   savedExpanded   — snapshot taken while a search is active
 */

import type { SidebarView, UIEventHandlers } from './sidebar.js';
import type { NoteMeta } from './notes.js';
import * as contextMenu from './context-menu.js';
import { naturalCompare } from './utils.js';
import { DOM, $, $maybe } from './dom-ids.js';
import { ICONS, createIcon } from './icons.js';

// ── Tree data type ──────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  note: NoteMeta | null;
}

// ── Module-level state ──────────────────────────────────────────────────

const expandedPaths = new Set<string>();
let savedExpanded: Set<string> | null = null;

// ── DOM refs (queried on each render) ────────────────────────────────────

function getFileList(): HTMLElement {
  return $(DOM.FILE_LIST);
}

function getNoteCount(): HTMLElement {
  return $(DOM.NOTE_COUNT);
}

function getSearchInput(): HTMLInputElement | null {
  return $maybe(DOM.SEARCH) as HTMLInputElement | null;
}

// ── Tree builder ────────────────────────────────────────────────────────

function buildTree(notes: NoteMeta[]): TreeNode[] {
  // Sort notes by full ID using natural sort
  const sorted = [...notes].sort((a, b) => naturalCompare(a.id, b.id));

  const roots: TreeNode[] = [];
  const nodeMap = new Map<string, TreeNode>();

  for (const note of sorted) {
    const segments = note.id.split(':');
    let currentPath = '';
    let parentChildren = roots;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      currentPath = currentPath ? `${currentPath}:${seg}` : seg;

      let node = nodeMap.get(currentPath);
      if (!node) {
        node = {
          name: seg,
          path: currentPath,
          children: [],
          note: i === segments.length - 1 ? note : null,
        };
        nodeMap.set(currentPath, node);
        parentChildren.push(node);
      } else if (i === segments.length - 1) {
        // The note's ID exactly matches an existing branch node
        node.note = note;
      }
      parentChildren = node.children;
    }
  }

  // Sort each level: branches first, then leaves, natural sort within groups
  function sortNodes(nodes: TreeNode[]): void {
    nodes.sort((a, b) => {
      const aIsBranch = a.children.length > 0;
      const bIsBranch = b.children.length > 0;
      if (aIsBranch && !bIsBranch) return -1;
      if (!aIsBranch && bIsBranch) return 1;
      return naturalCompare(a.name, b.name);
    });
    nodes.forEach(n => sortNodes(n.children));
  }

  sortNodes(roots);
  return roots;
}

// ── Expand / collapse helpers ───────────────────────────────────────────

function expandToPath(path: string): void {
  const segments = path.split(':');
  let current = '';
  for (const seg of segments) {
    current = current ? `${current}:${seg}` : seg;
    expandedPaths.add(current);
  }
}

function toggleBranch(path: string): void {
  const container = document.querySelector(
    `.tree-children[data-parent="${CSS.escape(path)}"]`
  ) as HTMLElement | null;
  if (!container) return;

  const isExpanded = container.style.display !== 'none';
  container.style.display = isExpanded ? 'none' : 'block';

  // Update toggle arrow
  const toggle = document.querySelector(
    `.tree-bar[data-path="${CSS.escape(path)}"] .tree-toggle`
  );
  if (toggle) {
    toggle.textContent = isExpanded ? '▶' : '▼';
    toggle.setAttribute('aria-label', isExpanded ? 'Expand' : 'Collapse');
  }

  if (isExpanded) {
    expandedPaths.delete(path);
  } else {
    expandedPaths.add(path);
  }
}

// ── Tree renderer ───────────────────────────────────────────────────────

function renderTreeNodes(
  nodes: TreeNode[],
  depth: number,
  currentId: string | null
): DocumentFragment {
  const frag = document.createDocumentFragment();
  const indent = 12 + depth * 16; // base padding + 16px per level

  for (const node of nodes) {
    const hasNote = node.note !== null;
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedPaths.has(node.path);

    // ── Tree bar ──────────────────────────────────────────────────────
    const bar = document.createElement('div');
    bar.className = 'tree-bar';
    bar.dataset.path = node.path;
    bar.style.paddingLeft = `${indent}px`;

    if (hasNote) {
      bar.classList.add('file-item');
      bar.dataset.id = node.note!.id;
      if (node.note!.id === currentId) {
        bar.classList.add('active');
      }
    } else {
      bar.classList.add('tree-branch-only');
    }

    // Toggle arrow (branches only)
    if (hasChildren) {
      const toggle = document.createElement('span');
      toggle.className = 'tree-toggle';
      toggle.textContent = isExpanded ? '▼' : '▶';
      toggle.setAttribute('aria-label', isExpanded ? 'Collapse' : 'Expand');
      bar.appendChild(toggle);
    }

    // Document icon (note nodes only)
    if (hasNote) {
      const icon = createIcon(ICONS.DOCUMENT);
      icon.classList.add('file-item-icon');
      bar.appendChild(icon);
    }

    // Label
    const label = document.createElement('span');
    label.className = 'file-item-name';
    label.textContent = node.name;
    label.title = hasNote ? node.note!.id : node.path;
    bar.appendChild(label);

    // More-actions button (note nodes only)
    if (hasNote) {
      const more = document.createElement('button');
      more.className = 'file-item-more btn-icon';
      more.textContent = '⋯';
      more.title = 'More actions';
      more.setAttribute('aria-label', `More actions for ${node.note!.id}`);
      bar.appendChild(more);
    }

    frag.appendChild(bar);

    // ── Children container (branches only) ────────────────────────────
    if (hasChildren) {
      const container = document.createElement('div');
      container.className = 'tree-children';
      container.dataset.parent = node.path;
      container.style.display = isExpanded ? 'block' : 'none';
      container.appendChild(renderTreeNodes(node.children, depth + 1, currentId));
      frag.appendChild(container);
    }
  }

  return frag;
}

// ── Exported: TreeView object ───────────────────────────────────────────

export const TreeView: SidebarView = {
  render(notes: NoteMeta[], currentId: string | null): void {
    const fileList = getFileList();
    fileList.innerHTML = '';

    // Empty state
    if (notes.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText =
        'padding:20px 12px;text-align:center;font-size:11px;' +
        'color:var(--text-3);font-family:var(--font-mono)';
      empty.textContent = 'No notes found';
      fileList.appendChild(empty);
      return;
    }

    // Check whether a search is active
    const searchInput = getSearchInput();
    const isSearching = searchInput ? searchInput.value.trim().length > 0 : false;

    if (isSearching) {
      // Search active → save expanded state snapshot (once) and render flat list
      if (savedExpanded === null) {
        savedExpanded = new Set(expandedPaths);
      }

      const frag = document.createDocumentFragment();
      for (const note of notes) {
        const item = document.createElement('div');
        item.className = 'file-item' + (note.id === currentId ? ' active' : '');
        item.dataset.id = note.id;
        item.setAttribute('role', 'listitem');

        const icon = createIcon(ICONS.DOCUMENT);
        icon.classList.add('file-item-icon');
        item.appendChild(icon);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-item-name';
        nameSpan.title = note.id;
        nameSpan.textContent = note.id;
        item.appendChild(nameSpan);

        frag.appendChild(item);
      }
      fileList.appendChild(frag);
    } else {
      // Normal (non-search) mode
      if (savedExpanded !== null) {
        // Search was just cleared — restore previous expanded state
        expandedPaths.clear();
        for (const p of savedExpanded) expandedPaths.add(p);
        savedExpanded = null;
      }

      // Auto-expand to the currently open note
      if (currentId) {
        expandToPath(currentId);
      }

      const tree = buildTree(notes);
      const frag = renderTreeNodes(tree, 0, currentId);
      fileList.appendChild(frag);
    }
  },

  handleClick(e: MouseEvent, handlers: UIEventHandlers): void {
    const target = e.target as HTMLElement;

    // Toggle arrow
    const toggle = target.closest('.tree-toggle');
    if (toggle) {
      const bar = (toggle as HTMLElement).closest('[data-path]') as HTMLElement | null;
      if (bar?.dataset.path) {
        toggleBranch(bar.dataset.path);
      }
      return;
    }

    // "More" button (⋯)
    const moreBtn = target.closest('.file-item-more');
    if (moreBtn) {
      const bar = (moreBtn as HTMLElement).closest('[data-path]') as HTMLElement | null;
      const path = bar?.dataset.path;
      if (path) {
        contextMenu.show(moreBtn as HTMLElement, [
          { label: 'Rename', action: () => handlers.onRename(path) },
          { label: 'Delete', action: () => handlers.onDelete(path), danger: true },
        ]);
      }
      return;
    }

    // Note item → open
    const item = target.closest('.file-item');
    if (item) {
      const id = (item as HTMLElement).dataset.id;
      if (id) handlers.onOpen(id);
    }
  },

  updateNoteCount(total: number, shown: number): void {
    const el = getNoteCount();
    if (shown === total) {
      el.textContent = `${total} note${total !== 1 ? 's' : ''}`;
    } else {
      el.textContent = `${shown} / ${total}`;
    }
  },

  destroy(): void {
    contextMenu.close();
    expandedPaths.clear();
    savedExpanded = null;
    getFileList().innerHTML = '';
  },
};
