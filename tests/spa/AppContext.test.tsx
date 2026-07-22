/**
 * C1 — AppContext reducer pure logic tests
 *
 * Tests appReducer() as a pure function.  No React rendering, no DOM,
 * no async, no mocks.  Every action type is covered with edge cases.
 *
 * See docs/plans/c1-appcontext-plan.md for the full test table.
 */

import { describe, it, expect } from 'vitest';
import { appReducer, initialAppState } from '../../src/ts/state/AppContext.js';
import type { AppAction, AppState } from '../../src/ts/state/AppContext.js';

/* ── Sample data factories ─────────────────────────────────────────────── */

const noteMeta = (id: string) =>
  ({ id, created_at: 1, updated_at: 2, current: 'local' as const });

const noteData = {
  created_at: 1,
  updated_at: 2,
  current: 'local' as const,
  created_by: 'user',
  updated_by: 'user',
  meta: {},
};

const trashEntry = (id: string) =>
  ({ id, deleted_at: 100, source: 'local' as const });

/* ========================================================================
   1. initialAppState
   ======================================================================== */

describe('initialAppState', () => {
  it('has all top-level keys', () => {
    const keys = Object.keys(initialAppState).sort();
    const expected = [
      'activeNoteContent', 'activeNoteData', 'activeNoteId', 'activeTab',
      'auth', 'confirmDialog', 'isDirty', 'isOffline', 'isSystemNote',
      'modal', 'notes', 'searchQuery', 'sidebarMode', 'status',
      'syncStatus', 'toasts', 'trash', 'trashPreview',
    ].sort();
    expect(keys).toEqual(expected);
  });

  it('has default notes/editor values', () => {
    expect(initialAppState.notes).toEqual([]);
    expect(initialAppState.activeNoteId).toBeNull();
    expect(initialAppState.activeNoteContent).toBeNull();
    expect(initialAppState.activeNoteData).toBeNull();
    expect(initialAppState.activeTab).toBe('view');
    expect(initialAppState.isDirty).toBe(false);
    expect(initialAppState.isSystemNote).toBe(false);
  });

  it('has default auth values', () => {
    expect(initialAppState.auth.username).toBeNull();
    expect(initialAppState.auth.showLogin).toBe(false);
  });

  it('has default sidebar/modal values', () => {
    expect(initialAppState.sidebarMode).toBe('notes');
    expect(initialAppState.searchQuery).toBe('');
    expect(initialAppState.modal.open).toBe(false);
    expect(initialAppState.modal.mode).toBe('create');
    expect(initialAppState.modal.noteId).toBeUndefined();
  });

  it('has default status/toasts/trash values', () => {
    expect(initialAppState.status).toBe('');
    expect(initialAppState.syncStatus).toBe('');
    expect(initialAppState.toasts).toEqual([]);
    expect(initialAppState.trash).toEqual([]);
    expect(initialAppState.trashPreview).toBeNull();
  });

  it('has default confirmDialog values', () => {
    expect(initialAppState.confirmDialog.open).toBe(false);
    expect(initialAppState.confirmDialog.title).toBe('');
    expect(initialAppState.confirmDialog.message).toBe('');
    expect(initialAppState.confirmDialog.confirmLabel).toBe('Confirm');
    expect(initialAppState.confirmDialog.variant).toBe('default');
  });
});

/* ========================================================================
   2. NOTES_LOADED
   ======================================================================== */

describe('NOTES_LOADED', () => {
  it('populates notes in empty state', () => {
    const notes = [noteMeta('a'), noteMeta('b')];
    const state = appReducer(initialAppState, { type: 'NOTES_LOADED', notes });
    expect(state.notes).toHaveLength(2);
    expect(state.notes[0].id).toBe('a');
    expect(state.notes[1].id).toBe('b');
  });

  it('replaces existing notes', () => {
    const s1 = appReducer(initialAppState, {
      type: 'NOTES_LOADED',
      notes: [noteMeta('old')],
    });
    const s2 = appReducer(s1, {
      type: 'NOTES_LOADED',
      notes: [noteMeta('new')],
    });
    expect(s2.notes).toHaveLength(1);
    expect(s2.notes[0].id).toBe('new');
  });

  it('handles empty array', () => {
    const state = appReducer(initialAppState, {
      type: 'NOTES_LOADED',
      notes: [],
    });
    expect(state.notes).toEqual([]);
  });

  it('preserves other state', () => {
    const s1 = appReducer(initialAppState, {
      type: 'SET_SIDEBAR_MODE',
      mode: 'trash',
    });
    const s2 = appReducer(s1, {
      type: 'NOTES_LOADED',
      notes: [noteMeta('a')],
    });
    expect(s2.sidebarMode).toBe('trash');
  });

  it('does NOT mutate input state', () => {
    const prev = { ...initialAppState, notes: [noteMeta('x')] };
    const result = appReducer(prev, {
      type: 'NOTES_LOADED',
      notes: [noteMeta('y')],
    });
    expect(result).not.toBe(prev);
    expect(result.notes).not.toBe(prev.notes);
    expect(prev.notes[0].id).toBe('x'); // original untouched
  });
});

/* ========================================================================
   3. NOTE_SELECTED
   ======================================================================== */

