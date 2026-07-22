/**
 * NoteTree.tsx — Tree view for notes in the sidebar.
 *
 * Uses @headless-tree for headless tree state management with keyboard
 * navigation (arrows, Home/End).  Radix ContextMenu and DropdownMenu
 * provide right-click and "⋯" per-note actions.  Search is handled
 * manually by rendering a flat filtered list.
 *
 * Also renders system notes (below user notes) when in notes mode.
 */

import { useEffect, useRef, useMemo, useState } from 'react';
import { syncDataLoaderFeature, hotkeysCoreFeature } from '@headless-tree/core';
import { useTree } from '@headless-tree/react';
import type { ItemInstance, TreeInstance } from '@headless-tree/core';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { listSystemNotes } from '../system-notes/registry.js';
import { naturalCompare } from '../utils.js';
import { useAppState } from '../state/AppContext.js';
import { useIsMobile } from '../hooks/useIsMobile.js';

// ── Touch detection ───────────────────────────────────────────────────────
// ContextMenu.Trigger intercepts the first tap on mobile for long-press
// detection, causing a double-tap requirement.  Right-click context menus
// don't apply on touch devices anyway, so skip the wrapper entirely.
const _isTouchDevice =
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0);

// ── Sorting ───────────────────────────────────────────────────────────────

/** naturalCompare but @-prefixed items sort after everything else. */
export function treeCompare(a: string, b: string): number {
  const aSys = a.startsWith('@');
  const bSys = b.startsWith('@');
  if (aSys !== bSys) return aSys ? 1 : -1;
  return naturalCompare(a, b);
}

// ── Tree types ──────────────────────────────────────────────────────────

interface TreeItem {
  id: string;
  kind?: 'system';
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  note: TreeItem | null;
}

/** Per-item data stored in headless-tree. */
interface NoteTreeData {
  name: string;
  path: string;
  isBranchOnly: boolean;
  kind?: 'system';
}

/** Synthetic root — headless-tree requires a single root. */
const ROOT_ID = '__root__';

// ── Tree builder (ported from tree-view.ts) ─────────────────────────────
// Exported for unit tests — also used internally by the NoteTree component.

export function buildTree(items: TreeItem[]): TreeNode[] {
  const sorted = [...items].sort((a, b) => treeCompare(a.id, b.id));
  const roots: TreeNode[] = [];
  const nodeMap = new Map<string, TreeNode>();

  for (const note of sorted) {
    const segments = note.id.split(':');
    let currentPath = '';
    let parentChildren = roots;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      currentPath = currentPath ? `${currentPath}:${seg}` : seg;

      if (i === segments.length - 1) {
        // Leaf (or branch with a note)
        const existing = nodeMap.get(currentPath);
        if (existing) {
          existing.note = note;
        } else {
          const node: TreeNode = {
            name: seg,
            path: currentPath,
            children: [],
            note,
          };
          nodeMap.set(currentPath, node);
          parentChildren.push(node);
        }
      } else {
        // Intermediate segment
        let node = nodeMap.get(currentPath);
        if (!node) {
          node = {
            name: seg,
            path: currentPath,
            children: [],
            note: null,
          };
          nodeMap.set(currentPath, node);
          parentChildren.push(node);
        }
        parentChildren = node.children;
      }
    }
  }

  // Sort children at each level
  function sortChildren(nodes: TreeNode[]): TreeNode[] {
    nodes.sort((a, b) => treeCompare(a.name, b.name));
    for (const n of nodes) sortChildren(n.children);
    return nodes;
  }
  return sortChildren(roots);
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Flatten tree into a Map<path, TreeNode> for O(1) lookups. */
function buildNodeMap(nodes: TreeNode[]): Map<string, TreeNode> {
  const map = new Map<string, TreeNode>();
  function walk(n: TreeNode) {
    map.set(n.path, n);
    for (const child of n.children) walk(child);
  }
  for (const root of nodes) walk(root);
  return map;
}

