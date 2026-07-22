/**
 * C4b — TrashView component tests
 *
 * Pure prop-driven component.  No hooks, no context, no data layer.
 * Tests row rendering, search filtering, dropdown actions, and empty states.
 *
 * See docs/plans/c4-sidebar-plan.md for the full test table.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TrashView from '../../src/ts/components/TrashView.js';
import type { TrashEntry } from '../../src/ts/trash.js';

/* ── Helpers ──────────────────────────────────────────────────────────── */

const entry = (overrides?: Partial<TrashEntry>): TrashEntry => ({
  id: 'note.md',
  deleted_at: 1700000000,
  source: 'local',
  ...overrides,
});

function renderTrash(props?: {
  entries?: TrashEntry[];
  searchQuery?: string;
  onRestore?: ReturnType<typeof vi.fn>;
  onPurge?: ReturnType<typeof vi.fn>;
  onPreview?: ReturnType<typeof vi.fn>;
}) {
  const defaults = {
    entries: [] as TrashEntry[],
    searchQuery: '',
    onRestore: vi.fn(),
    onPurge: vi.fn(),
    onPreview: vi.fn(),
  };
  const p = { ...defaults, ...props };
  return {
    ...render(<TrashView {...p} />),
    props: p,
  };
}

/* ========================================================================
   1. Empty state
   ======================================================================== */

describe('Empty state', () => {
  it('shows "Trash is empty" when no entries', () => {
    renderTrash({ entries: [] });
    expect(screen.getByText('Trash is empty')).toBeInTheDocument();
  });
});

/* ========================================================================
   2. Rows — rendering
   ======================================================================== */

describe('Rows — rendering', () => {
  it('renders a row for each entry', () => {
    renderTrash({
      entries: [entry({ id: 'a.md' }), entry({ id: 'b.md' })],
    });
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
  });

  it('shows entry id in the row', () => {
    renderTrash({ entries: [entry({ id: 'deleted-note.md' })] });
    expect(screen.getByText('deleted-note.md')).toBeInTheDocument();
  });

  it('shows source badge for server entries', () => {
    renderTrash({ entries: [entry({ id: 'server.md', source: 'server' })] });
    // Server entries show "(↑)" in metadata
    expect(screen.getByText(/↑/)).toBeInTheDocument();
  });

  it('does NOT show source badge for "both" entries (badge only for pure server)', () => {
    // normSource('both') → 'server' for callbacks, but display badge checks
    // entry.source === 'server' strictly — "both" doesn't get the "(↑)" badge.
    renderTrash({ entries: [entry({ id: 'both.md', source: 'both' })] });
    const rows = screen.getAllByRole('listitem');
    const text = rows[0].textContent || '';
    expect(text).not.toContain('↑');
  });

  it('does NOT show source badge for local entries', () => {
    renderTrash({ entries: [entry({ id: 'local.md', source: 'local' })] });
    const rows = screen.getAllByRole('listitem');
    const text = rows[0].textContent || '';
    expect(text).not.toContain('↑');
  });
});

/* ========================================================================
   3. Row click — preview
   ======================================================================== */

describe('Row click — preview', () => {
  it('calls onPreview with id and source when row is clicked', async () => {
    const { props } = renderTrash({ entries: [entry({ id: 'preview.md', source: 'local' })] });
    const u = userEvent.setup();

    // Click the row (not the ⋯ button)
    const row = screen.getByText('preview.md').closest('[role="listitem"]')!;
    await u.click(row);

    expect(props.onPreview).toHaveBeenCalledWith('preview.md', 'local');
  });

  it('calls onPreview with "server" for server-source entries', async () => {
    const { props } = renderTrash({ entries: [entry({ id: 'srv.md', source: 'server' })] });
    const u = userEvent.setup();

    const row = screen.getByText('srv.md').closest('[role="listitem"]')!;
    await u.click(row);

    expect(props.onPreview).toHaveBeenCalledWith('srv.md', 'server');
  });

  it('calls onPreview with "server" for both-source entries', async () => {
    const { props } = renderTrash({ entries: [entry({ id: 'b.md', source: 'both' })] });
    const u = userEvent.setup();

    const row = screen.getByText('b.md').closest('[role="listitem"]')!;
    await u.click(row);

    // normSource('both') → 'server'
    expect(props.onPreview).toHaveBeenCalledWith('b.md', 'server');
  });
});