describe('NOTE_SELECTED', () => {
  const selAction = (overrides?: Partial<Extract<AppAction, { type: 'NOTE_SELECTED' }>>) =>
    ({
      type: 'NOTE_SELECTED' as const,
      id: 'n1',
      content: '# Title\n\nBody',
      isSystemNote: false,
      noteData: { ...noteData },
      ...overrides,
    });

  it('sets id, content, noteData, tab, dirty, systemNote', () => {
    const state = appReducer(initialAppState, selAction());
    expect(state.activeNoteId).toBe('n1');
    expect(state.activeNoteContent).toBe('# Title\n\nBody');
    expect(state.activeNoteData).toEqual(noteData);
    expect(state.activeTab).toBe('view');
    expect(state.isDirty).toBe(false);
    expect(state.isSystemNote).toBe(false);
  });

  it('empty content → code tab', () => {
    const state = appReducer(initialAppState, selAction({ content: '' }));
    expect(state.activeTab).toBe('code');
    expect(state.activeNoteContent).toBe('');
  });

  it('whitespace-only content → code tab', () => {
    const state = appReducer(initialAppState, selAction({ content: '   \t\n  ' }));
    expect(state.activeTab).toBe('code');
  });

  it('system note with content → view tab', () => {
    const state = appReducer(initialAppState, selAction({
      isSystemNote: true,
      content: '# System',
    }));
    expect(state.activeTab).toBe('view');
    expect(state.isSystemNote).toBe(true);
  });

  it('system note with empty content → still view tab', () => {
    const state = appReducer(initialAppState, selAction({
      isSystemNote: true,
      content: '',
    }));
    // System notes never go to code tab, even when empty
    expect(state.activeTab).toBe('view');
  });

  it('preserves noteData values', () => {
    const customData = {
      created_at: 999,
      updated_at: 888,
      current: 'server' as const,
      created_by: 'bob',
      updated_by: 'bob',
      meta: { title: 'Custom' },
    };
    const state = appReducer(initialAppState, selAction({ noteData: customData }));
    expect(state.activeNoteData).toEqual(customData);
  });

  it('accepts null noteData', () => {
    const state = appReducer(initialAppState, selAction({ noteData: null }));
    expect(state.activeNoteData).toBeNull();
  });

  it('overwrites previous selection', () => {
    const s1 = appReducer(initialAppState, selAction({ id: 'first', content: 'old' }));
    const s2 = appReducer(s1, selAction({ id: 'second', content: 'new' }));
    expect(s2.activeNoteId).toBe('second');
    expect(s2.activeNoteContent).toBe('new');
  });

  it('does NOT mutate input state', () => {
    const prev = initialAppState;
    const result = appReducer(prev, selAction());
    expect(result).not.toBe(prev);
  });
});

/* ========================================================================
   4. NOTE_CONTENT_CHANGED
   ======================================================================== */

describe('NOTE_CONTENT_CHANGED', () => {
  it('updates content', () => {
    const state = appReducer(initialAppState, {
      type: 'NOTE_CONTENT_CHANGED',
      content: '# Modified',
    });
    expect(state.activeNoteContent).toBe('# Modified');
  });

  it('sets isDirty = true', () => {
    const state = appReducer(initialAppState, {
      type: 'NOTE_CONTENT_CHANGED',
      content: 'x',
    });
    expect(state.isDirty).toBe(true);
  });

  it('preserves activeNoteId', () => {
    const s1 = appReducer(initialAppState, {
      type: 'NOTE_SELECTED',
      id: 'n1',
      content: '# Hi',
      isSystemNote: false,
      noteData: null,
    });
    const s2 = appReducer(s1, {
      type: 'NOTE_CONTENT_CHANGED',
      content: '# Modified',
    });
    expect(s2.activeNoteId).toBe('n1');
  });
});

/* ========================================================================
   5. NOTE_SAVED
   ======================================================================== */

describe('NOTE_SAVED', () => {
  it('clears isDirty', () => {
    const s1 = appReducer(initialAppState, {
      type: 'NOTE_CONTENT_CHANGED',
      content: 'x',
    });
    expect(s1.isDirty).toBe(true);
    const s2 = appReducer(s1, { type: 'NOTE_SAVED' });
    expect(s2.isDirty).toBe(false);
  });

  it('is a no-op when already clean', () => {
    const state = appReducer(initialAppState, { type: 'NOTE_SAVED' });
    expect(state.isDirty).toBe(false);
  });

  it('does not clear content', () => {
    const s1 = appReducer(initialAppState, {
      type: 'NOTE_CONTENT_CHANGED',
      content: 'retained',
    });
    const s2 = appReducer(s1, { type: 'NOTE_SAVED' });
    expect(s2.activeNoteContent).toBe('retained');
  });
});

/* ========================================================================
   6. CLEAR_EDITOR
   ======================================================================== */

