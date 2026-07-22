/**
 * D2a — TrashPreview component tests
 *
 * Tests the deleted-note preview: null when no trashPreview, banner bar with
 * note ID + Restore/Purge buttons, markdown rendering via renderView,
 * render failure state, and hydrate call for fenced code blocks.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders, screen, waitFor, act } from './test-utils.js';
import { useAppDispatch } from '../../src/ts/state/AppContext.js';

/* ── Hoisted mocks — all variables used in vi.mock factories go here ──── */

const {
  mockRenderView,
  mockHydrate,
  mockRestoreItem,
  mockPurgeItem,
  mockRefreshTrashList,
  mockRefreshList,
  mockLoadNote,
} = vi.hoisted(() => ({
  mockRenderView: vi.fn(),
  mockHydrate: vi.fn(),
  mockRestoreItem: vi.fn(),
  mockPurgeItem: vi.fn(),
  mockRefreshTrashList: vi.fn(),
  mockRefreshList: vi.fn(),
  mockLoadNote: vi.fn(),
}));

/* ── vi.mock (hoisted — uses only hoisted variables) ──────────────────── */

vi.mock('../../src/ts/markdown-view.js', () => ({
  renderView: mockRenderView,
  postProcessWikilinks: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/ts/fence-hydrate.js', () => ({
  hydrate: mockHydrate,
}));

vi.mock('../../src/ts/hooks/useTrash.js', () => ({
  useTrash: () => ({
    restoreItem: mockRestoreItem,
    purgeItem: mockPurgeItem,
    refreshTrashList: mockRefreshTrashList,
    trash: [],
    getContent: vi.fn().mockResolvedValue(null),
    emptyAll: vi.fn().mockResolvedValue(undefined),
    toggleTrash: vi.fn(),
  }),
}));

vi.mock('../../src/ts/hooks/useNotes.js', () => ({
  useNotes: () => ({
    refreshList: mockRefreshList,
    loadNote: mockLoadNote,
    setContent: vi.fn(),
    saveNote: vi.fn().mockResolvedValue(undefined),
    createNote: vi.fn(),
    deleteNote: vi.fn(),
    renameNote: vi.fn(),
    fullTextSearch: vi.fn(),
    clearEditor: vi.fn(),
    noteList: [],
    activeNoteId: null,
    activeNoteContent: null,
  }),
}));

vi.mock('../../src/ts/hooks/useConfirm.js', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
  useConfirmDialog: () => ({ handleConfirm: vi.fn(), handleCancel: vi.fn() }),
}));

/* ── Imports ───────────────────────────────────────────────────────────── */

import TrashPreview from '../../src/ts/components/TrashPreview.js';

/* ── Helpers ───────────────────────────────────────────────────────────── */

function renderWithTrashPreview(preview: {
  id: string;
  content: string;
  source: 'local' | 'server';
  meta: Record<string, unknown>;
} | null) {
  function SeedWrapper() {
    const dispatch = useAppDispatch();
    useEffect(() => {
      if (preview) {
        dispatch({
          type: 'SHOW_TRASH_PREVIEW',
          id: preview.id,
          content: preview.content,
          source: preview.source,
          meta: preview.meta as any,
        });
      }
    }, []);
    return <TrashPreview />;
  }

  return renderWithProviders(<SeedWrapper />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default resolved values
  mockRenderView.mockResolvedValue('<h1>Deleted Note</h1><p>Body text</p>');
  mockHydrate.mockResolvedValue(undefined);
  mockRestoreItem.mockResolvedValue(undefined);
  mockPurgeItem.mockResolvedValue(undefined);
  mockRefreshTrashList.mockResolvedValue([]);
  mockRefreshList.mockResolvedValue(undefined);
  mockLoadNote.mockResolvedValue({
    id: 'x', content: '', created_at: 1, updated_at: 1,
    current: 'local', created_by: '', updated_by: '', meta: {},
  });
});

