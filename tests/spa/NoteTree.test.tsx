/**
 * C4a — NoteTree pure logic + component tests
 *
 * Tests buildTree/treeCompare as pure functions (fast, reliable).
 * Component rendering tests verify the tree renders items from state.
 *
 * See docs/plans/c4-sidebar-plan.md for the full test table.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor } from './test-utils.js';
import { useAppDispatch } from '../../src/ts/state/AppContext.js';
import type { NoteMeta } from '../../src/ts/notes.js';

/* ── Mocks ────────────────────────────────────────────────────────────── */

vi.mock('../../src/ts/system-notes/registry.js', () => ({
  listSystemNotes: vi.fn(() => []),
  isSystemNote: vi.fn((id: string) => id.startsWith('@')),
  getSystemNote: vi.fn(),
}));

vi.mock('../../src/ts/config.js', () => ({
  getSpaConfig: vi.fn(() => ({})),
  fetchSpaConfig: vi.fn(() => Promise.resolve()),
}));

/* ── Pure function tests ───────────────────────────────────────────────── */

import { buildTree, treeCompare } from '../../src/ts/components/NoteTree.js';

interface TreeItem { id: string; kind?: 'system' }

describe('treeCompare()', () => {
  it('sorts alphabetically with naturalCompare', () => {
    expect(treeCompare('a', 'b')).toBeLessThan(0);
    expect(treeCompare('b', 'a')).toBeGreaterThan(0);
    expect(treeCompare('a', 'a')).toBe(0);
  });

  it('sorts @-prefixed items after everything else', () => {
    // @-prefixed items sort last
    expect(treeCompare('z', '@a')).toBeLessThan(0);
    expect(treeCompare('@a', 'z')).toBeGreaterThan(0);
    expect(treeCompare('@a', '@b')).toBeLessThan(0);
  });
});

describe('buildTree()', () => {
  it('returns empty array for empty input', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('creates a single root node for a flat note', () => {
    const result = buildTree([{ id: 'hello' }]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('hello');
    expect(result[0].path).toBe('hello');
    expect(result[0].note).toEqual({ id: 'hello' });
    expect(result[0].children).toEqual([]);
  });

  it('creates parent-child for nested IDs (a and a:b)', () => {
    const result = buildTree([{ id: 'a' }, { id: 'a:b' }]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('a');
    expect(result[0].path).toBe('a');
    expect(result[0].note).toEqual({ id: 'a' });
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].name).toBe('b');
    expect(result[0].children[0].path).toBe('a:b');
    expect(result[0].children[0].note).toEqual({ id: 'a:b' });
  });

  it('creates intermediate branch nodes for a:b without explicit a', () => {
    // "a:b" without an "a" note → branch node "a" with no note attached
    const result = buildTree([{ id: 'a:b' }]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('a');
    expect(result[0].note).toBeNull(); // branch only
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].name).toBe('b');
    expect(result[0].children[0].note).toEqual({ id: 'a:b' });
  });

  it('handles deep nesting (a:b:c:d)', () => {
    const result = buildTree([{ id: 'a:b:c:d' }]);
    expect(result).toHaveLength(1);        // a
    expect(result[0].children).toHaveLength(1);   // a → b
    expect(result[0].children[0].children).toHaveLength(1);  // a:b → c
    expect(result[0].children[0].children[0].name).toBe('c');
    expect(result[0].children[0].children[0].children).toHaveLength(1); // a:b:c → d
  });

  it('sorts @-prefixed items after regular items', () => {
    const result = buildTree([
      { id: 'z' },
      { id: '@sys', kind: 'system' },
      { id: 'a' },
    ]);
    expect(result.map(n => n.name)).toEqual(['a', 'z', '@sys']);
  });

  it('sorts children alphabetically at each level', () => {
    const result = buildTree([
      { id: 'x:c' },
      { id: 'x:a' },
      { id: 'x:b' },
    ]);
    expect(result).toHaveLength(1); // x
    const children = result[0].children;
    expect(children.map(c => c.name)).toEqual(['a', 'b', 'c']);
  });

  it('preserves kind field on notes', () => {
    const result = buildTree([{ id: '@log', kind: 'system' }]);
    expect(result[0].note?.kind).toBe('system');
  });

  it('attaches a note to an existing branch node', () => {
    // Create a branch via "a:b", then add note "a" — the branch becomes a leaf
    const result = buildTree([{ id: 'a:b' }, { id: 'a' }]);
    expect(result).toHaveLength(1);
    expect(result[0].note).toEqual({ id: 'a' }); // note attached
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].note).toEqual({ id: 'a:b' });
  });
});