describe('CLEAR_EDITOR', () => {
  it('nullifies all editor fields', () => {
    const state = appReducer(initialAppState, { type: 'CLEAR_EDITOR' });
    expect(state.activeNoteId).toBeNull();
    expect(state.activeNoteContent).toBeNull();
    expect(state.activeNoteData).toBeNull();
    expect(state.isDirty).toBe(false);
    expect(state.isSystemNote).toBe(false);
  });

  it('preserves notes list', () => {
    const s1 = appReducer(initialAppState, {
      type: 'NOTES_LOADED',
      notes: [noteMeta('a')],
    });
    const s2 = appReducer(s1, { type: 'CLEAR_EDITOR' });
    expect(s2.notes).toHaveLength(1);
  });

  it('preserves auth', () => {
    const s1 = appReducer(initialAppState, {
      type: 'LOGIN',
      username: 'alice',
    });
    const s2 = appReducer(s1, { type: 'CLEAR_EDITOR' });
    expect(s2.auth.username).toBe('alice');
  });

  it('clears dirty flag from dirty state', () => {
    const s1 = appReducer(initialAppState, {
      type: 'NOTE_CONTENT_CHANGED',
      content: 'x',
    });
    expect(s1.isDirty).toBe(true);
    const s2 = appReducer(s1, { type: 'CLEAR_EDITOR' });
    expect(s2.isDirty).toBe(false);
  });
});

/* ========================================================================
   7. TRASH_LOADED
   ======================================================================== */

describe('TRASH_LOADED', () => {
  it('populates trash', () => {
    const items = [trashEntry('a'), trashEntry('b')];
    const state = appReducer(initialAppState, { type: 'TRASH_LOADED', trash: items });
    expect(state.trash).toHaveLength(2);
    expect(state.trash[0].id).toBe('a');
  });

  it('replaces existing trash', () => {
    const s1 = appReducer(initialAppState, {
      type: 'TRASH_LOADED',
      trash: [trashEntry('old')],
    });
    const s2 = appReducer(s1, {
      type: 'TRASH_LOADED',
      trash: [trashEntry('new')],
    });
    expect(s2.trash).toHaveLength(1);
    expect(s2.trash[0].id).toBe('new');
  });

  it('handles empty array', () => {
    const state = appReducer(initialAppState, { type: 'TRASH_LOADED', trash: [] });
    expect(state.trash).toEqual([]);
  });

  it('preserves notes list', () => {
    const s1 = appReducer(initialAppState, {
      type: 'NOTES_LOADED',
      notes: [noteMeta('n')],
    });
    const s2 = appReducer(s1, {
      type: 'TRASH_LOADED',
      trash: [trashEntry('t')],
    });
    expect(s2.notes).toHaveLength(1);
  });
});

/* ========================================================================
   8. SHOW_TRASH_PREVIEW / CLEAR_TRASH_PREVIEW
   ======================================================================== */

describe('SHOW_TRASH_PREVIEW', () => {
  const meta = { created_at: 1, updated_at: 2 };

  it('sets all preview fields', () => {
    const state = appReducer(initialAppState, {
      type: 'SHOW_TRASH_PREVIEW',
      id: 't1',
      content: '# Deleted',
      source: 'local',
      meta,
    });
    expect(state.trashPreview).toEqual({ id: 't1', content: '# Deleted', source: 'local', meta });
  });

  it('preserves trash list', () => {
    const s1 = appReducer(initialAppState, {
      type: 'TRASH_LOADED',
      trash: [trashEntry('t1')],
    });
    const s2 = appReducer(s1, {
      type: 'SHOW_TRASH_PREVIEW',
      id: 't1',
      content: 'x',
      source: 'local',
      meta,
    });
    expect(s2.trash).toHaveLength(1);
  });

  it('replaces existing preview', () => {
    const s1 = appReducer(initialAppState, {
      type: 'SHOW_TRASH_PREVIEW',
      id: 'first',
      content: 'old',
      source: 'local',
      meta,
    });
    const s2 = appReducer(s1, {
      type: 'SHOW_TRASH_PREVIEW',
      id: 'second',
      content: 'new',
      source: 'server',
      meta: {},
    });
    expect(s2.trashPreview?.id).toBe('second');
    expect(s2.trashPreview?.source).toBe('server');
  });
});

describe('CLEAR_TRASH_PREVIEW', () => {
  it('sets trashPreview to null', () => {
    const s1 = appReducer(initialAppState, {
      type: 'SHOW_TRASH_PREVIEW',
      id: 'x',
      content: 'y',
      source: 'local',
      meta: {},
    });
    expect(s1.trashPreview).not.toBeNull();
    const s2 = appReducer(s1, { type: 'CLEAR_TRASH_PREVIEW' });
    expect(s2.trashPreview).toBeNull();
  });

  it('is idempotent when already null', () => {
    const state = appReducer(initialAppState, { type: 'CLEAR_TRASH_PREVIEW' });
    expect(state.trashPreview).toBeNull();
  });
});

/* ========================================================================
   9. LOGIN
   ======================================================================== */

describe('LOGIN', () => {
  it('sets username', () => {
    const state = appReducer(initialAppState, { type: 'LOGIN', username: 'alice' });
    expect(state.auth.username).toBe('alice');
  });

  it('hides login dialog', () => {
    const s1 = appReducer(initialAppState, { type: 'SHOW_LOGIN' });
    expect(s1.auth.showLogin).toBe(true);
    const s2 = appReducer(s1, { type: 'LOGIN', username: 'alice' });
    expect(s2.auth.showLogin).toBe(false);
  });

  it('overwrites previous username', () => {
    const s1 = appReducer(initialAppState, { type: 'LOGIN', username: 'alice' });
    const s2 = appReducer(s1, { type: 'LOGIN', username: 'bob' });
    expect(s2.auth.username).toBe('bob');
  });

  it('preserves other state', () => {
    const s1 = appReducer(initialAppState, {
      type: 'SET_SIDEBAR_MODE',
      mode: 'tags',
    });
    const s2 = appReducer(s1, { type: 'LOGIN', username: 'alice' });
    expect(s2.sidebarMode).toBe('tags');
  });
});