// Flush pending hydrate setTimeout(0) timers before setup.js afterEach
// runs vi.restoreAllMocks(), so hydrate is still mocked when they fire.
afterEach(() => {
  vi.useFakeTimers();
  vi.runAllTimers();
  vi.useRealTimers();
});

/* ========================================================================
   1. Null / empty state
   ======================================================================== */

describe('Null / empty state', () => {
  it('returns null when trashPreview is not set (default)', () => {
    const { container } = renderWithProviders(<TrashPreview />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when trashPreview is null', () => {
    renderWithTrashPreview(null);
    const banner = document.getElementById('trash-banner');
    expect(banner).toBeNull();
  });
});

/* ========================================================================
   2. Banner bar
   ======================================================================== */

describe('Banner bar', () => {
  it('shows note ID in quotes in the banner title', async () => {
    renderWithTrashPreview({
      id: 'deleted.md',
      content: '# Old note',
      source: 'local',
      meta: {},
    });

    await waitFor(() => {
      const title = document.getElementById('trash-banner-title');
      expect(title).toBeInTheDocument();
      expect(title!.textContent).toContain('deleted.md');
    });
  });

  it('shows Restore and Purge buttons', async () => {
    renderWithTrashPreview({
      id: 'deleted.md',
      content: '# Old note',
      source: 'local',
      meta: {},
    });

    await waitFor(() => {
      expect(screen.getByText('Restore')).toBeInTheDocument();
      expect(screen.getByText('Delete forever')).toBeInTheDocument();
    });
  });
});

/* ========================================================================
   3. Markdown rendering
   ======================================================================== */

describe('Markdown rendering', () => {
  it('calls renderView with content and constructed NoteData', async () => {
    renderWithTrashPreview({
      id: 'deleted.md',
      content: '# Old\n\nContent',
      source: 'local',
      meta: {
        created_at: 1000,
        updated_at: 2000,
        current: 'server',
        created_by: 'alice',
        updated_by: 'bob',
      },
    });

    await waitFor(() => {
      expect(mockRenderView).toHaveBeenCalledWith(
        '# Old\n\nContent',
        expect.objectContaining({
          id: 'deleted.md',
          content: '# Old\n\nContent',
          created_at: 1000,
          updated_at: 2000,
          current: 'server',
          created_by: 'alice',
          updated_by: 'bob',
        }),
      );
    });
  });

  it('renders HTML content in the body div', async () => {
    renderWithTrashPreview({
      id: 'n.md',
      content: '# Title',
      source: 'local',
      meta: {},
    });

    await waitFor(() => {
      const body = document.getElementById('trash-banner-body');
      expect(body).toBeInTheDocument();
      expect(body!.innerHTML).toContain('Deleted Note');
    });
  });
});

/* ========================================================================
   4. Render failure
   ======================================================================== */

describe('Render failure', () => {
  it('shows error message when renderView rejects', async () => {
    mockRenderView.mockRejectedValueOnce(new Error('Parse fail'));

    renderWithTrashPreview({
      id: 'bad.md',
      content: '# Broken',
      source: 'local',
      meta: {},
    });

    await waitFor(() => {
      const body = document.getElementById('trash-banner-body');
      expect(body!.innerHTML).toContain('Failed to render preview');
    });
  });
});

/* ========================================================================
   5. Hydrate call
   ======================================================================== */

describe('Hydrate call', () => {
  it('calls hydrate after markdown render completes', async () => {
    renderWithTrashPreview({
      id: 'n.md',
      content: '# Title',
      source: 'local',
      meta: {},
    });

    // Wait for renderView to resolve and html state to update
    await waitFor(() => {
      expect(mockRenderView).toHaveBeenCalled();
    });

    // The hydrate effect fires a requestAnimationFrame after html is set.
    // jsdom processes rAF callbacks during event-loop turns triggered by
    // waitFor's internal polling.
    await waitFor(() => {
      expect(mockHydrate).toHaveBeenCalled();
    });
  });
});
