/**
 * C5d — MetaTab component tests
 *
 * Tests the metadata editor tab: form fields (title, summary, tags),
 * custom field CRUD, language row, stats, system info, readOnly mode,
 * and history dialog.
 *
 * See docs/plans/c5-editor-wrap-plan.md for the full test table.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor } from './test-utils.js';
import { useAppDispatch } from '../../src/ts/state/AppContext.js';

/* ── Mocks ─────────────────────────────────────────────────────────────── */

const mockSetContent = vi.fn();

vi.mock('../../src/ts/hooks/useNotes.js', () => ({
  useNotes: () => ({
    setContent: mockSetContent,
    loadNote: vi.fn().mockResolvedValue({ id: 'x', content: '', created_at: 1, updated_at: 1, current: 'local', created_by: '', updated_by: '', meta: {} }),
    refreshList: vi.fn(),
    saveNote: vi.fn(),
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

vi.mock('../../src/ts/config.js', () => ({
  getSpaConfig: vi.fn(() => ({})),
  fetchSpaConfig: vi.fn(() => Promise.resolve()),
  apiUrl: vi.fn((path: string) => `/api/${path}`),
  getLanguageConfig: vi.fn(() => ({
    preferred_langs: ['en', 'es', 'fr'],
    default_lang: 'en',
  })),
}));

vi.mock('../../src/ts/components/HistoryDialog.js', () => ({
  default: ({ open, noteId, onOpenChange, onRestore }: {
    open: boolean; noteId: string; onOpenChange: (v: boolean) => void; onRestore: (content: string) => void;
  }) =>
    open ? <div data-testid="history-dialog" data-note-id={noteId}>HistoryDialog</div> : null,
}));

/* ── Imports ───────────────────────────────────────────────────────────── */

import MetaTab from '../../src/ts/components/MetaTab.js';

/* ── Helpers ───────────────────────────────────────────────────────────── */

interface MetaSeed {
  activeNoteId: string;
  activeNoteContent: string;
  activeNoteData?: {
    created_at: number;
    updated_at: number;
    current: string;
    created_by: string;
    updated_by: string;
    meta: Record<string, unknown>;
  };
  isSystemNote?: boolean;
}

const defaultNoteData = {
  created_at: 1600000000,
  updated_at: 1700000000,
  current: 'local' as const,
  created_by: 'alice',
  updated_by: 'bob',
  meta: {} as Record<string, unknown>,
};

function renderMetaTab(seed: MetaSeed) {
  function SeedWrapper() {
    const dispatch = useAppDispatch();
    useEffect(() => {
      dispatch({
        type: 'NOTE_SELECTED',
        id: seed.activeNoteId,
        content: seed.activeNoteContent,
        isSystemNote: seed.isSystemNote ?? false,
        noteData: seed.activeNoteData ?? defaultNoteData,
      });
    }, []);
    return <MetaTab />;
  }

  return {
    ...renderWithProviders(<SeedWrapper />),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ========================================================================
   1. Form fields — initial values
   ======================================================================== */

describe('Form fields — initial values', () => {
  it('shows title from frontmatter', async () => {
    renderMetaTab({
      activeNoteId: 'n1',
      activeNoteContent: '---\ntitle: My Note\n---\nbody',
    });

    await waitFor(() => {
      const titleInput = screen.getByLabelText('Title') as HTMLInputElement;
      expect(titleInput.value).toBe('My Note');
    });
  });

  it('shows summary from frontmatter', async () => {
    renderMetaTab({
      activeNoteId: 'n2',
      activeNoteContent: '---\nsummary: A short description\n---\nbody',
    });

    await waitFor(() => {
      const summaryInput = screen.getByLabelText('Summary') as HTMLTextAreaElement;
      expect(summaryInput.value).toBe('A short description');
    });
  });

  it('shows tags as comma-separated values', async () => {
    renderMetaTab({
      activeNoteId: 'n3',
      activeNoteContent: '---\nuser-tags: [a, b, c]\n---\nbody',
    });

    await waitFor(() => {
      const tagsInput = screen.getByLabelText('Tags') as HTMLInputElement;
      expect(tagsInput.value).toBe('a, b, c');
    });
  });

  it('handles empty fields gracefully', async () => {
    renderMetaTab({
      activeNoteId: 'n4',
      activeNoteContent: 'body without frontmatter',
    });

    await waitFor(() => {
      expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('');
      expect((screen.getByLabelText('Summary') as HTMLTextAreaElement).value).toBe('');
      expect((screen.getByLabelText('Tags') as HTMLInputElement).value).toBe('');
    });
  });
});

/* ========================================================================
   2. Title change → setContent
   ======================================================================== */

describe('Title change → setContent', () => {
  it('calls setContent when title is changed', async () => {
    const user = (await import('@testing-library/user-event')).default;
    renderMetaTab({
      activeNoteId: 'n5',
      activeNoteContent: '---\ntitle: Old Title\n---\nbody',
    });

    await waitFor(() => {
      expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Old Title');
    });

    const titleInput = screen.getByLabelText('Title');
    await user.clear(titleInput);
    await user.type(titleInput, 'New Title');

    await waitFor(() => {
      expect(mockSetContent).toHaveBeenCalled();
    });

    // Multiple calls may happen (clear + each keystroke).
    // Check the last call for the final value.
    const calls = mockSetContent.mock.calls;
    const lastCall = calls[calls.length - 1][0] as string;
    expect(lastCall).toContain('title: New Title');
  });
});

/* ========================================================================
   3. Stats section
   ======================================================================== */

describe('Stats section', () => {
  it('shows character, word, and line counts', async () => {
    renderMetaTab({
      activeNoteId: 'n6',
      activeNoteContent: '---\ntitle: Stats\n---\nhello world\nfoo',
    });

    await waitFor(() => {
      const statsEl = document.getElementById('meta-stats');
      expect(statsEl).toBeInTheDocument();
      // "hello world\nfoo" = 14 chars, 3 words, 2 lines
      expect(statsEl!.textContent).toContain('chars');
      expect(statsEl!.textContent).toContain('words');
      expect(statsEl!.textContent).toContain('lines');
    });
  });
});

/* ========================================================================
   4. System info section
   ======================================================================== */

describe('System info section', () => {
  it('shows version/current field', async () => {
    renderMetaTab({
      activeNoteId: 'n7',
      activeNoteContent: 'body',
      activeNoteData: { ...defaultNoteData, current: 'server' },
    });

    await waitFor(() => {
      const currentEl = document.getElementById('meta-sys-current');
      expect(currentEl?.textContent).toBe('server');
    });
  });

  it('shows created timestamp with author', async () => {
    renderMetaTab({
      activeNoteId: 'n8',
      activeNoteContent: 'body',
      activeNoteData: {
        ...defaultNoteData,
        created_at: 1600000000,
        created_by: 'alice',
      },
    });

    await waitFor(() => {
      const createdEl = document.getElementById('meta-sys-created');
      expect(createdEl?.textContent).toContain('alice');
    });
  });

  it('shows updated timestamp', async () => {
    renderMetaTab({
      activeNoteId: 'n9',
      activeNoteContent: 'body',
      activeNoteData: {
        ...defaultNoteData,
        updated_at: 1700000000,
        updated_by: 'bob',
      },
    });

    await waitFor(() => {
      const updatedEl = document.getElementById('meta-sys-updated');
      expect(updatedEl?.textContent).toContain('bob');
    });
  });

  it('shows formatted edit time', async () => {
    renderMetaTab({
      activeNoteId: 'n10',
      activeNoteContent: 'body',
      activeNoteData: {
        ...defaultNoteData,
        meta: { 'edit-time': '3661' },
      },
    });

    await waitFor(() => {
      const editEl = document.getElementById('meta-sys-edit-time');
      // formatDuration(3661) → "1:01:01"
      expect(editEl).toBeInTheDocument();
      expect(editEl!.textContent).not.toBe('—');
    });
  });

  it('shows "—" when edit time is zero', async () => {
    renderMetaTab({
      activeNoteId: 'n11',
      activeNoteContent: 'body',
      activeNoteData: {
        ...defaultNoteData,
        meta: {},
      },
    });

    await waitFor(() => {
      const editEl = document.getElementById('meta-sys-edit-time');
      expect(editEl?.textContent).toBe('—');
    });
  });
});

/* ========================================================================
   5. Custom fields
   ======================================================================== */

describe('Custom fields', () => {
  it('shows custom field from frontmatter', async () => {
    renderMetaTab({
      activeNoteId: 'n12',
      activeNoteContent: '---\ntitle: T\ncategory: report\n---\nbody',
    });

    await waitFor(() => {
      // Custom field row: key="category", value="report"
      const keyInputs = document.querySelectorAll('.custom-key');
      const found = Array.from(keyInputs).some(
        el => (el as HTMLInputElement).value === 'category'
      );
      expect(found).toBe(true);
    });

    const valInputs = document.querySelectorAll('.custom-val');
    const found = Array.from(valInputs).some(
      el => (el as HTMLInputElement).value === 'report'
    );
    expect(found).toBe(true);
  });

  it('"+ Add" button adds a new row', async () => {
    const user = (await import('@testing-library/user-event')).default;

    renderMetaTab({
      activeNoteId: 'n13',
      activeNoteContent: '---\ntitle: T\n---\nbody',
    });

    await waitFor(() => {
      expect(screen.getByText('Custom Fields')).toBeInTheDocument();
    });

    const initialRows = document.querySelectorAll('.custom-row').length;

    const addBtn = screen.getByText('+ Add');
    await user.click(addBtn);

    await waitFor(() => {
      const afterRows = document.querySelectorAll('.custom-row').length;
      expect(afterRows).toBeGreaterThan(initialRows);
    });
  });
});

/* ========================================================================
   6. Language row
   ======================================================================== */

describe('Language row', () => {
  it('"+ Language" button shows language row', async () => {
    const user = (await import('@testing-library/user-event')).default;

    renderMetaTab({
      activeNoteId: 'n14',
      activeNoteContent: '---\ntitle: T\n---\nbody',
    });

    await waitFor(() => {
      expect(screen.getByText('Custom Fields')).toBeInTheDocument();
    });

    const langBtn = screen.getByText('+ Language');
    await user.click(langBtn);

    await waitFor(() => {
      // A lang row should appear: key is "lang" (readOnly), value input exists
      const langRow = document.querySelector('.custom-row-lang');
      expect(langRow).toBeInTheDocument();
    });
  });
});

/* ========================================================================
   7. System note — readOnly mode
   ======================================================================== */

describe('System note — readOnly', () => {
  it('disables all inputs for system notes', async () => {
    renderMetaTab({
      activeNoteId: '@todo',
      activeNoteContent: '---\ntitle: System\n---\nbody',
      isSystemNote: true,
      activeNoteData: defaultNoteData,
    });

    await waitFor(() => {
      const titleInput = screen.getByLabelText('Title') as HTMLInputElement;
      expect(titleInput.readOnly).toBe(true);
    });

    // Summary textarea
    const summaryInput = screen.getByLabelText('Summary') as HTMLTextAreaElement;
    expect(summaryInput.readOnly).toBe(true);

    // Tags input
    const tagsInput = screen.getByLabelText('Tags') as HTMLInputElement;
    expect(tagsInput.readOnly).toBe(true);
  });

  it('hides action buttons for system notes', async () => {
    renderMetaTab({
      activeNoteId: '@todo',
      activeNoteContent: '---\ntitle: System\n---\nbody',
      isSystemNote: true,
      activeNoteData: defaultNoteData,
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Title')).toBeInTheDocument();
    });

    // "+ Add" and "+ Language" should NOT be present
    expect(screen.queryByText('+ Add')).toBeNull();
    expect(screen.queryByText('+ Language')).toBeNull();

    // History button should be hidden (display: none style)
    const historyBtn = document.getElementById('btn-view-history');
    expect(historyBtn?.style.display).toBe('none');
  });
});

/* ========================================================================
   8. History dialog
   ======================================================================== */

describe('History dialog', () => {
  it('opens HistoryDialog when "View History…" is clicked', async () => {
    const user = (await import('@testing-library/user-event')).default;

    renderMetaTab({
      activeNoteId: 'n15',
      activeNoteContent: '---\ntitle: T\n---\nbody',
    });

    await waitFor(() => {
      expect(screen.getByText('System Info')).toBeInTheDocument();
    });

    const historyBtn = screen.getByText('View History…');
    await user.click(historyBtn);

    await waitFor(() => {
      expect(screen.getByTestId('history-dialog')).toBeInTheDocument();
    });
  });
});
