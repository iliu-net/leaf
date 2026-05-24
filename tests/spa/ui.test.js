/**
 * Tests for spa/js/ui.js — DOM rendering & interaction layer.
 *
 * Uses vitest's built-in jsdom environment — no need to create a JSDOM instance.
 * We just set document.body.innerHTML before importing the module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── DOM setup — inject HTML that ui.js references ─────────────────────────

function setupDOM() {
  document.body.innerHTML = `
    <!-- Login screen -->
    <div id="login-screen">
      <div id="login-card">
        <form id="login-form">
          <input id="login-username" type="text">
          <input id="login-password" type="password">
          <p id="login-error"></p>
          <button id="login-btn" type="submit">Sign in</button>
        </form>
      </div>
    </div>

    <!-- App shell -->
    <div id="app">
      <header id="header">
        <div id="header-center">
          <span id="current-file">No file selected</span>
          <div id="dirty-dot"></div>
        </div>
        <div id="header-actions">
          <span id="username-display"></span>
          <button id="btn-save" disabled>Save</button>
          <button id="btn-logout">Sign out</button>
        </div>
      </header>

      <div id="main">
        <aside id="sidebar">
          <div id="sidebar-toolbar">
            <input id="search" type="search">
            <button id="btn-new">New</button>
          </div>
          <div id="file-list" role="list"></div>
          <div id="sidebar-loading" style="display:none">
            <span>Syncing notes…</span>
          </div>
          <div id="sidebar-footer">
            <span id="note-count">0 notes</span>
          </div>
        </aside>

        <main id="editor-wrap">
          <div id="empty-state">
            <p>Select a note or create a new one</p>
          </div>
          <textarea id="note-area"></textarea>
        </main>
      </div>

      <div id="statusbar">
        <span id="status-msg"></span>
        <span id="offline-badge" class="status-item"></span>
        <span id="sync-status" class="status-item"></span>
        <span id="line-count" class="status-item"></span>
        <span id="char-count" class="status-item"></span>
      </div>
    </div>

    <!-- Modal -->
    <div id="modal-overlay">
      <div id="modal">
        <h2 id="modal-title">New note</h2>
        <input id="modal-input" type="text">
        <p id="modal-hint"></p>
        <button id="modal-cancel">Cancel</button>
        <button id="modal-create">Create</button>
      </div>
    </div>

    <!-- Toast container -->
    <div id="toast-container"></div>
  `;
}

beforeEach(() => {
  setupDOM();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

// ── Import (after DOM is ready) ─────────────────────────────────────────────

async function getUI() {
  // Need to reset module so it re-reads DOM elements
  vi.resetModules();
  return await import('../../spa/js/ui.js');
}

// ── File list ───────────────────────────────────────────────────────────────

describe('renderFileList()', () => {
  it('renders notes in the file list', async () => {
    const ui = await getUI();
    const notes = [
      { id: 'alpha', created_at: 1, updated_at: 2 },
      { id: 'beta',  created_at: 3, updated_at: 4 },
    ];

    ui.renderFileList(notes, null);

    const items = document.querySelectorAll('.file-item');
    expect(items).toHaveLength(2);
    expect(items[0].dataset.id).toBe('alpha');
    expect(items[1].dataset.id).toBe('beta');
  });

  it('highlights the active note', async () => {
    const ui = await getUI();
    const notes = [
      { id: 'a', created_at: 1, updated_at: 2 },
      { id: 'b', created_at: 3, updated_at: 4 },
    ];

    ui.renderFileList(notes, 'b');

    const items = document.querySelectorAll('.file-item');
    expect(items[0].classList.contains('active')).toBe(false);
    expect(items[1].classList.contains('active')).toBe(true);
  });

  it('shows empty state when no notes', async () => {
    const ui = await getUI();
    ui.renderFileList([], null);

    const item = document.querySelector('#file-list > div');
    expect(item.textContent).toBe('No notes found');
  });

  it('renders rename and delete buttons', async () => {
    const ui = await getUI();
    ui.renderFileList([{ id: 'test', created_at: 1, updated_at: 2 }], null);

    const renameBtn = document.querySelector('.file-item-rename');
    const delBtn = document.querySelector('.file-item-del');
    expect(renameBtn).not.toBeNull();
    expect(delBtn).not.toBeNull();
  });
});

describe('setActiveFile()', () => {
  it('toggles the active class', async () => {
    const ui = await getUI();
    ui.renderFileList([
      { id: 'a', created_at: 1, updated_at: 2 },
      { id: 'b', created_at: 3, updated_at: 4 },
    ], 'a');

    ui.setActiveFile('b');
    const items = document.querySelectorAll('.file-item');
    expect(items[0].classList.contains('active')).toBe(false);
    expect(items[1].classList.contains('active')).toBe(true);
  });
});

describe('updateNoteCount()', () => {
  it('shows total when all shown', async () => {
    const ui = await getUI();
    ui.updateNoteCount(3, 3);
    expect(document.getElementById('note-count').textContent).toBe('3 notes');
  });

  it('shows filtered count when filtered', async () => {
    const ui = await getUI();
    ui.updateNoteCount(10, 3);
    expect(document.getElementById('note-count').textContent).toBe('3 / 10');
  });

  it('handles singular', async () => {
    const ui = await getUI();
    ui.updateNoteCount(1, 1);
    expect(document.getElementById('note-count').textContent).toBe('1 note');
  });
});

describe('setSidebarLoading()', () => {
  it('shows and hides the loading indicator', async () => {
    const ui = await getUI();
    const el = document.getElementById('sidebar-loading');

    ui.setSidebarLoading(true);
    expect(el.style.display).toBe('flex');

    ui.setSidebarLoading(false);
    expect(el.style.display).toBe('none');
  });
});

// ── Editor ──────────────────────────────────────────────────────────────────

describe('showEditor() / hideEditor()', () => {
  it('shows editor with content', async () => {
    const ui = await getUI();
    ui.showEditor('my-note', 'Hello World');

    const noteArea = document.getElementById('note-area');
    const emptyState = document.getElementById('empty-state');
    const currentFile = document.getElementById('current-file');

    expect(noteArea.style.display).toBe('block');
    expect(noteArea.value).toBe('Hello World');
    expect(emptyState.style.display).toBe('none');
    expect(currentFile.innerHTML).toContain('my-note');
  });

  it('hides editor and shows empty state', async () => {
    const ui = await getUI();
    ui.hideEditor();

    const noteArea = document.getElementById('note-area');
    const emptyState = document.getElementById('empty-state');

    expect(noteArea.style.display).toBe('none');
    expect(emptyState.style.display).toBe('flex');
    expect(document.getElementById('current-file').textContent).toBe('No file selected');
  });

  it('getEditorContent returns textarea value', async () => {
    const ui = await getUI();
    document.getElementById('note-area').value = 'typed content';
    expect(ui.getEditorContent()).toBe('typed content');
  });
});

describe('setDirty()', () => {
  it('toggles dirty dot and save button', async () => {
    const ui = await getUI();
    const dirtyDot = document.getElementById('dirty-dot');
    const btnSave = document.getElementById('btn-save');

    ui.setDirty(true);
    expect(dirtyDot.classList.contains('visible')).toBe(true);
    expect(btnSave.disabled).toBe(false);

    ui.setDirty(false);
    expect(dirtyDot.classList.contains('visible')).toBe(false);
    expect(btnSave.disabled).toBe(true);
  });
});

// ── Status bar ──────────────────────────────────────────────────────────────

describe('setStatus()', () => {
  it('sets status message', async () => {
    const ui = await getUI();
    ui.setStatus('All good');
    expect(document.getElementById('status-msg').textContent).toBe('All good');
  });

  it('clears status after timeout', async () => {
    const ui = await getUI();
    vi.useFakeTimers();

    ui.setStatus('Temporary', 100);
    expect(document.getElementById('status-msg').textContent).toBe('Temporary');

    vi.advanceTimersByTime(150);
    expect(document.getElementById('status-msg').textContent).toBe('');

    vi.useRealTimers();
  });
});

describe('setOffline()', () => {
  it('toggles offline badge', async () => {
    const ui = await getUI();
    const badge = document.getElementById('offline-badge');

    ui.setOffline(true);
    expect(badge.classList.contains('visible')).toBe(true);

    ui.setOffline(false);
    expect(badge.classList.contains('visible')).toBe(false);
  });
});

describe('setSyncStatus()', () => {
  it('shows lowercase status text', async () => {
    const ui = await getUI();
    const el = document.getElementById('sync-status');

    ui.setSyncStatus('SYNCING');
    expect(el.textContent).toBe('syncing');

    ui.setSyncStatus('IDLE');
    expect(el.textContent).toBe('idle');

    ui.setSyncStatus('ONLINE');
    expect(el.textContent).toBe('');
  });
});

// ── Toast ───────────────────────────────────────────────────────────────────

describe('toast()', () => {
  it('adds a toast message to the container', async () => {
    const ui = await getUI();
    const cont = document.getElementById('toast-container');

    ui.toast('Hello');
    expect(cont.children).toHaveLength(1);
    expect(cont.children[0].textContent).toBe('Hello');
    expect(cont.children[0].className).toBe('toast');
  });

  it('adds error class for error toasts', async () => {
    const ui = await getUI();
    const cont = document.getElementById('toast-container');

    ui.toast('Error!', true);
    expect(cont.children[0].className).toBe('toast err');
  });

  it('removes toast after timeout', async () => {
    const ui = await getUI();
    vi.useFakeTimers();

    ui.toast('Temp');
    expect(document.getElementById('toast-container').children).toHaveLength(1);

    vi.advanceTimersByTime(4000);
    expect(document.getElementById('toast-container').children).toHaveLength(0);

    vi.useRealTimers();
  });
});

// ── Modal ───────────────────────────────────────────────────────────────────

describe('modal operations', () => {
  it('openModal shows the modal in create mode', async () => {
    const ui = await getUI();
    const overlay = document.getElementById('modal-overlay');
    const input = document.getElementById('modal-input');

    ui.openModal();

    expect(overlay.classList.contains('open')).toBe(true);
    expect(document.getElementById('modal-title').textContent).toBe('New note');
    expect(document.getElementById('modal-create').textContent).toBe('Create');
    expect(input.value).toBe('');
  });

  it('openRenameModal shows the modal in rename mode', async () => {
    const ui = await getUI();
    const input = document.getElementById('modal-input');

    ui.openRenameModal('old-note-name');

    expect(document.getElementById('modal-title').textContent).toBe('Rename note');
    expect(document.getElementById('modal-create').textContent).toBe('Rename');
    expect(input.value).toBe('old-note-name');
  });

  it('closeModal hides the modal', async () => {
    const ui = await getUI();
    ui.openModal();
    ui.closeModal();

    const overlay = document.getElementById('modal-overlay');
    expect(overlay.classList.contains('open')).toBe(false);
  });

  it('getModalValue returns trimmed input', async () => {
    const ui = await getUI();
    document.getElementById('modal-input').value = '  my value  ';
    expect(ui.getModalValue()).toBe('my value');
  });

  it('setModalError shows error message', async () => {
    const ui = await getUI();
    const hint = document.getElementById('modal-hint');

    ui.setModalError('Something went wrong');
    expect(hint.textContent).toBe('Something went wrong');
    expect(hint.className).toContain('err');
  });

  it('setModalHint shows hint message', async () => {
    const ui = await getUI();
    const hint = document.getElementById('modal-hint');

    ui.setModalHint('Will be saved as: my-note');
    expect(hint.textContent).toBe('Will be saved as: my-note');
    expect(hint.className).not.toContain('err');
  });
});

// ── Login screen ────────────────────────────────────────────────────────────

describe('login screen', () => {
  it('showLoginScreen shows login and hides app', async () => {
    const ui = await getUI();
    const loginScreen = document.getElementById('login-screen');
    const appShell = document.getElementById('app');

    appShell.style.display = 'flex';
    loginScreen.style.display = 'none';

    ui.showLoginScreen();
    expect(loginScreen.style.display).toBe('flex');
    expect(appShell.style.display).toBe('none');
  });

  it('showAppShell shows app and hides login', async () => {
    const ui = await getUI();
    const loginScreen = document.getElementById('login-screen');
    const appShell = document.getElementById('app');

    ui.showAppShell('alice');
    expect(loginScreen.style.display).toBe('none');
    expect(appShell.style.display).toBe('flex');
    expect(document.getElementById('username-display').textContent).toBe('alice');
  });

  it('setLoginError sets error text', async () => {
    const ui = await getUI();
    ui.setLoginError('Invalid password');
    expect(document.getElementById('login-error').textContent).toBe('Invalid password');
  });

  it('setLoginLoading toggles button state', async () => {
    const ui = await getUI();
    const btn = document.getElementById('login-btn');

    ui.setLoginLoading(true);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Signing in…');

    ui.setLoginLoading(false);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Sign in');
  });
});

// ── Event wiring ────────────────────────────────────────────────────────────

describe('bindEvents()', () => {
  it('wires login form submit', async () => {
    const ui = await getUI();
    const onLogin = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin, onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
    });

    document.getElementById('login-username').value = 'alice';
    document.getElementById('login-password').value = 'secret';

    const form = document.getElementById('login-form');
    form.dispatchEvent(new Event('submit'));

    expect(onLogin).toHaveBeenCalledWith('alice', 'secret');
  });

  it('wires logout button', async () => {
    const ui = await getUI();
    const onLogout = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout,
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
    });

    document.getElementById('btn-logout').click();
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('wires file list click delegation for open', async () => {
    const ui = await getUI();
    const onOpen = vi.fn();

    ui.bindEvents({
      onOpen, onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
    });

    ui.renderFileList([{ id: 'my-note', created_at: 1, updated_at: 2 }], null);

    const item = document.querySelector('.file-item');
    item.click();
    expect(onOpen).toHaveBeenCalledWith('my-note');
  });

  it('wires file list delete button', async () => {
    const ui = await getUI();
    const onDelete = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete, onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
    });

    ui.renderFileList([{ id: 'doomed', created_at: 1, updated_at: 2 }], null);

    const delBtn = document.querySelector('.file-item-del');
    delBtn.click();
    expect(onDelete).toHaveBeenCalledWith('doomed');
  });

  it('wires file list rename button', async () => {
    const ui = await getUI();
    const onRename = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename, onRenameConfirm: vi.fn(),
    });

    ui.renderFileList([{ id: 'rename-me', created_at: 1, updated_at: 2 }], null);

    const renameBtn = document.querySelector('.file-item-rename');
    renameBtn.click();
    expect(onRename).toHaveBeenCalledWith('rename-me');
  });

  it('wires search input', async () => {
    const ui = await getUI();
    const onSearch = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch,
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
    });

    const searchInput = document.getElementById('search');
    searchInput.value = 'test';
    searchInput.dispatchEvent(new Event('input'));

    expect(onSearch).toHaveBeenCalledWith('test');
  });

  it('wires save button', async () => {
    const ui = await getUI();
    const onSave = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave, onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
    });

    // btn-save starts disabled — enable it so click fires
    document.getElementById('btn-save').disabled = false;
    document.getElementById('btn-save').click();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('wires new button', async () => {
    const ui = await getUI();
    const onNew = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew, onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
    });

    document.getElementById('btn-new').click();
    expect(onNew).toHaveBeenCalledOnce();
  });

  it('wires modal create button (create mode)', async () => {
    const ui = await getUI();
    const onCreate = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate,
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
    });

    document.getElementById('modal-create').click();
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('wires modal cancel button', async () => {
    const ui = await getUI();
    const onCancelModal = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal, onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
    });

    document.getElementById('modal-cancel').click();
    expect(onCancelModal).toHaveBeenCalledOnce();
  });

  it('wires keyboard shortcut Ctrl+S for save', async () => {
    const ui = await getUI();
    const onSave = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave, onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('wires shortcut Cmd+S for save on Mac', async () => {
    const ui = await getUI();
    const onSave = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave, onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('wires Escape to close modal', async () => {
    const ui = await getUI();
    const onCancelModal = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal, onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
    });

    // Open the modal first
    ui.openModal();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCancelModal).toHaveBeenCalledOnce();
  });

  it('wires modal Enter key for create', async () => {
    const ui = await getUI();
    const onCreate = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate,
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
    });

    const input = document.getElementById('modal-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('wires modal Enter key for rename', async () => {
    const ui = await getUI();
    const onRenameConfirm = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm,
    });

    // Open in rename mode first
    ui.openRenameModal('old-name');

    const input = document.getElementById('modal-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onRenameConfirm).toHaveBeenCalledWith('old-name');
  });

  it('wires beforeunload guard when dirty', async () => {
    const ui = await getUI();
    const preventDefault = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
    });

    // Show editor and mark dirty
    ui.showEditor('test', 'content');
    ui.setDirty(true);

    const event = new Event('beforeunload');
    event.preventDefault = preventDefault;
    window.dispatchEvent(event);

    expect(preventDefault).toHaveBeenCalled();
  });
});
