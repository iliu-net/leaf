/**
 * D2d — App component tests
 *
 * Tests the root App component: boot sequence (config fetch, note refresh,
 * session restore), auth flow (login shown on 401, not shown when offline),
 * child component wiring, and modal default value construction.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/* ── Hoisted mock variables ─────────────────────────────────────────────── */

const {
  mockOnResizerMouseDown,
  mockLogout,
  mockRestoreSession,
  mockShowLogin,
  mockRefreshList,
  mockCreateNote,
  mockRenameNote,
  mockLoadNote,
  mockHandleConfirm,
  mockHandleCancel,
  mockFetchSpaConfig,
  mockGetSpaConfig,
  mockOnAuthFailure,
  mockInitPwa,
  mockLoadPlugins,
  mockOnlineGetter,
} = vi.hoisted(() => ({
  mockOnResizerMouseDown: vi.fn(),
  mockLogout: vi.fn().mockResolvedValue(undefined),
  mockRestoreSession: vi.fn().mockResolvedValue('ok'),
  mockShowLogin: vi.fn(),
  mockRefreshList: vi.fn().mockResolvedValue([]),
  mockCreateNote: vi.fn().mockResolvedValue(undefined),
  mockRenameNote: vi.fn().mockResolvedValue(undefined),
  mockLoadNote: vi.fn().mockResolvedValue(undefined),
  mockHandleConfirm: vi.fn(),
  mockHandleCancel: vi.fn(),
  mockFetchSpaConfig: vi.fn().mockResolvedValue(undefined),
  mockGetSpaConfig: vi.fn(() => ({})),
  mockOnAuthFailure: vi.fn(() => vi.fn()),
  mockInitPwa: vi.fn().mockResolvedValue(undefined),
  mockLoadPlugins: vi.fn(),
  mockOnlineGetter: vi.fn(() => true),
}));

/* ── Hook mocks ──────────────────────────────────────────────────────────── */

vi.mock('../../src/ts/hooks/useResizer.js', () => ({
  useResizer: () => ({ onMouseDown: mockOnResizerMouseDown }),
}));

vi.mock('../../src/ts/hooks/useAuth.js', () => ({
  useAuth: () => ({
    logout: mockLogout,
    restoreSession: mockRestoreSession,
    showLogin: mockShowLogin,
    login: vi.fn().mockResolvedValue(true),
    dismissLogin: vi.fn(),
    showSignIn: vi.fn(),
    onFailure: vi.fn(),
    getUsername: vi.fn(() => null),
  }),
}));

vi.mock('../../src/ts/hooks/useNotes.js', () => ({
  useNotes: () => ({
    refreshList: mockRefreshList,
    createNote: mockCreateNote,
    renameNote: mockRenameNote,
    loadNote: mockLoadNote,
    setContent: vi.fn(),
    saveNote: vi.fn(),
    deleteNote: vi.fn(),
    fullTextSearch: vi.fn(),
    clearEditor: vi.fn(),
    noteList: [],
    activeNoteId: null,
    activeNoteContent: null,
  }),
}));

vi.mock('../../src/ts/hooks/useChangeBus.js', () => ({
  useChangeBus: vi.fn(),
}));

vi.mock('../../src/ts/hooks/useNoteHistory.js', () => ({
  useNoteHistory: vi.fn(),
}));

vi.mock('../../src/ts/hooks/useHotkeys.js', () => ({
  useHotkeys: vi.fn(),
}));

vi.mock('../../src/ts/hooks/useAutoSave.js', () => ({
  useAutoSave: vi.fn(),
}));

vi.mock('../../src/ts/hooks/useEditTime.js', () => ({
  useEditTime: vi.fn(),
  mergeEditTime: vi.fn((s: string) => s),
  noteEditActivity: vi.fn(),
}));

vi.mock('../../src/ts/hooks/useConfirm.js', () => ({
  useConfirmDialog: () => ({
    handleConfirm: mockHandleConfirm,
    handleCancel: mockHandleCancel,
  }),
}));

/* ── Module mocks ────────────────────────────────────────────────────────── */

