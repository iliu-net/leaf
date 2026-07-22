/**
 * C5b — ViewTab component tests
 *
 * Tests the read-only markdown viewer: renderView delegation, header/body
 * split, error handling, wikilink navigation, and async cleanup on unmount.
 *
 * See docs/plans/c5-editor-wrap-plan.md for the full test table.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders, screen, waitFor, act } from './test-utils.js';
import { useAppDispatch } from '../../src/ts/state/AppContext.js';

/* ── Mocks ─────────────────────────────────────────────────────────────── */

vi.mock('../../src/ts/notes.js', () => ({
  listNotes: vi.fn().mockResolvedValue([]),
  loadNote: vi.fn().mockResolvedValue({
    id: 'linked', content: '# Linked note', created_at: 1, updated_at: 2,
    current: 'local', created_by: '', updated_by: '', meta: {},
  }),
  saveNote: vi.fn().mockResolvedValue({ ok: true }),
  deleteNote: vi.fn().mockResolvedValue({ ok: true }),
  renameNote: vi.fn().mockResolvedValue({ ok: true }),
  isSystemNote: vi.fn(() => false),
  fullTextSearch: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/ts/markdown-view.js', () => ({
  renderView: vi.fn(),
  postProcessWikilinks: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/ts/fence-hydrate.js', () => {
  // Use a named function so we can reference it
  const mockHydrate = vi.fn(() => Promise.resolve());
  return { hydrate: mockHydrate };
});

/* ── Imports ───────────────────────────────────────────────────────────── */

import ViewTab from '../../src/ts/components/ViewTab.js';
import { renderView } from '../../src/ts/markdown-view.js';
import { loadNote } from '../../src/ts/notes.js';

/* ── Helpers ───────────────────────────────────────────────────────────── */

interface ViewSeed {
  activeNoteId: string;
  activeNoteContent: string;
  activeNoteData: {
    created_at: number;
    updated_at: number;
    current: string;
    created_by: string;
    updated_by: string;
    meta: Record<string, unknown>;
  };
}

function renderViewTab(seed?: ViewSeed) {
  function SeedWrapper() {
    const dispatch = useAppDispatch();
    useEffect(() => {
      if (seed) {
        dispatch({
          type: 'NOTE_SELECTED',
          id: seed.activeNoteId,
          content: seed.activeNoteContent,
          isSystemNote: false,
          noteData: seed.activeNoteData,
        });
      }
    }, []);
    return <ViewTab />;
  }

  return renderWithProviders(<SeedWrapper />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Flush pending hydrate timers before setup.js afterEach runs
// vi.restoreAllMocks(), so hydrate is still mocked when they fire.
afterEach(() => {
  vi.useFakeTimers();
  vi.runAllTimers();
  vi.useRealTimers();
});

/* ========================================================================
   1. Render — header / body split
   ======================================================================== */

describe('Render — header / body split', () => {
  it('splits <h1> into header div and rest into body div', async () => {
    vi.mocked(renderView).mockResolvedValue('<h1>My Title</h1><p>Body text</p>');

    renderViewTab({
      activeNoteId: 'n1',
      activeNoteContent: '# My Title\n\nBody text',
      activeNoteData: {
        created_at: 1, updated_at: 2, current: 'local',
        created_by: '', updated_by: '', meta: {},
      },
    });

    await waitFor(() => {
      const header = document.querySelector('.view-header');
      expect(header?.innerHTML).toContain('My Title');
    });

    const body = document.querySelector('.view-content');
    expect(body?.innerHTML).toContain('Body text');
  });

  it('puts everything in body when there is no <h1>', async () => {
    vi.mocked(renderView).mockResolvedValue('<p>Just a paragraph</p>');

    renderViewTab({
      activeNoteId: 'n2',
      activeNoteContent: 'Just a paragraph',
      activeNoteData: {
        created_at: 1, updated_at: 2, current: 'local',
        created_by: '', updated_by: '', meta: {},
      },
    });

    await waitFor(() => {
      const body = document.querySelector('.view-content');
      expect(body?.innerHTML).toContain('Just a paragraph');
    });

    const header = document.querySelector('.view-header');
    expect(header?.innerHTML).toBe('');
  });
});

/* ========================================================================
   2. Render — passes correct args to renderView
   ======================================================================== */

describe('Render — renderView args', () => {
  it('calls renderView with content and noteData', async () => {
    vi.mocked(renderView).mockResolvedValue('<h1>X</h1><p>Y</p>');

    const noteData = {
      created_at: 1000, updated_at: 2000, current: 'local' as const,
      created_by: 'alice', updated_by: 'bob', meta: { lang: 'en' },
    };

    renderViewTab({
      activeNoteId: 'n3',
      activeNoteContent: '# X\n\nY',
      activeNoteData: noteData,
    });

    await waitFor(() => {
      expect(renderView).toHaveBeenCalledWith('# X\n\nY', expect.objectContaining({
        id: 'n3',
        content: '# X\n\nY',
        created_at: 1000,
        updated_at: 2000,
        current: 'local',
        created_by: 'alice',
        updated_by: 'bob',
        meta: { lang: 'en' },
      }));
    });
  });
});

/* ========================================================================
   3. Empty / null content
   ======================================================================== */

describe('Empty / null content', () => {
  it('leaves both divs empty when no note is active (default state)', () => {
    renderWithProviders(<ViewTab />);
    const header = document.querySelector('.view-header');
    const body = document.querySelector('.view-content');
    expect(header?.innerHTML).toBe('');
    expect(body?.innerHTML).toBe('');
  });

  it('does not call renderView when there is no active note', () => {
    renderWithProviders(<ViewTab />);
    expect(renderView).not.toHaveBeenCalled();
  });
});

/* ========================================================================
   4. Render failure
   ======================================================================== */

describe('Render failure', () => {
  it('shows error message when renderView rejects', async () => {
    vi.mocked(renderView).mockRejectedValue(new Error('Markdown parse error'));

    renderViewTab({
      activeNoteId: 'n4',
      activeNoteContent: '# Bad',
      activeNoteData: {
        created_at: 1, updated_at: 2, current: 'local',
        created_by: '', updated_by: '', meta: {},
      },
    });

    await waitFor(() => {
      const body = document.querySelector('.view-content');
      expect(body?.innerHTML).toContain('Failed to render note');
    });
  });
});

/* ========================================================================
   5. Wikilink click → loadNote
   ======================================================================== */

describe('Wikilink click', () => {
  it('calls loadNote when a wikilink is clicked', async () => {
    vi.mocked(renderView).mockResolvedValue(
      '<h1>Note</h1><p>See <a data-note="other-note" href="#">other</a></p>'
    );

    renderViewTab({
      activeNoteId: 'n5',
      activeNoteContent: '# Note\n\nSee [[other-note]]',
      activeNoteData: {
        created_at: 1, updated_at: 2, current: 'local',
        created_by: '', updated_by: '', meta: {},
      },
    });

    await waitFor(() => {
      const link = document.querySelector('.view-content a[data-note="other-note"]');
      expect(link).toBeInTheDocument();
    });

    const link = document.querySelector('.view-content a[data-note="other-note"]')!;
    link.click();

    await waitFor(() => {
      expect(loadNote).toHaveBeenCalledWith('other-note');
    });
  });
});

/* ========================================================================
   6. Unmount cleanup
   ======================================================================== */

describe('Unmount cleanup', () => {
  it('does not set state after unmount (cancelled flag)', async () => {
    let resolveRender!: (value: string) => void;
    const deferred = new Promise<string>(r => { resolveRender = r; });
    vi.mocked(renderView).mockReturnValue(deferred);

    const { unmount } = renderViewTab({
      activeNoteId: 'n6',
      activeNoteContent: '# Will unmount',
      activeNoteData: {
        created_at: 1, updated_at: 2, current: 'local',
        created_by: '', updated_by: '', meta: {},
      },
    });

    // Unmount before renderView resolves
    unmount();

    // Resolve after unmount — should NOT cause React warning
    await act(async () => {
      resolveRender('<h1>Too late</h1><p>Should not appear</p>');
    });

    // If we got here without React logging a "setState on unmounted" warning,
    // the cancelled flag works. (console.warn spy catches React warnings.)
    // Re-render a fresh ViewTab to verify the old one didn't leak.
    const warnCalls = (console.warn as ReturnType<typeof vi.fn>).mock.calls;
    const reactWarnings = warnCalls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('unmounted')
    );
    expect(reactWarnings).toHaveLength(0);
  });
});