/* ── Component tests ───────────────────────────────────────────────────── */

import NoteTree from '../../src/ts/components/NoteTree.js';

interface SeedOptions {
  notes: NoteMeta[];
  activeNoteId?: string;
}

function NoteTreeWithSeed({ notes, activeNoteId, ...props }: SeedOptions & {
  onOpen?: (id: string) => void;
  onDelete?: (id: string) => void;
  onRename?: (id: string) => void;
  searchQuery?: string;
}) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch({ type: 'NOTES_LOADED', notes });
    if (activeNoteId) {
      dispatch({
        type: 'NOTE_SELECTED',
        id: activeNoteId,
        content: '# Test',
        isSystemNote: activeNoteId.startsWith('@'),
        noteData: null,
      });
    }
  }, [notes, activeNoteId, dispatch]);

  const { onOpen = vi.fn(), onDelete = vi.fn(), onRename = vi.fn(), searchQuery = '' } = props;
  return (
    <NoteTree
      onOpen={onOpen}
      onDelete={onDelete}
      onRename={onRename}
      searchQuery={searchQuery}
    />
  );
}

function renderNoteTree(opts: SeedOptions & {
  onOpen?: ReturnType<typeof vi.fn>;
  onDelete?: ReturnType<typeof vi.fn>;
  onRename?: ReturnType<typeof vi.fn>;
  searchQuery?: string;
} = { notes: [] }) {
  return renderWithProviders(
    <NoteTreeWithSeed
      notes={opts.notes}
      activeNoteId={opts.activeNoteId}
      onOpen={opts.onOpen ?? vi.fn()}
      onDelete={opts.onDelete ?? vi.fn()}
      onRename={opts.onRename ?? vi.fn()}
      searchQuery={opts.searchQuery ?? ''}
    />,
  );
}

describe('NoteTree component', () => {
  it('shows empty state when no notes', () => {
    renderNoteTree({ notes: [] });
    expect(screen.getByText('No notes found')).toBeInTheDocument();
  });

  it('renders container div even when tree is empty of data', () => {
    renderNoteTree({ notes: [] });
    expect(document.getElementById('file-list')).toBeInTheDocument();
  });

  it('renders note items from state', async () => {
    renderNoteTree({
      notes: [
        { id: 'hello', created_at: 1, updated_at: 2, current: 'local' },
        { id: 'world', created_at: 3, updated_at: 4, current: 'local' },
      ],
    });
    await waitFor(() => {
      expect(screen.getByText('hello')).toBeInTheDocument();
    });
    expect(screen.getByText('world')).toBeInTheDocument();
  });

  it('renders branch node for nested note IDs', async () => {
    renderNoteTree({
      notes: [
        { id: 'parent:child', created_at: 1, updated_at: 2, current: 'local' },
      ],
    });
    await waitFor(() => {
      // The branch "parent" should render
      expect(screen.getByText('parent')).toBeInTheDocument();
    });
  });

  it('shows search results when searchQuery is provided', async () => {
    renderNoteTree({
      notes: [
        { id: 'apple', created_at: 1, updated_at: 2, current: 'local' },
        { id: 'banana', created_at: 3, updated_at: 4, current: 'local' },
      ],
      searchQuery: 'app',
    });
    await waitFor(() => {
      expect(screen.getByText('apple')).toBeInTheDocument();
    });
    // banana should not be visible (filtered out)
    expect(screen.queryByText('banana')).toBeNull();
  });

  it('shows "No notes match" when search has no results', async () => {
    renderNoteTree({
      notes: [
        { id: 'apple', created_at: 1, updated_at: 2, current: 'local' },
      ],
      searchQuery: 'zzz',
    });
    await waitFor(() => {
      expect(screen.getByText('No notes match')).toBeInTheDocument();
    });
  });

  it('highlights active note', async () => {
    renderNoteTree({
      notes: [
        { id: 'hello', created_at: 1, updated_at: 2, current: 'local' },
      ],
      activeNoteId: 'hello',
    });
    await waitFor(() => {
      const el = document.querySelector('[data-id="hello"]');
      expect(el).toBeInTheDocument();
      expect(el!.className).toContain('active');
    });
  });
});