/* ========================================================================
   4. Dropdown menu — Restore
   ======================================================================== */

describe('Dropdown menu — Restore', () => {
  it('calls onRestore when "Restore" is selected', async () => {
    const { props } = renderTrash({ entries: [entry({ id: 'restore.md', source: 'local' })] });
    const u = userEvent.setup();

    // Click "⋯" button to open dropdown
    const moreBtn = screen.getByRole('button', { name: 'More actions for restore.md' });
    await u.click(moreBtn);

    // Click "Restore" in the dropdown
    // Radix DropdownMenu.Item renders menuitem role
    const restoreItem = screen.getByRole('menuitem', { name: 'Restore' });
    await u.click(restoreItem);

    expect(props.onRestore).toHaveBeenCalledWith('restore.md', 'local');
  });

  it('calls onRestore with "server" for server-source entries', async () => {
    const { props } = renderTrash({ entries: [entry({ id: 'srv.md', source: 'server' })] });
    const u = userEvent.setup();

    const moreBtn = screen.getByRole('button', { name: 'More actions for srv.md' });
    await u.click(moreBtn);

    const restoreItem = screen.getByRole('menuitem', { name: 'Restore' });
    await u.click(restoreItem);

    expect(props.onRestore).toHaveBeenCalledWith('srv.md', 'server');
  });
});

/* ========================================================================
   5. Dropdown menu — Delete forever
   ======================================================================== */

describe('Dropdown menu — Delete forever', () => {
  it('calls onPurge with id and original source', async () => {
    const { props } = renderTrash({ entries: [entry({ id: 'purge.md', source: 'both' })] });
    const u = userEvent.setup();

    const moreBtn = screen.getByRole('button', { name: 'More actions for purge.md' });
    await u.click(moreBtn);

    const purgeItem = screen.getByRole('menuitem', { name: 'Delete forever' });
    await u.click(purgeItem);

    // onPurge gets the original source, not normSource'd
    expect(props.onPurge).toHaveBeenCalledWith('purge.md', 'both');
  });
});

/* ========================================================================
   6. Search / filter
   ======================================================================== */

describe('Search / filter', () => {
  it('filters entries by searchQuery', () => {
    renderTrash({
      entries: [entry({ id: 'alpha.md' }), entry({ id: 'beta.md' })],
      searchQuery: 'alpha',
    });

    expect(screen.getByText('alpha.md')).toBeInTheDocument();
    expect(screen.queryByText('beta.md')).toBeNull();
  });

  it('is case-insensitive', () => {
    renderTrash({
      entries: [entry({ id: 'Note.md' })],
      searchQuery: 'NOTE',
    });

    expect(screen.getByText('Note.md')).toBeInTheDocument();
  });

  it('shows "No matching items" when filter matches nothing', () => {
    renderTrash({
      entries: [entry({ id: 'a.md' })],
      searchQuery: 'zzz',
    });

    expect(screen.getByText('No matching items')).toBeInTheDocument();
    expect(screen.queryByText('a.md')).toBeNull();
  });

  it('shows all entries when searchQuery is empty', () => {
    renderTrash({
      entries: [entry({ id: 'a.md' }), entry({ id: 'b.md' })],
      searchQuery: '',
    });

    expect(screen.getByText('a.md')).toBeInTheDocument();
    expect(screen.getByText('b.md')).toBeInTheDocument();
  });
});