/* ========================================================================
   10. LOGOUT
   ======================================================================== */

describe('LOGOUT', () => {
  it('clears username', () => {
    const s1 = appReducer(initialAppState, { type: 'LOGIN', username: 'alice' });
    const s2 = appReducer(s1, { type: 'LOGOUT' });
    expect(s2.auth.username).toBeNull();
  });

  it('hides login dialog', () => {
    const s1 = appReducer(initialAppState, { type: 'SHOW_LOGIN' });
    const s2 = appReducer(s1, { type: 'LOGOUT' });
    expect(s2.auth.showLogin).toBe(false);
  });

  it('clears editor state (5 fields)', () => {
    const s1 = appReducer(initialAppState, {
      type: 'NOTE_SELECTED',
      id: 'n1',
      content: '# Hi',
      isSystemNote: false,
      noteData: { ...noteData },
    });
    const s2 = appReducer(s1, { type: 'NOTE_CONTENT_CHANGED', content: 'dirty' });
    const s3 = appReducer(s2, { type: 'LOGOUT' });
    expect(s3.activeNoteId).toBeNull();
    expect(s3.activeNoteContent).toBeNull();
    expect(s3.activeNoteData).toBeNull();
    expect(s3.isDirty).toBe(false);
    expect(s3.isSystemNote).toBe(false);
  });

  it('preserves notes list', () => {
    const s1 = appReducer(initialAppState, {
      type: 'NOTES_LOADED',
      notes: [noteMeta('a')],
    });
    const s2 = appReducer(s1, { type: 'LOGOUT' });
    expect(s2.notes).toHaveLength(1);
  });

  it('full LOGIN → LOGOUT cycle', () => {
    const s1 = appReducer(initialAppState, { type: 'LOGIN', username: 'alice' });
    expect(s1.auth.username).toBe('alice');
    const s2 = appReducer(s1, { type: 'LOGOUT' });
    expect(s2.auth.username).toBeNull();
    expect(s2.auth.showLogin).toBe(false);
  });
});

/* ========================================================================
   11. SHOW_LOGIN / HIDE_LOGIN
   ======================================================================== */

describe('SHOW_LOGIN', () => {
  it('sets showLogin = true from default', () => {
    const state = appReducer(initialAppState, { type: 'SHOW_LOGIN' });
    expect(state.auth.showLogin).toBe(true);
  });

  it('preserves username', () => {
    const s1 = appReducer(initialAppState, { type: 'LOGIN', username: 'alice' });
    // Login hides the dialog, so re-show it
    const s2 = appReducer(s1, { type: 'SHOW_LOGIN' });
    expect(s2.auth.showLogin).toBe(true);
    expect(s2.auth.username).toBe('alice');
  });
});

describe('HIDE_LOGIN', () => {
  it('sets showLogin = false', () => {
    const s1 = appReducer(initialAppState, { type: 'SHOW_LOGIN' });
    const s2 = appReducer(s1, { type: 'HIDE_LOGIN' });
    expect(s2.auth.showLogin).toBe(false);
  });

  it('preserves username', () => {
    const s1 = appReducer(initialAppState, { type: 'LOGIN', username: 'bob' });
    const s2 = appReducer(s1, { type: 'SHOW_LOGIN' });
    const s3 = appReducer(s2, { type: 'HIDE_LOGIN' });
    expect(s3.auth.showLogin).toBe(false);
    expect(s3.auth.username).toBe('bob');
  });

  it('SHOW → HIDE → returns to original showLogin state', () => {
    const s1 = appReducer(initialAppState, { type: 'SHOW_LOGIN' });
    expect(s1.auth.showLogin).toBe(true);
    const s2 = appReducer(s1, { type: 'HIDE_LOGIN' });
    expect(s2.auth.showLogin).toBe(false);
  });
});

/* ========================================================================
   12. SET_ACTIVE_TAB
   ======================================================================== */

describe('SET_ACTIVE_TAB', () => {
  it('sets tab to code', () => {
    const state = appReducer(initialAppState, { type: 'SET_ACTIVE_TAB', tab: 'code' });
    expect(state.activeTab).toBe('code');
  });

  it('sets tab to meta', () => {
    const state = appReducer(initialAppState, { type: 'SET_ACTIVE_TAB', tab: 'meta' });
    expect(state.activeTab).toBe('meta');
  });

  it('sets tab to view', () => {
    const s1 = appReducer(initialAppState, { type: 'SET_ACTIVE_TAB', tab: 'code' });
    const s2 = appReducer(s1, { type: 'SET_ACTIVE_TAB', tab: 'view' });
    expect(s2.activeTab).toBe('view');
  });

  it('preserves activeNoteId', () => {
    const s1 = appReducer(initialAppState, {
      type: 'NOTE_SELECTED',
      id: 'n1',
      content: '# Hi',
      isSystemNote: false,
      noteData: null,
    });
    const s2 = appReducer(s1, { type: 'SET_ACTIVE_TAB', tab: 'meta' });
    expect(s2.activeNoteId).toBe('n1');
  });
});

