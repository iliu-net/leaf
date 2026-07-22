/**
 * D1d — Header component tests
 *
 * Tests the app header: file name display, dirty dot, save button enabled/disabled
 * logic, sign-in/sign-out button visibility, username display, and cookmode toggle.
 *
 * Menu dropdown items and mode switching are tested at the integration level.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor } from './test-utils.js';
import { useAppDispatch } from '../../src/ts/state/AppContext.js';

/* ── Mocks ─────────────────────────────────────────────────────────────── */

const mockSaveNote = vi.fn().mockResolvedValue(undefined);
const mockSetContent = vi.fn();

vi.mock('../../src/ts/hooks/useNotes.js', () => ({
  useNotes: () => ({
    setContent: mockSetContent,
    saveNote: mockSaveNote,
    loadNote: vi.fn().mockResolvedValue({ id: 'x', content: '', created_at: 1, updated_at: 1, current: 'local', created_by: '', updated_by: '', meta: {} }),
    refreshList: vi.fn(),
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

vi.mock('../../src/ts/hooks/useTrash.js', () => ({
  useTrash: () => ({
    toggleTrash: vi.fn().mockResolvedValue(undefined),
    trash: [],
    refreshTrashList: vi.fn().mockResolvedValue([]),
    getContent: vi.fn().mockResolvedValue(null),
    restoreItem: vi.fn().mockResolvedValue(undefined),
    purgeItem: vi.fn().mockResolvedValue(undefined),
    emptyAll: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockShowLogin = vi.fn();
const mockLogout = vi.fn().mockResolvedValue(undefined);

// Header reads auth.username/auth.showLogin from useAppState() (reducer),
// and showLogin/logout functions from useAuth(). The mock only needs the
// functions — the boolean auth state is seeded via dispatch.
vi.mock('../../src/ts/hooks/useAuth.js', () => ({
  useAuth: () => ({
    showLogin: mockShowLogin,
    logout: mockLogout,
    restoreSession: vi.fn().mockResolvedValue('ok'),
    login: vi.fn().mockResolvedValue(true),
    dismissLogin: vi.fn(),
    showSignIn: vi.fn(),
    onFailure: vi.fn(),
    getUsername: vi.fn(() => null),
    isAuthEnabled: true,
  }),
}));

vi.mock('../../src/ts/hooks/useEditTime.js', () => ({
  mergeEditTime: vi.fn((content: string) => content),
  useEditTime: vi.fn(),
  noteEditActivity: vi.fn(),
}));

vi.mock('../../src/ts/sync.js', () => ({
  onSyncStatus: vi.fn(() => () => {}),
  syncStart: vi.fn(),
  stopSync: vi.fn(),
  clearRevision: vi.fn(),
  syncNow: vi.fn(),
}));

vi.mock('../../src/ts/db.js', () => ({
  db: { delete: vi.fn().mockResolvedValue(undefined) },
  ensureDbOpen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/ts/themes.js', () => ({
  setTheme: vi.fn(),
  getTheme: vi.fn(() => 'dark'),
  initThemeSwitcher: vi.fn(),
}));

vi.mock('../../src/ts/cookmode.js', () => ({
  isActive: vi.fn(() => false),
  toggle: vi.fn().mockResolvedValue(true),
  onCookmodeChange: vi.fn(),
  enable: vi.fn().mockResolvedValue(true),
  disable: vi.fn().mockResolvedValue(undefined),
  updateButton: vi.fn(),
}));

/* ── Imports ───────────────────────────────────────────────────────────── */

import Header from '../../src/ts/components/Header.js';

/* ── Helpers ───────────────────────────────────────────────────────────── */

interface HeaderSeed {
  activeNoteId?: string | null;
  activeNoteContent?: string | null;
  isDirty?: boolean;
  isSystemNote?: boolean;
  activeTab?: 'view' | 'code' | 'meta';
  sidebarMode?: 'notes' | 'trash' | 'tags';
  authUsername?: string | null;
  authShowLogin?: boolean;
}

function renderHeader(seed?: HeaderSeed) {
  function SeedWrapper() {
    const dispatch = useAppDispatch();
    useEffect(() => {
      if (seed?.activeNoteId) {
        dispatch({
          type: 'NOTE_SELECTED',
          id: seed.activeNoteId,
          content: seed.activeNoteContent ?? '',
          isSystemNote: seed.isSystemNote ?? false,
          noteData: {
            created_at: 1, updated_at: 2,
            current: 'local', created_by: '', updated_by: '',
            meta: {},
          },
        });
      }
      if (seed?.isDirty && seed?.activeNoteId) {
        dispatch({ type: 'NOTE_CONTENT_CHANGED', content: seed.activeNoteContent ?? '' });
      }
      if (seed?.activeTab && seed?.activeTab !== 'view') {
        dispatch({ type: 'SET_ACTIVE_TAB', tab: seed.activeTab });
      }
      if (seed?.sidebarMode) {
        dispatch({ type: 'SET_SIDEBAR_MODE', mode: seed.sidebarMode });
      }
      if (seed?.authUsername) {
        dispatch({ type: 'LOGIN', username: seed.authUsername });
      }
      if (seed?.authShowLogin) {
        dispatch({ type: 'SHOW_LOGIN' });
      }
    }, []);
    return <Header />;
  }

  return renderWithProviders(<SeedWrapper />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset auth mock state
  mockShowLogin.mockClear();
  mockLogout.mockClear();
  mockSaveNote.mockClear();
  mockSetContent.mockClear();
});

/* ========================================================================
   1. File name
   ======================================================================== */

describe('File name', () => {
  it('shows "No file selected" when no note is active', () => {
    renderHeader();
    const fileName = document.getElementById('current-file') as HTMLElement;
    expect(fileName).toBeInTheDocument();
    expect(fileName.textContent).toBe('No file selected');
  });

  it('shows active note ID as file name', () => {
    renderHeader({ activeNoteId: 'my-note.md', activeNoteContent: '# Hello' });
    const fileName = document.getElementById('current-file') as HTMLElement;
    expect(fileName.textContent).toBe('my-note.md');
  });
});

/* ========================================================================
   2. Dirty dot
   ======================================================================== */

describe('Dirty dot', () => {
  it('is NOT visible by default (isDirty=false)', () => {
    renderHeader({ activeNoteId: 'note.md', activeNoteContent: '# Content' });
    const dot = document.getElementById('dirty-dot') as HTMLElement;
    expect(dot).toBeInTheDocument();
    expect(dot.classList.contains('visible')).toBe(false);
  });

  it('has .visible class when isDirty is true', async () => {
    renderHeader({
      activeNoteId: 'note.md',
      activeNoteContent: '# Content',
      isDirty: true,
    });

    await waitFor(() => {
      const dot = document.getElementById('dirty-dot') as HTMLElement;
      expect(dot.classList.contains('visible')).toBe(true);
    });
  });

  it('has title attribute when dirty', async () => {
    renderHeader({
      activeNoteId: 'note.md',
      activeNoteContent: '# Content',
      isDirty: true,
    });

    await waitFor(() => {
      const dot = document.getElementById('dirty-dot') as HTMLElement;
      expect(dot.title).toBe('Changes pending save…');
    });
  });
});

/* ========================================================================
   3. Save button
   ======================================================================== */

describe('Save button', () => {
  it('is disabled when no note is active', () => {
    renderHeader();
    const btn = document.getElementById('btn-save') as HTMLButtonElement;
    expect(btn).toBeInTheDocument();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Save');
  });

  it('is disabled when note is not dirty', () => {
    renderHeader({ activeNoteId: 'note.md', activeNoteContent: '# Hi' });
    const btn = document.getElementById('btn-save') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('is enabled when note is dirty (isDirty=true)', async () => {
    renderHeader({
      activeNoteId: 'note.md',
      activeNoteContent: '# Hi',
      isDirty: true,
    });

    await waitFor(() => {
      const btn = document.getElementById('btn-save') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  it('is disabled for system notes even when dirty', async () => {
    renderHeader({
      activeNoteId: '@todo',
      activeNoteContent: '# System',
      isSystemNote: true,
      isDirty: true,
    });

    await waitFor(() => {
      const btn = document.getElementById('btn-save') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });
});

/* ========================================================================
   4. Sign in / Sign out
   ======================================================================== */

describe('Sign in / Sign out', () => {
  it('shows Sign in button when not logged in (default)', () => {
    renderHeader();
    const signInBtn = document.getElementById('btn-signin') as HTMLButtonElement;
    expect(signInBtn).toBeInTheDocument();
    expect(signInBtn.style.display).not.toBe('none');
  });

  it('hides Sign out button when not logged in', () => {
    renderHeader();
    expect(document.getElementById('btn-logout')).toBeNull();
  });

  it('hides Sign in button when logged in', async () => {
    renderHeader({ authUsername: 'alice' });

    await waitFor(() => {
      expect(document.getElementById('btn-signin')).toBeNull();
    });
  });

  it('shows Sign out button when logged in', async () => {
    renderHeader({ authUsername: 'alice' });

    await waitFor(() => {
      const logoutBtn = document.getElementById('btn-logout') as HTMLButtonElement;
      expect(logoutBtn.style.display).not.toBe('none');
    });
  });

  it('shows username when logged in', async () => {
    renderHeader({ authUsername: 'alice' });

    await waitFor(() => {
      const display = document.getElementById('username-display') as HTMLElement;
      expect(display.textContent).toBe('alice');
    });
  });

  it('shows empty username when not logged in', () => {
    renderHeader();
    const display = document.getElementById('username-display') as HTMLElement;
    expect(display.textContent).toBe('');
  });
});

/* ========================================================================
   5. Brand elements
   ======================================================================== */

describe('Brand elements', () => {
  it('renders sidebar toggle button', () => {
    renderHeader();
    const btn = document.getElementById('btn-toggle-sidebar') as HTMLButtonElement;
    expect(btn).toBeInTheDocument();
    expect(btn.getAttribute('aria-label')).toBe('Toggle sidebar');
  });

  it('renders menu button with brand text', () => {
    renderHeader();
    const menuBtn = document.getElementById('btn-menu') as HTMLButtonElement;
    expect(menuBtn).toBeInTheDocument();
    expect(menuBtn.textContent).toContain('Leaf');
  });
});

/* ========================================================================
   6. Cookmode toggle
   ======================================================================== */

describe('Cookmode toggle', () => {
  it('renders cookmode button with OFF state by default', () => {
    renderHeader();
    const btn = document.getElementById('btn-cookmode') as HTMLButtonElement;
    expect(btn).toBeInTheDocument();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.classList.contains('active')).toBe(false);
  });

  it('has correct aria-label', () => {
    renderHeader();
    const btn = document.getElementById('btn-cookmode');
    expect(btn!.getAttribute('aria-label')).toBe('Toggle cookmode');
  });
});
