/**
 * TrashView.tsx — Trash list for the sidebar.
 *
 * Replaces the TrashPlaceholder with a full interactive trash list:
 *   - Renders each TrashEntry row with icon, name, metadata, source badge.
 *   - "⋯" DropdownMenu for Restore / Delete forever.
 *   - Client-side search/filter.
 *   - Emits callbacks for restore/purge/empty (handled by parent Sidebar).
 */

import { useMemo } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { TrashEntry } from '../trash.js';
import { relativeTime } from '../utils.js';
import { useIsMobile } from '../hooks/useIsMobile.js';

/** Context-menu row height (used to detect "last 2 visible items"). */
const ROW_HEIGHT_ESTIMATE = 35;
const NEAR_BOTTOM_THRESHOLD = ROW_HEIGHT_ESTIMATE * 8; // ~280px

/* ── Props ─────────────────────────────────────────────────────────────── */

export interface TrashViewProps {
  entries: TrashEntry[];
  searchQuery: string;
  onRestore: (id: string, source: 'local' | 'server') => void;
  onPurge: (id: string, source: 'local' | 'server' | 'both') => void;
  onPreview: (id: string, source: 'local' | 'server') => void;
}

/* ── Component ──────────────────────────────────────────────────────────── */

export default function TrashView({ entries, searchQuery, onRestore, onPurge, onPreview }: TrashViewProps) {
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e => e.id.toLowerCase().includes(q));
  }, [entries, searchQuery]);

  const isEmpty = entries.length === 0;
  const noResults = entries.length > 0 && filtered.length === 0;

  return (
    <div id="file-list" role="list" aria-label="Trash">
      {/* ── Empty ── */}
      {isEmpty && (
        <div style={{
          padding: '20px 12px',
          textAlign: 'center',
          fontSize: '11px',
          color: 'var(--text-3)',
          fontFamily: 'var(--font-mono)',
        }}>
          Trash is empty
        </div>
      )}

      {/* ── No results ── */}
      {noResults && (
        <div style={{
          padding: '20px 12px',
          textAlign: 'center',
          fontSize: '11px',
          color: 'var(--text-3)',
          fontFamily: 'var(--font-mono)',
        }}>
          No matching items
        </div>
      )}

      {/* ── Rows ── */}
      {filtered.map(entry => (
        <TrashRow
          key={entry.id}
          entry={entry}
          onRestore={onRestore}
          onPurge={onPurge}
          onPreview={onPreview}
        />
      ))}
    </div>
  );
}

/* ── Single trash row ──────────────────────────────────────────────────── */

function normSource(src: 'local' | 'server' | 'both'): 'local' | 'server' {
  return src === 'local' ? 'local' : 'server';
}

function TrashRow({
  entry,
  onRestore,
  onPurge,
  onPreview,
}: {
  entry: TrashEntry;
  onRestore: (id: string, source: 'local' | 'server') => void;
  onPurge: (id: string, source: 'local' | 'server' | 'both') => void;
  onPreview: (id: string, source: 'local' | 'server') => void;
}) {
  const isMobile = useIsMobile();

  const rel = relativeTime(entry.deleted_at);
  let metaText = `deleted ${rel}`;
  if (entry.updated_by) metaText += ` — ${entry.updated_by}`;
  if (entry.source === 'server') metaText += ' (↑)';

  return (
    <div
      className="trash-row"
      data-id={entry.id}
      data-source={entry.source}
      role="listitem"
      onClick={(e) => {
        // Don't trigger preview when clicking the "⋯" menu button
        const target = e.target as HTMLElement;
        if (target.closest('.file-item-more')) return;
        onPreview(entry.id, normSource(entry.source));
      }}
    >
      {/* Trash icon */}
      <svg className="trash-row-icon" width="12" height="12" fill="none"
           stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
           aria-hidden="true">
        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14"/>
        <path d="M10 11v6M14 11v6"/>
      </svg>

      {/* Info */}
      <div className="trash-row-info">
        <span className="trash-row-name" title={entry.id}>
          {entry.id}
        </span>
        <span className="trash-row-meta">{metaText}</span>
      </div>

      {/* "⋯" menu */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className="file-item-more btn-icon"
            title="More actions"
            aria-label={`More actions for ${entry.id}`}
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
              onSelect={() => onRestore(entry.id, normSource(entry.source))}
            >
              Restore
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="dropdown-divider" />
            <DropdownMenu.Item
              className="context-menu-item danger"
              onSelect={() => onPurge(entry.id, entry.source)}
            >
              Delete forever
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