/* ========================================================================
   13. SET_SIDEBAR_MODE
   ======================================================================== */

describe('SET_SIDEBAR_MODE', () => {
  it('sets to trash', () => {
    const state = appReducer(initialAppState, { type: 'SET_SIDEBAR_MODE', mode: 'trash' });
    expect(state.sidebarMode).toBe('trash');
  });

  it('sets to tags', () => {
    const state = appReducer(initialAppState, { type: 'SET_SIDEBAR_MODE', mode: 'tags' });
    expect(state.sidebarMode).toBe('tags');
  });

  it('sets to notes', () => {
    const s1 = appReducer(initialAppState, { type: 'SET_SIDEBAR_MODE', mode: 'trash' });
    const s2 = appReducer(s1, { type: 'SET_SIDEBAR_MODE', mode: 'notes' });
    expect(s2.sidebarMode).toBe('notes');
  });

  it('preserves notes list', () => {
    const s1 = appReducer(initialAppState, {
      type: 'NOTES_LOADED',
      notes: [noteMeta('a')],
    });
    const s2 = appReducer(s1, { type: 'SET_SIDEBAR_MODE', mode: 'tags' });
    expect(s2.notes).toHaveLength(1);
  });
});

/* ========================================================================
   14. SET_SEARCH_QUERY
   ======================================================================== */

describe('SET_SEARCH_QUERY', () => {
  it('sets search query', () => {
    const state = appReducer(initialAppState, {
      type: 'SET_SEARCH_QUERY',
      query: 'needle',
    });
    expect(state.searchQuery).toBe('needle');
  });

  it('handles empty string', () => {
    const s1 = appReducer(initialAppState, {
      type: 'SET_SEARCH_QUERY',
      query: 'something',
    });
    const s2 = appReducer(s1, { type: 'SET_SEARCH_QUERY', query: '' });
    expect(s2.searchQuery).toBe('');
  });

  it('overwrites previous query', () => {
    const s1 = appReducer(initialAppState, {
      type: 'SET_SEARCH_QUERY',
      query: 'old',
    });
    const s2 = appReducer(s1, { type: 'SET_SEARCH_QUERY', query: 'new' });
    expect(s2.searchQuery).toBe('new');
  });
});

/* ========================================================================
   15. SET_MODAL
   ======================================================================== */

describe('SET_MODAL', () => {
  it('opens create modal', () => {
    const state = appReducer(initialAppState, {
      type: 'SET_MODAL',
      open: true,
      mode: 'create',
    });
    expect(state.modal.open).toBe(true);
    expect(state.modal.mode).toBe('create');
  });

  it('opens rename modal with noteId', () => {
    const state = appReducer(initialAppState, {
      type: 'SET_MODAL',
      open: true,
      mode: 'rename',
      noteId: 'note-1',
    });
    expect(state.modal.open).toBe(true);
    expect(state.modal.mode).toBe('rename');
    expect(state.modal.noteId).toBe('note-1');
  });

  it('sets searchValue', () => {
    const state = appReducer(initialAppState, {
      type: 'SET_MODAL',
      open: true,
      mode: 'create',
      searchValue: 'prefill',
    });
    expect(state.modal.searchValue).toBe('prefill');
  });

  it('closes modal', () => {
    const s1 = appReducer(initialAppState, {
      type: 'SET_MODAL',
      open: true,
      mode: 'create',
    });
    const s2 = appReducer(s1, {
      type: 'SET_MODAL',
      open: false,
      mode: 'create',
    });
    expect(s2.modal.open).toBe(false);
  });

  it('close: fields not in action become undefined (reducer replaces modal)', () => {
    const s1 = appReducer(initialAppState, {
      type: 'SET_MODAL',
      open: true,
      mode: 'rename',
      noteId: 'n1',
    });
    // Closing without noteId — the reducer builds a fresh modal object
    const s2 = appReducer(s1, {
      type: 'SET_MODAL',
      open: false,
      mode: 'rename',
    });
    expect(s2.modal.open).toBe(false);
    // noteId was NOT passed in the close action → undefined
    expect(s2.modal.noteId).toBeUndefined();
    expect(s2.modal.mode).toBe('rename');
  });

  it('close with noteId preserves it', () => {
    const s1 = appReducer(initialAppState, {
      type: 'SET_MODAL',
      open: true,
      mode: 'rename',
      noteId: 'n1',
    });
    // When the caller passes noteId in the close action, it sticks
    const s2 = appReducer(s1, {
      type: 'SET_MODAL',
      open: false,
      mode: 'rename',
      noteId: 'n1',
    });
    expect(s2.modal.open).toBe(false);
    expect(s2.modal.noteId).toBe('n1');
    expect(s2.modal.mode).toBe('rename');
  });
});

/* ========================================================================
   16. SET_STATUS / SET_OFFLINE / SET_SYNC_STATUS
   ======================================================================== */

describe('SET_STATUS', () => {
  it('sets status text', () => {
    const state = appReducer(initialAppState, { type: 'SET_STATUS', status: 'Saving…' });
    expect(state.status).toBe('Saving…');
  });
});