vi.mock('../../src/ts/config.js', () => ({
  fetchSpaConfig: mockFetchSpaConfig,
  getSpaConfig: mockGetSpaConfig,
  apiUrl: vi.fn((p: string) => `/api/${p}`),
  getLanguageConfig: vi.fn(() => ({ preferred_langs: ['en'], default_lang: 'en' })),
}));

vi.mock('../../src/ts/auth.js', () => ({
  onAuthFailure: mockOnAuthFailure,
}));

vi.mock('../../src/ts/sync.js', () => ({
  onSyncStatus: vi.fn(() => () => {}),
  syncStart: vi.fn(),
  stopSync: vi.fn(),
  clearRevision: vi.fn(),
  syncNow: vi.fn(),
}));

/* ── Dynamic import mocks ────────────────────────────────────────────────── */

vi.mock('../../src/ts/markdown.js', () => ({
  loadPlugins: mockLoadPlugins,
}));

vi.mock('../../src/ts/pwa.js', () => ({
  initPwa: mockInitPwa,
}));

/* ── Child component mocks ───────────────────────────────────────────────── */

vi.mock('../../src/ts/components/Header.js', () => ({
  default: () => <div data-testid="mock-header">Header</div>,
}));

vi.mock('../../src/ts/components/Sidebar.js', () => ({
  default: ({ onOpenModal, onLogout }: { onOpenModal: (...a: any[]) => void; onLogout: () => void }) => (
    <div data-testid="mock-sidebar">
      <button data-testid="sidebar-open-modal" onClick={() => onOpenModal('create')}>Open Modal</button>
      <button data-testid="sidebar-logout" onClick={onLogout}>Logout</button>
    </div>
  ),
}));

vi.mock('../../src/ts/components/EditorWrap.js', () => ({
  default: () => <div data-testid="mock-editor-wrap">EditorWrap</div>,
}));

vi.mock('../../src/ts/components/StatusBar.js', () => ({
  default: () => <div data-testid="mock-status-bar">StatusBar</div>,
}));

vi.mock('../../src/ts/components/Modal.js', () => ({
  default: ({ open, mode, noteId, defaultValue, onClose, onSubmit }: {
    open: boolean; mode: string; noteId?: string; defaultValue: string;
    onClose: () => void; onSubmit: (val: string) => void;
  }) =>
    open ? (
      <div data-testid="mock-modal" data-mode={mode} data-note-id={noteId ?? ''} data-default-value={defaultValue}>
        <button data-testid="modal-submit" onClick={() => onSubmit('test-note.md')}>Submit</button>
        <button data-testid="modal-close" onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

vi.mock('../../src/ts/components/ConfirmDialog.js', () => ({
  default: () => <div data-testid="mock-confirm-dialog">ConfirmDialog</div>,
}));

vi.mock('../../src/ts/components/LoginScreen.js', () => ({
  default: () => <div data-testid="mock-login-screen">LoginScreen</div>,
}));

vi.mock('../../src/ts/components/Toast.js', () => ({
  default: () => <div data-testid="mock-toast">Toast</div>,
}));

vi.mock('../../src/ts/components/ImageEditor.js', () => ({
  default: () => <div data-testid="mock-image-editor">ImageEditor</div>,
}));

/* ── Imports ─────────────────────────────────────────────────────────────── */

import App from '../../src/ts/components/App.js';

/* ── Setup ───────────────────────────────────────────────────────────────── */

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchSpaConfig.mockResolvedValue(undefined);
  mockGetSpaConfig.mockReturnValue({});
  mockRefreshList.mockResolvedValue([]);
  mockRestoreSession.mockResolvedValue('ok');
  mockOnlineGetter.mockReturnValue(true);
  mockInitPwa.mockResolvedValue(undefined);
  mockLoadPlugins.mockResolvedValue(undefined);
  mockLogout.mockResolvedValue(undefined);
  mockCreateNote.mockResolvedValue(undefined);
  mockRenameNote.mockResolvedValue(undefined);
  mockLoadNote.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: mockOnlineGetter,
  });
});

/* ========================================================================
   1. Smoke test — App renders without crashing
   ======================================================================== */