/** Expand all ancestors of itemId so it becomes visible. */
function openAncestors(tree: TreeInstance<NoteTreeData>, itemId: string): void {
  try {
    const item = tree.getItemInstance(itemId);
    let parent = item.getParent();
    let didExpand = false;
    while (parent) {
      if (!parent.isExpanded()) {
        parent.expand();
        didExpand = true;
      }
      parent = parent.getParent();
    }
    if (didExpand) tree.rebuildTree();
  } catch {
    // ItemId not found in tree — ignore.
  }
}

/** Flatten rawTree into {node, indent} for manual search rendering. */
function flattenTree(nodes: TreeNode[], depth: number): { node: TreeNode; indent: number }[] {
  const out: { node: TreeNode; indent: number }[] = [];
  for (const n of nodes) {
    out.push({ node: n, indent: depth });
    if (n.children.length > 0) out.push(...flattenTree(n.children, depth + 1));
  }
  return out;
}

// ── Props ───────────────────────────────────────────────────────────────

export interface NoteTreeProps {
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string) => void;
  searchQuery: string;
}

// ── Row renderer (shared between tree and search views) ─────────────────

interface RowData {
  id: string;
  name: string;
  kind?: 'system';
  isActive: boolean;
  isFolder: boolean;
  isExpanded: boolean;
  isBranchOnly: boolean;
  indent: number;
  onToggle?: () => void;
  ariaProps?: Record<string, unknown>;
}

/** Context-menu row height (used to detect "last 2 visible items"). */
const ROW_HEIGHT_ESTIMATE = 35;
const NEAR_BOTTOM_THRESHOLD = ROW_HEIGHT_ESTIMATE * 8; // ~70px