describe('SET_OFFLINE', () => {
  it('sets isOffline = true', () => {
    const state = appReducer(initialAppState, { type: 'SET_OFFLINE', isOffline: true });
    expect(state.isOffline).toBe(true);
  });

  it('sets isOffline = false', () => {
    const s1 = appReducer(initialAppState, { type: 'SET_OFFLINE', isOffline: true });
    const s2 = appReducer(s1, { type: 'SET_OFFLINE', isOffline: false });
    expect(s2.isOffline).toBe(false);
  });
});

describe('SET_SYNC_STATUS', () => {
  it('sets sync status', () => {
    const state = appReducer(initialAppState, {
      type: 'SET_SYNC_STATUS',
      status: 'Syncing…',
    });
    expect(state.syncStatus).toBe('Syncing…');
  });
});

describe('Status fields — combined', () => {
  it('all three can be set independently', () => {
    let s = appReducer(initialAppState, { type: 'SET_STATUS', status: 'Ready' });
    s = appReducer(s, { type: 'SET_OFFLINE', isOffline: true });
    s = appReducer(s, { type: 'SET_SYNC_STATUS', status: 'Offline' });
    expect(s.status).toBe('Ready');
    expect(s.isOffline).toBe(true);
    expect(s.syncStatus).toBe('Offline');
  });
});

/* ========================================================================
   17. ADD_TOAST
   ======================================================================== */

describe('ADD_TOAST', () => {
  it('adds a toast', () => {
    const state = appReducer(initialAppState, {
      type: 'ADD_TOAST',
      id: 't1',
      message: 'Saved!',
    });
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0].id).toBe('t1');
    expect(state.toasts[0].message).toBe('Saved!');
  });

  it('appends to existing toasts', () => {
    const s1 = appReducer(initialAppState, {
      type: 'ADD_TOAST',
      id: 'a',
      message: 'First',
    });
    const s2 = appReducer(s1, {
      type: 'ADD_TOAST',
      id: 'b',
      message: 'Second',
    });
    expect(s2.toasts).toHaveLength(2);
    expect(s2.toasts[0].id).toBe('a');
    expect(s2.toasts[1].id).toBe('b');
  });

  it('deduplicates by id — same id returns same state reference', () => {
    const s1 = appReducer(initialAppState, {
      type: 'ADD_TOAST',
      id: 'dup',
      message: 'First',
    });
    const s2 = appReducer(s1, {
      type: 'ADD_TOAST',
      id: 'dup',
      message: 'Second attempt',
    });
    // Dedup returns the exact same state object
    expect(s2).toBe(s1);
    expect(s2.toasts).toHaveLength(1);
    expect(s2.toasts[0].message).toBe('First'); // original preserved
  });

  it('dedup does not affect different-id toasts', () => {
    const s1 = appReducer(initialAppState, {
      type: 'ADD_TOAST',
      id: 'a',
      message: 'First',
    });
    const s2 = appReducer(s1, {
      type: 'ADD_TOAST',
      id: 'b',
      message: 'Different id — not dup',
    });
    expect(s2.toasts).toHaveLength(2);
    // Still deduplicates if we try a again
    const s3 = appReducer(s2, {
      type: 'ADD_TOAST',
      id: 'a',
      message: 'Duplicate of first',
    });
    expect(s3).toBe(s2); // unchanged
  });

  it('preserves isError flag', () => {
    const state = appReducer(initialAppState, {
      type: 'ADD_TOAST',
      id: 'err',
      message: 'Failed',
      isError: true,
    });
    expect(state.toasts[0].isError).toBe(true);
  });

  it('isError defaults to undefined', () => {
    const state = appReducer(initialAppState, {
      type: 'ADD_TOAST',
      id: 't',
      message: 'ok',
    });
    expect(state.toasts[0].isError).toBeUndefined();
  });
});

/* ========================================================================
   18. REMOVE_TOAST
   ======================================================================== */

describe('REMOVE_TOAST', () => {
  function stateWithToasts(...ids: string[]): AppState {
    return ids.reduce(
      (s, id) => appReducer(s, { type: 'ADD_TOAST', id, message: `msg-${id}` }),
      initialAppState,
    );
  }

  it('removes matching toast', () => {
    const s1 = stateWithToasts('a', 'b', 'c');
    const s2 = appReducer(s1, { type: 'REMOVE_TOAST', id: 'b' });
    expect(s2.toasts).toHaveLength(2);
    expect(s2.toasts.map(t => t.id)).toEqual(['a', 'c']);
  });

  it('only removes one toast', () => {
    const s1 = stateWithToasts('x', 'y', 'z');
    const s2 = appReducer(s1, { type: 'REMOVE_TOAST', id: 'y' });
    expect(s2.toasts).toHaveLength(2);
  });

  it('non-existent id — toasts unchanged content-wise', () => {
    const s1 = stateWithToasts('a', 'b');
    const s2 = appReducer(s1, { type: 'REMOVE_TOAST', id: 'nope' });
    expect(s2.toasts.map(t => t.id)).toEqual(['a', 'b']);
  });

  it('preserves other state', () => {
    const s1 = stateWithToasts('a');
    const s2 = appReducer(s1, { type: 'NOTES_LOADED', notes: [noteMeta('n')] });
    const s3 = appReducer(s2, { type: 'REMOVE_TOAST', id: 'a' });
    expect(s3.notes).toHaveLength(1);
    expect(s3.toasts).toHaveLength(0);
  });
});

