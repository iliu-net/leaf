/**
 * C4c — Sidebar integration tests
 *
 * Tests mode switching (notes/trash/tags), search bar, note count display,
 * and basic rendering.  Mocks the full data layer (notes.ts, trash.ts,
 * config.ts, api.ts, system-notes/registry.ts).
 *
 * See docs/plans/c4-sidebar-plan.md for the full test table.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor, act } from './test-utils.js';
import { useAppDispatch } from '../../src/ts/state/AppContext.js';
import type { NoteMeta } from '../../src/ts/notes.js';

/* ── Mocks ────────────────────────────────────────────────────────────── */

vi.mock('../../src/ts/notes.js', () => ({
  listNotes: vi.fn().mockResolvedValue([]),
  loadNote: vi.fn().mockResolvedValue({
    id: 'test', content: '# Hello', created_at: 1, updated_at: 2,
    current: 'local', created_by: '', updated_by: '', meta: {},
  }),
  saveNote: vi.fn().mockResolvedValue({ ok: true }),
  deleteNote: vi.fn().mockResolvedValue({ ok: true }),
  renameNote: vi.fn().mockResolvedValue({ ok: true }),
  isSystemNote: vi.fn(() => false),
  fullTextSearch: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/ts/trash.js', () => ({
  loadLocalTrashEntries: vi.fn().mockResolvedValue([]),
  mergeTrashEntries: vi.fn((local: any, server: any) => [...local, ...server]),
  getLocalTrashContent: vi.fn().mockResolvedValue(null),
  restoreLocalTrash: vi.fn().mockResolvedValue(undefined),
  purgeLocalTrash: vi.fn().mockResolvedValue(undefined),
  emptyLocalTrash: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/ts/config.js', () => ({
  getSpaConfig: vi.fn(() => ({})),
  fetchSpaConfig: vi.fn(() => Promise.resolve()),
  apiUrl: vi.fn((path: string) => `/api/${path}`),
}));

vi.mock('../../src/ts/api.js', () => ({
  fetchTrashList: vi.fn().mockResolvedValue([]),
  fetchTrashRestore: vi.fn(),
  fetchTrashPreview: vi.fn(),
  fetchTrashPurge: vi.fn(),
  fetchTrashEmpty: vi.fn(),
  syncRequest: vi.fn(),
}));

vi.mock('../../src/ts/system-notes/registry.js', () => ({
  listSystemNotes: vi.fn(() => []),
  isSystemNote: vi.fn(() => false),
  getSystemNote: vi.fn(),
}));

/* ── Imports ───────────────────────────────────────────────────────────── */

import Sidebar from '../../src/ts/components/Sidebar.js';

/* ── Helpers ───────────────────────────────────────────────────────────── */

function noteMeta(overrides?: Partial<NoteMeta>): NoteMeta {
  return { id: 'a', created_at: 1, updated_at: 2, current: 'local', ...overrides };
}

function renderSidebar(opts?: {
  notes?: NoteMeta[];
  activeNoteId?: string;
  sidebarMode?: 'notes' | 'trash' | 'tags';
  onOpenModal?: ReturnType<typeof vi.fn>;
  onLogout?: ReturnType<typeof vi.fn>;
  onResetDB?: ReturnType<typeof vi.fn>;
}) {
  const {
    notes = [],
    activeNoteId,
    sidebarMode,
    onOpenModal = vi.fn(),
    onLogout = vi.fn(),
    onResetDB = vi.fn(),
  } = opts ?? {};

  function SeedWrapper() {
    const dispatch = useAppDispatch();
    useEffect(() => {
      if (notes.length > 0) {
        dispatch({ type: 'NOTES_LOADED', notes });
      }
      if (activeNoteId) {
        dispatch({
          type: 'NOTE_SELECTED',
          id: activeNoteId,
          content: '# Test',
          isSystemNote: false,
          noteData: null,
        });
      }
      if (sidebarMode) {
        dispatch({ type: 'SET_SIDEBAR_MODE', mode: sidebarMode });
      }
    }, []);
    return <Sidebar onOpenModal={onOpenModal} onLogout={onLogout} onResetDB={onResetDB} />;
  }

  return {
    ...renderWithProviders(<SeedWrapper />),
    props: { onOpenModal, onLogout, onResetDB },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ========================================================================
   1. Basic rendering
   ======================================================================== */

describe('Basic rendering', () => {
  it('renders sidebar with search bar and New button', () => {
    renderSidebar();
    // Two inputs share placeholder "Filter…" — use aria-label to distinguish
    expect(screen.getByLabelText('Filter notes')).toBeInTheDocument();
    expect(screen.getByTitle('New note')).toBeInTheDocument();
  });

  it('shows note count in footer', () => {
    renderSidebar({ notes: [noteMeta({ id: 'a' }), noteMeta({ id: 'b' })] });
    expect(screen.getByText('2 notes')).toBeInTheDocument();
  });

  it('shows "0 notes" when empty', () => {
    renderSidebar({ notes: [] });
    expect(screen.getByText('0 notes')).toBeInTheDocument();
  });

  it('shows singular "1 note" for single note', () => {
    renderSidebar({ notes: [noteMeta({ id: 'only' })] });
    expect(screen.getByText('1 note')).toBeInTheDocument();
  });
});

/* ========================================================================
   2. Trash mode
   ======================================================================== */

describe('Trash mode', () => {
  it('shows trash toolbar when in trash mode', () => {
    renderSidebar({ sidebarMode: 'trash' });
    // Trash search input identified by aria-label
    expect(screen.getByLabelText('Filter trash')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Empty trash' })).toBeInTheDocument();
  });

  it('Empty trash button is disabled when trash is empty', () => {
    renderSidebar({ sidebarMode: 'trash' });
    const btn = screen.getByRole('button', { name: 'Empty trash' });
    expect(btn).toBeDisabled();
  });

  it('shows "Trash is empty" when in trash mode with no entries', () => {
    renderSidebar({ sidebarMode: 'trash' });
    expect(screen.getByText('Trash is empty')).toBeInTheDocument();
  });
});

/* ========================================================================
   3. New button
   ======================================================================== */

describe('New button', () => {
  it('calls onOpenModal when clicked', async () => {
    const user = (await import('@testing-library/user-event')).default;
    const { props } = renderSidebar();
    await user.setup().click(screen.getByTitle('New note'));
    expect(props.onOpenModal).toHaveBeenCalledWith('create', undefined, '');
  });
});