function NoteRow({
  data, onOpen, onDelete, onRename, isMobile,
}: {
  data: RowData;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string) => void;
  isMobile: boolean;
}) {
  const { id, name, kind, isActive, isFolder, isExpanded, isBranchOnly, indent, onToggle, ariaProps } = data;
  const isSys = kind === 'system';
  const canAct = !isSys && !isBranchOnly;

  // Pull ARIA-only props from headless-tree's getProps() (role, aria-level,
  // aria-expanded, aria-selected, aria-posinset, aria-setsize, tabindex,
  // onKeyDown for keyboard nav).  We handle onClick ourselves to match the
  // original Arborist behaviour: click body → open note if present, arrow →
  // toggle expand/collapse.
  const {
    onClick: _htOnClick,
    onDoubleClick: _htOnDblClick,
    ...htAria
  } = (ariaProps ?? {}) as Record<string, unknown>;

  const handleRowClick = () => {
    if (!isBranchOnly) {
      onOpen(id);
    } else if (isFolder) {
      // Branch-only folder: toggle expand on row click (keyboard-only in
      // the original Arborist, but more intuitive to also support click).
      onToggle?.();
    }
  };

  const rowDiv = (
    <div
      className={`tree-bar file-item${isActive ? ' active' : ''}`}
      data-id={id}
      data-kind={isSys ? 'system' : undefined}
      style={{ paddingLeft: `${12 + indent * 16}px` }}
      {...htAria}
      onClick={handleRowClick}
    >
      {/* Fold arrow — always reserve the 22px slot so names align */}
      <span
        className="tree-toggle"
        aria-label={isExpanded ? 'Collapse' : 'Expand'}
        onClick={e => {
          e.stopPropagation();
          onToggle?.();
        }}
        style={{ visibility: isFolder ? 'visible' : 'hidden' }}
      >
        {isFolder ? (isExpanded ? '▼' : '▶') : ''}
      </span>

      {/* Icon — closed/open folder for branches, document for leaves */}
      <svg
        className="file-item-icon"
        width="12" height="12" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {!isFolder
          // Leaf — always a document icon
          ? <path d="M9 12h6m-6 4h6m2 4H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l5 5v11a2 2 0 0 1-2 2z"/>
          : isExpanded
            // Branch, open — folder with front flap angled down
            ? (isBranchOnly
                ? <path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v5l-3 4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/>
                : <>
                    <path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v5l-3 4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/>
                    <path d="M8 10h4"/>
                  </>
              )
            // Branch, closed — folder; with-note adds a document peeking out
            : (isBranchOnly
                ? <path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/>
                : <>
                    <path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/>
                    <path d="M12 11h4l2 2v4h-6z"/>
                  </>
              )
        }
      </svg>

      {/* Name */}
      <span className="file-item-name" title={id}>{name}</span>

      {/* "⋯" dropdown — only for non-system notes that actually exist */}
      {canAct && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="file-item-more btn-icon"
              title="More actions"
              aria-label={`More actions for ${id}`}
              onClick={e => e.stopPropagation()}
            >
              ⋯
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="item-context-menu"
              side="bottom"
              align={isMobile ? 'end' : 'start'}
              sideOffset={2}
              collisionPadding={{ bottom: NEAR_BOTTOM_THRESHOLD }}
              onClick={e => e.stopPropagation()}
            >
              <DropdownMenu.Item
                className="context-menu-item"
                onSelect={() => onRename(id)}
              >
                Rename
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="dropdown-divider" />
              <DropdownMenu.Item
                className="context-menu-item danger"
                onSelect={() => onDelete(id)}
              >
                Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  );

  // On touch devices, skip the ContextMenu wrapper — its long-press
  // detection consumes the first tap, forcing a double-tap to open a note.
  if (_isTouchDevice) {
    return rowDiv;
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        {rowDiv}
      </ContextMenu.Trigger>

      {/* Right-click context menu */}
      {canAct && (
        <ContextMenu.Portal>
          <ContextMenu.Content
            className="item-context-menu"
          >
            <ContextMenu.Item
              className="context-menu-item"
              onSelect={() => onRename(id)}
            >
              Rename
            </ContextMenu.Item>
            <ContextMenu.Separator className="dropdown-divider" />
            <ContextMenu.Item
              className="context-menu-item danger"
              onSelect={() => onDelete(id)}
            >
              Delete
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      )}
    </ContextMenu.Root>
  );
}

// ── Component ───────────────────────────────────────────────────────────

export default function NoteTree({ onOpen, onDelete, onRename, searchQuery }: NoteTreeProps) {
  const { notes, activeNoteId, sidebarMode } = useAppState();
  const isMobile = useIsMobile();

  // ── Stable callback refs ────────────────────────────────────────────
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  // ── Build data ─────────────────────────────────────────────────────
  const items: TreeItem[] = useMemo(() => {
    const userItems: TreeItem[] = notes.map(n => ({ id: n.id }));
    if (sidebarMode !== 'notes') return userItems;
    const sysItems: TreeItem[] = listSystemNotes().map(d => ({
      id: d.id,
      kind: 'system' as const,
    }));
    return [...userItems, ...sysItems];
  }, [notes, sidebarMode]);
  const rawTree = useMemo(() => buildTree(items), [items]);
  const nodeMap = useMemo(() => buildNodeMap(rawTree), [rawTree]);

  // ── Tree config (recreated when data changes) ───────────────────────
  // ── Version counter forces re-render after tree.rebuildTree() since
  //     headless-tree state may not change (same expandedItems) and React
  //     would skip the re-render even though itemInstances was mutated.
  const [treeVersion, setTreeVersion] = useState(0);

  const tree = useTree<NoteTreeData>(useMemo(() => ({
    rootItemId: ROOT_ID,
    dataLoader: {
      getItem: (itemId: string): NoteTreeData => {
        if (itemId === ROOT_ID) return { name: '', path: ROOT_ID, isBranchOnly: true };
        const node = nodeMap.get(itemId);
        return {
          name: node?.name ?? itemId,
          path: node?.path ?? itemId,
          isBranchOnly: node ? node.note === null : true,
          kind: node?.note?.kind as 'system' | undefined,
        };
      },
      getChildren: (itemId: string): string[] => {
        if (itemId === ROOT_ID) return rawTree.map(n => n.path);
        const node = nodeMap.get(itemId);
        return node ? node.children.map(c => c.path) : [];
      },
    } as const,
    getItemName: (item: ItemInstance<NoteTreeData>) => item.getItemData().name,
    isItemFolder: (item: ItemInstance<NoteTreeData>) => {
      const id = item.getId();
      if (id === ROOT_ID) return true;
      const node = nodeMap.get(id);
      return node ? node.children.length > 0 : false;
    },
    onPrimaryAction: (item: ItemInstance<NoteTreeData>) => {
      if (!item.getItemData().isBranchOnly) {
        onOpenRef.current(item.getId());
      }
    },
    initialState: { expandedItems: [ROOT_ID] },
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
  }), [nodeMap, rawTree]));

  // ── Rebuild tree when data changes ──────────────────────────────────
  useEffect(() => {
    tree.rebuildTree();
    setTreeVersion(v => v + 1);
  }, [rawTree, tree]);

  // ── Auto-expand ancestors of the active note ────────────────────────
  useEffect(() => {
    if (activeNoteId) {
      openAncestors(tree, activeNoteId);
      setTreeVersion(v => v + 1);
    }
  }, [activeNoteId, tree]);

  // ── Search ──────────────────────────────────────────────────────────
  const q = searchQuery.trim().toLowerCase();
  const hasSearch = q.length > 0;

  const flatMatches = useMemo(() => {
    if (!hasSearch) return null;
    const all = flattenTree(rawTree, 0);
    return all.filter(({ node }) =>
      node.name.toLowerCase().includes(q) ||
      node.path.toLowerCase().includes(q)
    );
  }, [hasSearch, q, rawTree]);

  // ── Visible tree items (skip synthetic root) ────────────────────────
  // NOT memoized — must react to headless-tree internal state changes
  // (expand/collapse) which trigger re-renders via setState but don't
  // change any of our own dep values.
  const visibleItems = hasSearch
    ? null
    : tree.getItems().filter(i => i.getId() !== ROOT_ID);

  // ── Empty state ─────────────────────────────────────────────────────
  if (rawTree.length === 0) {
    return (
      <div id="file-list" aria-label="Notes">
        <div style={{
          padding: '20px 12px', textAlign: 'center', fontSize: '11px',
          color: 'var(--text-3)', fontFamily: 'var(--font-mono)',
        }}>
          No notes found
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div id="file-list" aria-label="Notes">
      {/* Tree view (no search active) */}
      {!hasSearch && visibleItems && visibleItems.map(item => {
        const d = item.getItemData();
        return (
          <NoteRow
            key={item.getId()}
            data={{
              id: item.getId(),
              name: d.name,
              kind: d.kind,
              isActive: d.path === activeNoteId,
              isFolder: item.isFolder(),
              isExpanded: item.isExpanded(),
              isBranchOnly: d.isBranchOnly,
              indent: item.getItemMeta().level - 1, // root is level 0, hidden
              onToggle: () => {
                if (item.isExpanded()) item.collapse();
                else item.expand();
              },
              ariaProps: item.getProps() as Record<string, unknown>,
            }}
            onOpen={onOpen}
            onDelete={onDelete}
            onRename={onRename}
            isMobile={isMobile}
          />
        );
      })}

      {/* Search results (flat list) */}
      {hasSearch && flatMatches && flatMatches.length > 0 && flatMatches.map(({ node, indent }) => (
        <NoteRow
          key={node.path}
          data={{
            id: node.path,
            name: node.name,
            kind: node.note?.kind as 'system' | undefined,
            isActive: node.path === activeNoteId,
            isFolder: node.children.length > 0,
            isExpanded: false,
            isBranchOnly: node.note === null,
            indent,
          }}
          onOpen={onOpen}
          onDelete={onDelete}
          onRename={onRename}
          isMobile={isMobile}
        />
      ))}

      {/* No search matches */}
      {hasSearch && flatMatches && flatMatches.length === 0 && (
        <div style={{
          padding: '20px 12px', textAlign: 'center', fontSize: '11px',
          color: 'var(--text-3)', fontFamily: 'var(--font-mono)',
        }}>
          No notes match
        </div>
      )}
    </div>
  );
}