describe('Smoke test', () => {
  it('renders all child components', () => {
    render(<App />);

    expect(screen.getByTestId('mock-header')).toBeInTheDocument();
    expect(screen.getByTestId('mock-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('mock-editor-wrap')).toBeInTheDocument();
    expect(screen.getByTestId('mock-status-bar')).toBeInTheDocument();
    expect(screen.getByTestId('mock-confirm-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('mock-login-screen')).toBeInTheDocument();
    expect(screen.getByTestId('mock-toast')).toBeInTheDocument();
    expect(screen.getByTestId('mock-image-editor')).toBeInTheDocument();
  });
});

/* ========================================================================
   2. Boot sequence
   ======================================================================== */

describe('Boot sequence', () => {
  it('calls fetchSpaConfig and refreshList on mount', async () => {
    render(<App />);

    await waitFor(() => {
      expect(mockFetchSpaConfig).toHaveBeenCalled();
      expect(mockRefreshList).toHaveBeenCalled();
    });
  });

  it('calls restoreSession after refreshList', async () => {
    render(<App />);

    await waitFor(() => {
      expect(mockRestoreSession).toHaveBeenCalled();
    });
  });

  it('registers auth-failure listener on mount', () => {
    render(<App />);
    expect(mockOnAuthFailure).toHaveBeenCalledWith(mockShowLogin);
  });
});

/* ========================================================================
   3. Auth flow
   ======================================================================== */

describe('Auth flow', () => {
  it('shows login when restoreSession returns auth-failed and online', async () => {
    mockRestoreSession.mockResolvedValue('auth-failed');
    mockOnlineGetter.mockReturnValue(true);

    render(<App />);

    await waitFor(() => {
      expect(mockShowLogin).toHaveBeenCalled();
    });
  });

  it('does NOT show login when restoreSession returns auth-failed but offline', async () => {
    mockRestoreSession.mockResolvedValue('auth-failed');
    mockOnlineGetter.mockReturnValue(false);

    render(<App />);

    // refreshList and restoreSession are called, but showLogin should not be
    await waitFor(() => {
      expect(mockRefreshList).toHaveBeenCalled();
      expect(mockRestoreSession).toHaveBeenCalled();
    });

    expect(mockShowLogin).not.toHaveBeenCalled();
  });

  it('does NOT show login when restoreSession succeeds', async () => {
    mockRestoreSession.mockResolvedValue('ok');

    render(<App />);

    await waitFor(() => {
      expect(mockRestoreSession).toHaveBeenCalled();
    });

    expect(mockShowLogin).not.toHaveBeenCalled();
  });
});

/* ========================================================================
   4. Modal wiring
   ======================================================================== */

describe('Modal wiring', () => {
  it('opens modal when Sidebar fires onOpenModal', async () => {
    render(<App />);

    // Modal should not be visible initially
    expect(screen.queryByTestId('mock-modal')).toBeNull();

    // Click the button in our mocked Sidebar that calls onOpenModal
    screen.getByTestId('sidebar-open-modal').click();

    await waitFor(() => {
      expect(screen.getByTestId('mock-modal')).toBeInTheDocument();
      expect(screen.getByTestId('mock-modal').getAttribute('data-mode')).toBe('create');
    });
  });

  it('closes modal when Modal fires onClose', async () => {
    render(<App />);

    // Open modal first
    screen.getByTestId('sidebar-open-modal').click();
    await waitFor(() => {
      expect(screen.getByTestId('mock-modal')).toBeInTheDocument();
    });

    // Click close button
    screen.getByTestId('modal-close').click();
    await waitFor(() => {
      expect(screen.queryByTestId('mock-modal')).toBeNull();
    });
  });

  it('calls createNote on modal submit in create mode', async () => {
    render(<App />);

    // Open modal
    screen.getByTestId('sidebar-open-modal').click();
    await waitFor(() => {
      expect(screen.getByTestId('mock-modal')).toBeInTheDocument();
    });

    // Submit with value 'test-note.md'
    screen.getByTestId('modal-submit').click();

    await waitFor(() => {
      expect(mockCreateNote).toHaveBeenCalledWith('test-note.md', '');
    });
  });
});

/* ========================================================================
   5. Logout handler
   ======================================================================== */

describe('Logout handler', () => {
  it('calls logout when Sidebar fires onLogout', async () => {
    render(<App />);

    screen.getByTestId('sidebar-logout').click();

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalled();
    });
  });
});