/* ========================================================================
   19. SHOW_CONFIRM / HIDE_CONFIRM
   ======================================================================== */

describe('SHOW_CONFIRM', () => {
  it('opens confirm dialog with all fields', () => {
    const state = appReducer(initialAppState, {
      type: 'SHOW_CONFIRM',
      title: 'Delete?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    expect(state.confirmDialog.open).toBe(true);
    expect(state.confirmDialog.title).toBe('Delete?');
    expect(state.confirmDialog.message).toBe('This cannot be undone.');
    expect(state.confirmDialog.confirmLabel).toBe('Delete');
    expect(state.confirmDialog.variant).toBe('danger');
  });

  it('default variant', () => {
    const state = appReducer(initialAppState, {
      type: 'SHOW_CONFIRM',
      title: 'Save?',
      message: 'Save changes?',
      confirmLabel: 'Save',
      variant: 'default',
    });
    expect(state.confirmDialog.variant).toBe('default');
  });
});

describe('HIDE_CONFIRM', () => {
  it('sets open = false', () => {
    const s1 = appReducer(initialAppState, {
      type: 'SHOW_CONFIRM',
      title: 'T',
      message: 'M',
      confirmLabel: 'OK',
      variant: 'default',
    });
    const s2 = appReducer(s1, { type: 'HIDE_CONFIRM' });
    expect(s2.confirmDialog.open).toBe(false);
  });

  it('preserves other dialog fields', () => {
    const s1 = appReducer(initialAppState, {
      type: 'SHOW_CONFIRM',
      title: 'Delete note',
      message: 'Really?',
      confirmLabel: 'Yes',
      variant: 'danger',
    });
    const s2 = appReducer(s1, { type: 'HIDE_CONFIRM' });
    expect(s2.confirmDialog.open).toBe(false);
    expect(s2.confirmDialog.title).toBe('Delete note');
    expect(s2.confirmDialog.message).toBe('Really?');
    expect(s2.confirmDialog.variant).toBe('danger');
  });
});

describe('Confirm dialog — full cycle', () => {
  it('SHOW → HIDE → SHOW with different values', () => {
    const s1 = appReducer(initialAppState, {
      type: 'SHOW_CONFIRM',
      title: 'First',
      message: 'M1',
      confirmLabel: 'OK',
      variant: 'default',
    });
    const s2 = appReducer(s1, { type: 'HIDE_CONFIRM' });
    const s3 = appReducer(s2, {
      type: 'SHOW_CONFIRM',
      title: 'Second',
      message: 'M2',
      confirmLabel: 'Go',
      variant: 'danger',
    });
    expect(s3.confirmDialog.open).toBe(true);
    expect(s3.confirmDialog.title).toBe('Second');
    expect(s3.confirmDialog.message).toBe('M2');
    expect(s3.confirmDialog.variant).toBe('danger');
  });
});

/* ========================================================================
   20. Unknown action
   ======================================================================== */

describe('Unknown action', () => {
  it('returns the same state reference', () => {
    const state = initialAppState;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = appReducer(state, { type: 'NONEXISTENT' } as any);
    expect(result).toBe(state);
  });

  it('returns same reference even with extra action props', () => {
    const state = initialAppState;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = appReducer(state, { type: 'UNKNOWN', data: 42 } as any);
    expect(result).toBe(state);
  });
});

/* ========================================================================
   21. Immutability — general
   ======================================================================== */

describe('Immutability', () => {
  it('every action type returns a new object (from initial state)', () => {
    const actions: { name: string; action: AppAction }[] = [
      { name: 'NOTES_LOADED',         action: { type: 'NOTES_LOADED', notes: [] } },
      { name: 'NOTE_SELECTED',        action: { type: 'NOTE_SELECTED', id: 'n', content: 'x', isSystemNote: false, noteData: null } },
      { name: 'NOTE_CONTENT_CHANGED', action: { type: 'NOTE_CONTENT_CHANGED', content: 'x' } },
      { name: 'NOTE_SAVED',           action: { type: 'NOTE_SAVED' } },
      { name: 'CLEAR_EDITOR',         action: { type: 'CLEAR_EDITOR' } },
      { name: 'TRASH_LOADED',         action: { type: 'TRASH_LOADED', trash: [] } },
      { name: 'SHOW_TRASH_PREVIEW',   action: { type: 'SHOW_TRASH_PREVIEW', id: 't', content: 'c', source: 'local', meta: {} } },
      { name: 'CLEAR_TRASH_PREVIEW',  action: { type: 'CLEAR_TRASH_PREVIEW' } },
      { name: 'LOGIN',                action: { type: 'LOGIN', username: 'u' } },
      { name: 'LOGOUT',               action: { type: 'LOGOUT' } },
      { name: 'SHOW_LOGIN',           action: { type: 'SHOW_LOGIN' } },
      { name: 'HIDE_LOGIN',           action: { type: 'HIDE_LOGIN' } },
      { name: 'SET_ACTIVE_TAB',       action: { type: 'SET_ACTIVE_TAB', tab: 'code' } },
      { name: 'SET_SIDEBAR_MODE',     action: { type: 'SET_SIDEBAR_MODE', mode: 'trash' } },
      { name: 'SET_SEARCH_QUERY',     action: { type: 'SET_SEARCH_QUERY', query: 'q' } },
      { name: 'SET_MODAL',            action: { type: 'SET_MODAL', open: true, mode: 'create' } },
      { name: 'SET_STATUS',           action: { type: 'SET_STATUS', status: 's' } },
      { name: 'SET_OFFLINE',          action: { type: 'SET_OFFLINE', isOffline: true } },
      { name: 'SET_SYNC_STATUS',      action: { type: 'SET_SYNC_STATUS', status: 's' } },
      { name: 'ADD_TOAST',            action: { type: 'ADD_TOAST', id: 'fresh', message: 'm' } },
      { name: 'REMOVE_TOAST',         action: { type: 'REMOVE_TOAST', id: 'nonexistent' } },
      { name: 'SHOW_CONFIRM',         action: { type: 'SHOW_CONFIRM', title: 'T', message: 'M', confirmLabel: 'OK', variant: 'default' } },
      { name: 'HIDE_CONFIRM',         action: { type: 'HIDE_CONFIRM' } },
    ];

    for (const { name, action } of actions) {
      const result = appReducer(initialAppState, action);
      expect(result, `${name} must return a new object`).not.toBe(initialAppState);
    }
  });

  it('nested objects are new references', () => {
    const s1 = appReducer(initialAppState, { type: 'LOGIN', username: 'alice' });
    expect(s1.auth).not.toBe(initialAppState.auth);

    const s2 = appReducer(initialAppState, {
      type: 'SET_MODAL',
      open: true,
      mode: 'create',
    });
    expect(s2.modal).not.toBe(initialAppState.modal);

    const s3 = appReducer(initialAppState, {
      type: 'SHOW_CONFIRM',
      title: 'T',
      message: 'M',
      confirmLabel: 'OK',
      variant: 'default',
    });
    expect(s3.confirmDialog).not.toBe(initialAppState.confirmDialog);
  });

  it('nested arrays are new references', () => {
    const s1 = appReducer(initialAppState, {
      type: 'ADD_TOAST',
      id: 't1',
      message: 'm',
    });
    expect(s1.toasts).not.toBe(initialAppState.toasts);

    const s2 = appReducer(initialAppState, {
      type: 'NOTES_LOADED',
      notes: [noteMeta('a')],
    });
    expect(s2.notes).not.toBe(initialAppState.notes);
  });
});

/* ========================================================================
   22. Composition — multi-action sequences
   ======================================================================== */

describe('Composition', () => {
  it('full note lifecycle', () => {
    let s = appReducer(initialAppState, {
      type: 'NOTES_LOADED',
      notes: [noteMeta('n1')],
    });
    // Select a note
    s = appReducer(s, {
      type: 'NOTE_SELECTED',
      id: 'n1',
      content: '# Hello World',
      isSystemNote: false,
      noteData: { ...noteData },
    });
    expect(s.activeNoteId).toBe('n1');
    expect(s.activeTab).toBe('view');
    expect(s.isDirty).toBe(false);

    // Edit content
    s = appReducer(s, { type: 'NOTE_CONTENT_CHANGED', content: '# Modified' });
    expect(s.activeNoteContent).toBe('# Modified');
    expect(s.isDirty).toBe(true);

    // Save
    s = appReducer(s, { type: 'NOTE_SAVED' });
    expect(s.isDirty).toBe(false);
    expect(s.activeNoteContent).toBe('# Modified');

    // Clear editor
    s = appReducer(s, { type: 'CLEAR_EDITOR' });
    expect(s.activeNoteId).toBeNull();
    expect(s.activeNoteContent).toBeNull();
    expect(s.notes).toHaveLength(1); // notes list preserved
  });

  it('auth + editor interaction — LOGOUT clears editor', () => {
    let s = appReducer(initialAppState, { type: 'LOGIN', username: 'alice' });
    s = appReducer(s, {
      type: 'NOTE_SELECTED',
      id: 'n1',
      content: '# Secret',
      isSystemNote: false,
      noteData: null,
    });
    s = appReducer(s, { type: 'NOTE_CONTENT_CHANGED', content: 'dirty' });
    expect(s.auth.username).toBe('alice');
    expect(s.activeNoteId).toBe('n1');
    expect(s.isDirty).toBe(true);

    s = appReducer(s, { type: 'LOGOUT' });
    expect(s.auth.username).toBeNull();
    expect(s.auth.showLogin).toBe(false);
    expect(s.activeNoteId).toBeNull();
    expect(s.activeNoteContent).toBeNull();
    expect(s.isDirty).toBe(false);
  });

  it('toast lifecycle', () => {
    let s = appReducer(initialAppState, { type: 'ADD_TOAST', id: 'a', message: 'First' });
    s = appReducer(s, { type: 'ADD_TOAST', id: 'b', message: 'Second' });
    expect(s.toasts).toHaveLength(2);

    s = appReducer(s, { type: 'REMOVE_TOAST', id: 'a' });
    expect(s.toasts).toHaveLength(1);
    expect(s.toasts[0].id).toBe('b');

    s = appReducer(s, { type: 'REMOVE_TOAST', id: 'b' });
    expect(s.toasts).toHaveLength(0);
  });
});
