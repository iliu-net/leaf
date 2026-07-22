/**
 * C5a — EditorWrap orchestrator tests
 *
 * Tests the editor-area routing logic: empty state, tab bar visibility,
 * tab switching, system-note tab hiding, and trash-preview override.
 * Child components (ViewTab, CodeTab, MetaTab, TrashPreview) are mocked
 * to simple data-testid divs so only EditorWrap's logic is exercised.
 *
 * See docs/plans/c5-editor-wrap-plan.md for the full test table.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen } from './test-utils.js';
import { useAppDispatch } from '../../src/ts/state/AppContext.js';

/* ── Mocks (hoisted) ───────────────────────────────────────────────────── */

vi.mock('../../src/ts/components/ViewTab.js', () => ({
  default: () => <div data-testid="view-tab">ViewTab</div>,
}));

vi.mock('../../src/ts/components/CodeTab.js', () => ({
  default: () => <div data-testid="code-tab">CodeTab</div>,
}));

vi.mock('../../src/ts/components/MetaTab.js', () => ({
  default: () => <div data-testid="meta-tab">MetaTab</div>,
}));

vi.mock('../../src/ts/components/TrashPreview.js', () => ({
  default: () => <div data-testid="trash-preview">TrashPreview</div>,
}));

/* ── Imports ───────────────────────────────────────────────────────────── */

import EditorWrap from '../../src/ts/components/EditorWrap.js';

/* ── Helpers ───────────────────────────────────────────────────────────── */

interface SeedOpts {
  activeNoteId?: string | null;
  activeNoteContent?: string | null;
  activeTab?: 'view' | 'code' | 'meta';
  isSystemNote?: boolean;
  trashPreview?: {
    id: string;
    content: string;
    source: 'local' | 'server';
    meta: Record<string, unknown>;
  } | null;
}

function seedNoteData() {
  return {
    created_at: 1600000000,
    updated_at: 1700000000,
    current: 'local',
    created_by: '',
    updated_by: '',
    meta: {},
  };
}

function renderEditorWrap(seed?: SeedOpts) {
  const s = seed ?? {};

  function SeedWrapper() {
    const dispatch = useAppDispatch();
    useEffect(() => {
      if (s.activeNoteId) {
        dispatch({
          type: 'NOTE_SELECTED',
          id: s.activeNoteId,
          content: s.activeNoteContent ?? '',
          isSystemNote: s.isSystemNote ?? false,
          noteData: seedNoteData(),
        });
        // NOTE_SELECTED may override activeTab (empty content → code tab).
        // Re-apply the desired tab if different.
        const defaultTab = (!s.activeNoteContent?.trim() && !s.isSystemNote) ? 'code' : 'view';
        if (s.activeTab && s.activeTab !== defaultTab) {
          dispatch({ type: 'SET_ACTIVE_TAB', tab: s.activeTab });
        }
      }
      if (s.trashPreview) {
        dispatch({
          type: 'SHOW_TRASH_PREVIEW',
          id: s.trashPreview.id,
          content: s.trashPreview.content,
          source: s.trashPreview.source,
          meta: s.trashPreview.meta as any,
        });
      }
    }, []);
    return <EditorWrap />;
  }

  return renderWithProviders(<SeedWrapper />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ========================================================================
   1. Empty state
   ======================================================================== */

describe('Empty state', () => {
  it('shows "Select a note or create a new one" when no note is active', () => {
    renderEditorWrap();
    expect(screen.getByText('Select a note or create a new one')).toBeInTheDocument();
  });

  it('does NOT render tabs when no note is active', () => {
    renderEditorWrap();
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});

/* ========================================================================
   2. Tab bar — visibility
   ======================================================================== */

describe('Tab bar — visibility', () => {
  it('renders tab bar when a note is active', () => {
    renderEditorWrap({ activeNoteId: 'note1', activeNoteContent: '# Hello' });
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('shows View, Code, and Meta tab triggers', () => {
    renderEditorWrap({ activeNoteId: 'note1', activeNoteContent: '# Hello' });
    expect(screen.getByRole('tab', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Code' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Meta' })).toBeInTheDocument();
  });

  it('View tab is active by default', () => {
    renderEditorWrap({ activeNoteId: 'note1', activeNoteContent: '# Hello' });
    const viewTab = screen.getByRole('tab', { name: 'View' });
    expect(viewTab).toHaveAttribute('data-state', 'active');
  });
});

/* ========================================================================
   3. Tab switching
   ======================================================================== */

describe('Tab switching', () => {
  it('can switch to Code tab via dispatch', () => {
    renderEditorWrap({
      activeNoteId: 'note1',
      activeNoteContent: '# Hello',
      activeTab: 'code',
    });
    const codeTab = screen.getByRole('tab', { name: 'Code' });
    expect(codeTab).toHaveAttribute('data-state', 'active');
  });

  it('can switch to Meta tab via dispatch', () => {
    renderEditorWrap({
      activeNoteId: 'note1',
      activeNoteContent: '# Hello',
      activeTab: 'meta',
    });
    const metaTab = screen.getByRole('tab', { name: 'Meta' });
    expect(metaTab).toHaveAttribute('data-state', 'active');
  });

  it('renders mock child components (all mounted via forceMount)', () => {
    renderEditorWrap({ activeNoteId: 'note1', activeNoteContent: '# Hello', activeTab: 'view' });
    // forceMount on all panels → all mocks are in the DOM
    expect(screen.getByTestId('view-tab')).toBeInTheDocument();
    expect(screen.getByTestId('code-tab')).toBeInTheDocument();
    expect(screen.getByTestId('meta-tab')).toBeInTheDocument();
  });

  it('switches to code tab for empty content (reducer default)', () => {
    // NOTE_SELECTED with empty content → activeTab becomes 'code'
    renderEditorWrap({ activeNoteId: 'note1', activeNoteContent: '' });
    const codeTab = screen.getByRole('tab', { name: 'Code' });
    expect(codeTab).toHaveAttribute('data-state', 'active');
  });
});

/* ========================================================================
   4. System note — Code tab hidden
   ======================================================================== */

describe('System note', () => {
  it('hides Code tab for system notes', () => {
    renderEditorWrap({
      activeNoteId: '@todo',
      activeNoteContent: '# System',
      isSystemNote: true,
    });

    // Code tab trigger has style="display: none" — Radix renders
    // the element with display:none inline style, but its accessible
    // name may not be computable by testing-library. Query by id.
    const codeTab = document.getElementById('tab-btn-code') as HTMLElement;
    expect(codeTab).toBeInTheDocument();
    expect(codeTab.style.display).toBe('none');

    // View and Meta are still visible
    expect(screen.getByRole('tab', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Meta' })).toBeInTheDocument();
  });
});

/* ========================================================================
   5. Trash preview
   ======================================================================== */

describe('Trash preview', () => {
  it('shows TrashPreview when trashPreview is set', () => {
    renderEditorWrap({
      trashPreview: {
        id: 'deleted.md',
        content: '# Old note',
        source: 'local',
        meta: {},
      },
    });

    expect(screen.getByTestId('trash-preview')).toBeInTheDocument();
  });

  it('does NOT show tabs when trash preview is active', () => {
    renderEditorWrap({
      trashPreview: {
        id: 'deleted.md',
        content: '# Old note',
        source: 'local',
        meta: {},
      },
    });

    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('does NOT show empty state when trash preview is active', () => {
    renderEditorWrap({
      trashPreview: {
        id: 'deleted.md',
        content: '# Old note',
        source: 'local',
        meta: {},
      },
    });

    expect(screen.queryByText('Select a note or create a new one')).toBeNull();
  });
});
