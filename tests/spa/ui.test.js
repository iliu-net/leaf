/**
 * Tests for src/ts/ui.ts — DOM rendering & interaction layer.
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
        <button id="login-close" class="btn-icon">×</button>
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
        <div id="header-brand">
          <button id="btn-toggle-sidebar" class="btn-icon">◀</button>
          <button id="btn-menu">Leaf</button>
          <div id="app-menu">
            <button id="menu-folder"><span class="dropdown-check">✓</span> Folder</button>
            <button id="menu-trash"><span class="dropdown-check">✓</span> Trash</button>
            <div class="dropdown-divider"></div>
            <button id="menu-reset-db">Reset Database</button>
          </div>
        </div>
        <div id="header-center">
          <button id="btn-back" class="btn-icon" disabled>←</button>
          <span id="current-file">No file selected</span>
          <div id="dirty-dot"></div>
        </div>
        <div id="header-actions">
          <span id="username-display"></span>
          <button id="btn-signin" style="display:none">Sign in</button>
          <button id="btn-save">Save</button>
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

        <div id="sidebar-resizer"></div>

        <main id="editor-wrap">
          <div id="empty-state">
            <p>Select a note or create a new one</p>
          </div>

          <!-- Tab bar -->
          <div id="editor-tabs" style="display:none" role="tablist">
            <button id="tab-btn-view" class="tab-btn active" role="tab">View</button>
            <button id="tab-btn-raw"  class="tab-btn"        role="tab">Raw</button>
            <button id="tab-btn-meta" class="tab-btn"        role="tab">Meta</button>
          </div>

          <!-- View tab -->
          <div id="tab-view" class="tab-panel active" role="tabpanel">
            <div class="view-header"></div>
            <div class="view-content"></div>
          </div>

          <!-- Raw tab -->
          <div id="tab-raw" class="tab-panel" style="display:none">
            <textarea id="note-area"></textarea>
          </div>

          <!-- Meta tab -->
          <div id="tab-meta" class="tab-panel" style="display:none">
            <div id="meta-panel">
              <div class="meta-field">
                <label for="meta-title">Title</label>
                <input id="meta-title" type="text" class="meta-input" />
              </div>
              <div class="meta-field">
                <label for="meta-summary">Summary</label>
                <textarea id="meta-summary" class="meta-textarea" rows="3"></textarea>
              </div>
              <div class="meta-field">
                <label for="meta-tags">Tags</label>
                <input id="meta-tags" type="text" class="meta-input" />
              </div>
              <div id="meta-custom-section">
                <div class="meta-section-header">
                  <span>Custom Fields</span>
                  <button id="btn-add-custom" class="btn-small">+ Add</button>
                </div>
                <div id="meta-custom-rows"></div>
              </div>
              <div id="meta-stats-section">
                <div class="meta-section-header">Size (body only)</div>
                <div id="meta-stats" class="meta-stats"></div>
              </div>
              <div id="meta-system-section">
                <div class="meta-section-header">System Info</div>
                <table id="meta-system-table" class="meta-system-table">
                  <tr><td>Version</td><td id="meta-sys-current"></td></tr>
                  <tr><td>Created</td><td id="meta-sys-created"></td></tr>
                  <tr><td>Updated</td><td id="meta-sys-updated"></td></tr>
                  <tr><td>Created by</td><td id="meta-sys-created-by"></td></tr>
                  <tr><td>Updated by</td><td id="meta-sys-updated-by"></td></tr>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>

      <div id="statusbar">
        <span id="status-msg"></span>
        <span id="offline-badge" class="status-item"></span>
        <span id="sync-status" class="status-item"></span>
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

    <!-- Context menu (empty — populated dynamically by context-menu.ts) -->
    <div id="context-menu" class="item-context-menu" role="menu"></div>
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
  const ui = await import('../../src/ts/ui.ts');
  // Initialise panels to cache DOM refs (required for editor functionality)
  ui.initPanels(() => {});
  return ui;
}

// ── File list ───────────────────────────────────────────────────────────────

describe('renderNoteList()', () => {
  it('renders notes in the file list', async () => {
    const ui = await getUI();
    const notes = [
      { id: 'alpha', created_at: 1, updated_at: 2, current: 'local' },
      { id: 'beta',  created_at: 3, updated_at: 4, current: 'local' },
    ];

    ui.renderNoteList(notes, null);

    const items = document.querySelectorAll('.file-item');
    expect(items).toHaveLength(2);
    expect(items[0].dataset.id).toBe('alpha');
    expect(items[1].dataset.id).toBe('beta');
  });

  it('highlights the active note', async () => {
    const ui = await getUI();
    const notes = [
      { id: 'a', created_at: 1, updated_at: 2, current: 'local' },
      { id: 'b', created_at: 3, updated_at: 4, current: 'local' },
    ];

    ui.renderNoteList(notes, 'b');

    const items = document.querySelectorAll('.file-item');
    expect(items[0].classList.contains('active')).toBe(false);
    expect(items[1].classList.contains('active')).toBe(true);
  });

  it('shows empty state when no notes', async () => {
    const ui = await getUI();
    ui.renderNoteList([], null);

    const item = document.querySelector('#file-list > div');
    expect(item.textContent).toBe('No notes found');
  });

  it('renders the more-actions button on each note', async () => {
    const ui = await getUI();
    ui.renderNoteList([{ id: 'test', created_at: 1, updated_at: 2, current: 'local' }], null);

    const moreBtn = document.querySelector('.file-item-more');
    expect(moreBtn).not.toBeNull();
  });
});

describe('setActiveNote()', () => {
  it('toggles the active class', async () => {
    const ui = await getUI();
    ui.renderNoteList([
      { id: 'a', created_at: 1, updated_at: 2, current: 'local' },
      { id: 'b', created_at: 3, updated_at: 4, current: 'local' },
    ], 'a');

    ui.setActiveNote('b');
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

describe('clearSearch()', () => {
  it('clears the search input and dispatches input event', async () => {
    const ui = await getUI();
    const input = document.getElementById('search');

    // Set initial search value
    input.value = 'something';

    // Spy on dispatchEvent to verify the input event is fired
    const dispatchSpy = vi.spyOn(input, 'dispatchEvent');

    ui.clearSearch();

    expect(input.value).toBe('');
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'input', bubbles: true })
    );
  });

  it('does nothing when search is already empty', async () => {
    const ui = await getUI();
    const input = document.getElementById('search');
    input.value = '';

    const dispatchSpy = vi.spyOn(input, 'dispatchEvent');

    ui.clearSearch();

    expect(input.value).toBe('');
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

// ── Editor ──────────────────────────────────────────────────────────────────

describe('showEditor() / hideEditor()', () => {
  it('shows editor with content', async () => {
    const ui = await getUI();
    await ui.showEditor({ id: 'my-note', content: 'Hello World', created_at: 1000, updated_at: 2000, current: 'abc', meta: {} });

    const noteArea = document.getElementById('note-area');
    const emptyState = document.getElementById('empty-state');
    const currentFile = document.getElementById('current-file');
    const editorTabs = document.getElementById('editor-tabs');
    const tabView = document.getElementById('tab-view');
    const tabRaw = document.getElementById('tab-raw');
    const tabMeta = document.getElementById('tab-meta');

    expect(editorTabs.style.display).toBe('flex');
    expect(tabView.classList.contains('active')).toBe(true);
    expect(tabRaw.classList.contains('active')).toBe(false);
    expect(tabMeta.classList.contains('active')).toBe(false);
    expect(noteArea.value).toBe('Hello World');
    expect(emptyState.style.display).toBe('none');
    expect(currentFile.innerHTML).toContain('my-note');
  });

  it('hides editor and shows empty state', async () => {
    const ui = await getUI();
    ui.hideEditor();

    const noteArea = document.getElementById('note-area');
    const emptyState = document.getElementById('empty-state');

    expect(emptyState.style.display).toBe('flex');
    expect(document.getElementById('current-file').textContent).toBe('No file selected');
    // Textarea exists but its value is preserved; panel visibility is handled via classes
    expect(noteArea).toBeTruthy();
  });

  it('flushAndGetContent returns textarea value', async () => {
    const ui = await getUI();
    document.getElementById('note-area').value = 'typed content';
    expect(ui.flushAndGetContent()).toBe('typed content');
  });

  it('getRawContent reads textarea without side effects', async () => {
    const ui = await getUI();
    document.getElementById('note-area').value = 'raw content';
    expect(ui.getRawContent()).toBe('raw content');
  });
});

describe('setDirty()', () => {
  it('toggles dirty dot visibility', async () => {
    const ui = await getUI();
    const dirtyDot = document.getElementById('dirty-dot');

    ui.setDirty(true);
    expect(dirtyDot.classList.contains('visible')).toBe(true);

    ui.setDirty(false);
    expect(dirtyDot.classList.contains('visible')).toBe(false);
  });

  it('save button is always enabled (auto-save)', async () => {
    const ui = await getUI();
    const btnSave = document.getElementById('btn-save');
    expect(btnSave.disabled).toBe(false);
    ui.setDirty(true);
    expect(btnSave.disabled).toBe(false);
    ui.setDirty(false);
    expect(btnSave.disabled).toBe(false);
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
  async function getModal() {
    vi.resetModules();
    return await import('../../src/ts/modal.ts');
  }

  it('openModal shows the modal in create mode', async () => {
    const modal = await getModal();
    const overlay = document.getElementById('modal-overlay');
    const input = document.getElementById('modal-input');

    modal.openModal(null, '');

    expect(overlay.classList.contains('open')).toBe(true);
    expect(document.getElementById('modal-title').textContent).toBe('New note');
    expect(document.getElementById('modal-create').textContent).toBe('Create');
    expect(input.value).toBe('');
  });

  it('openModal pre-fills from search text when present', async () => {
    const modal = await getModal();
    const searchInput = document.getElementById('search');
    searchInput.value = 'search-me';

    modal.openModal(null, searchInput.value);

    const input = document.getElementById('modal-input');
    expect(input.value).toBe('search-me');
  });

  it('openModal uses active note parent path as prefix', async () => {
    const modal = await getModal();
    // Simulate having a nested note open in the editor
    const ui = await getUI();
    ui.showEditor({ id: 'one:two:three', content: 'some content', created_at: 0, updated_at: 0, current: '', meta: {} });

    modal.openModal('one:two:three', '');

    const input = document.getElementById('modal-input');
    expect(input.value).toBe('one:two:');
  });

  it('openModal combines search text with active note prefix', async () => {
    const modal = await getModal();
    // Simulate having a nested note open in the editor
    const ui = await getUI();
    ui.showEditor({ id: 'one:two:three', content: 'some content', created_at: 0, updated_at: 0, current: '', meta: {} });

    const searchInput = document.getElementById('search');
    searchInput.value = 'search-me';

    modal.openModal('one:two:three', searchInput.value);

    const input = document.getElementById('modal-input');
    expect(input.value).toBe('one:two:search-me');
  });

  it('openRenameModal shows the modal in rename mode', async () => {
    const modal = await getModal();
    const input = document.getElementById('modal-input');

    modal.openRenameModal('old-note-name');

    expect(document.getElementById('modal-title').textContent).toBe('Rename note');
    expect(document.getElementById('modal-create').textContent).toBe('Rename');
    expect(input.value).toBe('old-note-name');
  });

  it('closeModal hides the modal', async () => {
    const modal = await getModal();
    modal.openModal(null, '');
    modal.closeModal();

    const overlay = document.getElementById('modal-overlay');
    expect(overlay.classList.contains('open')).toBe(false);
  });

  it('getModalValue returns trimmed input', async () => {
    const modal = await getModal();
    document.getElementById('modal-input').value = '  my value  ';
    expect(modal.getModalValue()).toBe('my value');
  });

  it('setModalError shows error message', async () => {
    const modal = await getModal();
    const hint = document.getElementById('modal-hint');

    modal.setModalError('Something went wrong');
    expect(hint.textContent).toBe('Something went wrong');
    expect(hint.className).toContain('err');
  });

  it('setModalHint shows hint message', async () => {
    const modal = await getModal();
    const hint = document.getElementById('modal-hint');

    modal.setModalHint('Will be saved as: my-note');
    expect(hint.textContent).toBe('Will be saved as: my-note');
    expect(hint.className).not.toContain('err');
  });
});

// ── Login screen ────────────────────────────────────────────────────────────

describe('login screen', () => {
  async function getLoginView() {
    vi.resetModules();
    return await import('../../src/ts/login-view.ts');
  }

  it('showLoginScreen shows login and hides app', async () => {
    const loginView = await getLoginView();
    const loginScreen = document.getElementById('login-screen');
    const appShell = document.getElementById('app');

    appShell.style.display = 'flex';
    loginScreen.style.display = 'none';

    loginView.showLoginScreen();
    expect(loginScreen.classList.contains('visible')).toBe(true);
    expect(loginScreen.style.display).toBe('flex');
    expect(appShell.style.display).toBe('none');
  });

  it('showAppShell shows app and hides login (authed)', async () => {
    const loginView = await getLoginView();
    const loginScreen = document.getElementById('login-screen');
    const appShell = document.getElementById('app');
    const usernameDisp = document.getElementById('username-display');
    const btnSignin = document.getElementById('btn-signin');
    const btnLogout = document.getElementById('btn-logout');

    loginView.showAppShell('alice');
    expect(loginScreen.classList.contains('visible')).toBe(false);
    expect(loginScreen.style.display).toBe('none');
    expect(appShell.style.display).toBe('flex');
    expect(usernameDisp.textContent).toBe('alice');
    expect(usernameDisp.style.display).toBe('inline');
    expect(btnSignin.style.display).toBe('none');
    expect(btnLogout.style.display).toBe('inline-block');
  });

  it('showAppShell shows app with sign-in button (unauthed)', async () => {
    const loginView = await getLoginView();
    const loginScreen = document.getElementById('login-screen');
    const appShell = document.getElementById('app');
    const usernameDisp = document.getElementById('username-display');
    const btnSignin = document.getElementById('btn-signin');
    const btnLogout = document.getElementById('btn-logout');

    loginView.showAppShell(null);
    expect(loginScreen.style.display).toBe('none');
    expect(appShell.style.display).toBe('flex');
    expect(usernameDisp.style.display).toBe('none');
    expect(btnSignin.style.display).toBe('inline-block');
    expect(btnLogout.style.display).toBe('none');
  });

  it('hideLoginScreen hides login and shows app', async () => {
    const loginView = await getLoginView();
    const loginScreen = document.getElementById('login-screen');
    const appShell = document.getElementById('app');

    loginView.hideLoginScreen();
    expect(loginScreen.classList.contains('visible')).toBe(false);
    expect(loginScreen.style.display).toBe('none');
    expect(appShell.style.display).toBe('flex');
  });

  it('showOfflineFirstVisit renders inline message in file list', async () => {
    const loginView = await getLoginView();
    const fileList = document.getElementById('file-list');

    loginView.showOfflineFirstVisit();
    expect(fileList.innerHTML).toContain('No notes yet');
    expect(fileList.innerHTML).toContain('Sign in to sync');
  });

  it('setLoginError sets error text', async () => {
    const loginView = await getLoginView();
    loginView.setLoginError('Invalid password');
    expect(document.getElementById('login-error').textContent).toBe('Invalid password');
  });

  it('setLoginLoading toggles button state', async () => {
    const loginView = await getLoginView();
    const btn = document.getElementById('login-btn');

    loginView.setLoginLoading(true);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Signing in…');

    loginView.setLoginLoading(false);
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
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
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
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
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
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    ui.renderNoteList([{ id: 'my-note', created_at: 1, updated_at: 2 }], null);

    const item = document.querySelector('.file-item');
    item.click();
    expect(onOpen).toHaveBeenCalledWith('my-note');
  });

  it('wires file list delete via context menu', async () => {
    const ui = await getUI();
    const onDelete = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete, onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    ui.renderNoteList([{ id: 'doomed', created_at: 1, updated_at: 2 }], null);

    // Click the ⋮ button to open the context menu
    const moreBtn = document.querySelector('.file-item-more');
    moreBtn.click();

    // Then click the Delete item in the context menu
    const delBtn = document.querySelector('.context-menu-item.danger');
    delBtn.click();
    expect(onDelete).toHaveBeenCalledWith('doomed');
  });

  it('wires file list rename via context menu', async () => {
    const ui = await getUI();
    const onRename = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename, onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    ui.renderNoteList([{ id: 'rename-me', created_at: 1, updated_at: 2 }], null);

    // Click the ⋮ button to open the context menu
    const moreBtn = document.querySelector('.file-item-more');
    moreBtn.click();

    // Then click the Rename item in the context menu
    const renameBtn = document.querySelector('.context-menu-item:not(.danger)');
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
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    const searchInput = document.getElementById('search');
    searchInput.value = 'test';
    searchInput.dispatchEvent(new Event('input'));

    expect(onSearch).toHaveBeenCalledWith('test');
  });

  it('wires Escape key to clear search', async () => {
    const ui = await getUI();
    const onSearch = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch,
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    const searchInput = document.getElementById('search');
    searchInput.value = 'some query';

    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(searchInput.value).toBe('');
    expect(onSearch).toHaveBeenCalledWith('');
  });

  it('wires Enter key to trigger full text search', async () => {
    const ui = await getUI();
    const onFullTextSearch = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onFullTextSearch,
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    const searchInput = document.getElementById('search');
    searchInput.value = 'some query';

    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onFullTextSearch).toHaveBeenCalledWith('some query');
  });

  it('wires save button', async () => {
    const ui = await getUI();
    const onSave = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave, onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

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
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
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
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
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
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    document.getElementById('modal-cancel').click();
    expect(onCancelModal).toHaveBeenCalledOnce();
  });

  it('Ctrl+S on VIEW tab is a no-op', async () => {
    const ui = await getUI();
    const onSave = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave, onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    // Open a note (defaults to VIEW tab).  Ctrl+S should not fire onSave.
    await ui.showEditor({ id: 'test', content: 'hello', created_at: 0, updated_at: 0, current: '', meta: {} });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('wires keyboard shortcut Ctrl+S for save on RAW tab', async () => {
    const ui = await getUI();
    const onSave = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave, onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    // Open a note then switch to RAW tab by clicking its button.
    // showEditor lands on VIEW; CodeMirror fails to load in jsdom so RAW is
    // the editing fallback.  Wait a tick for loadCodeMirror to settle.
    await ui.showEditor({ id: 'test', content: 'hello', created_at: 0, updated_at: 0, current: '', meta: {} });
    await new Promise(r => setTimeout(r, 10));
    document.getElementById('tab-btn-raw').click();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('wires shortcut Cmd+S for save on RAW tab (Mac)', async () => {
    const ui = await getUI();
    const onSave = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave, onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    // Open a note then switch to RAW tab.
    await ui.showEditor({ id: 'test', content: 'hello', created_at: 0, updated_at: 0, current: '', meta: {} });
    await new Promise(r => setTimeout(r, 10));
    document.getElementById('tab-btn-raw').click();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  // ── Ctrl+E shortcut ───────────────────────────────────────────────────

  it('Ctrl+E on VIEW tab switches to CODE (or RAW if CM unavailable)', async () => {
    const ui = await getUI();
    const editor = await import('../../src/ts/editor-ctrl.ts');

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    // Open a note (lands on VIEW).  Wait for loadCodeMirror to settle.
    await ui.showEditor({ id: 'test', content: 'hello', created_at: 0, updated_at: 0, current: '', meta: {} });
    await new Promise(r => setTimeout(r, 10));
    expect(editor.getActiveTab()).toBe('view');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true }));
    await new Promise(r => setTimeout(r, 10));
    // The destination depends on whether CodeMirror loaded in this env.
    const dest = editor.isCmAvailable() ? 'code' : 'raw';
    expect(editor.getActiveTab()).toBe(dest);
  });

  it('Ctrl+E on editing tab (RAW) switches to VIEW', async () => {
    const ui = await getUI();
    const editor = await import('../../src/ts/editor-ctrl.ts');

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    await ui.showEditor({ id: 'test', content: 'hello', created_at: 0, updated_at: 0, current: '', meta: {} });
    await new Promise(r => setTimeout(r, 10));

    // Programmatically switch to RAW — the panel is always registered.
    await editor.switchEditorTab('raw');
    expect(editor.getActiveTab()).toBe('raw');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true }));
    await new Promise(r => setTimeout(r, 10));
    expect(editor.getActiveTab()).toBe('view');
  });

  it('Ctrl+E on META tab switches to edit tab (CODE/RAW)', async () => {
    const ui = await getUI();
    const editor = await import('../../src/ts/editor-ctrl.ts');

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    await ui.showEditor({ id: 'test', content: 'hello', created_at: 0, updated_at: 0, current: '', meta: {} });
    await new Promise(r => setTimeout(r, 10));
    // Switch to META first
    document.getElementById('tab-btn-meta').click();
    expect(editor.getActiveTab()).toBe('meta');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true }));
    await new Promise(r => setTimeout(r, 10));
    const dest = editor.isCmAvailable() ? 'code' : 'raw';
    expect(editor.getActiveTab()).toBe(dest);
  });

  it('Ctrl+E is no-op when no note is open', async () => {
    const ui = await getUI();
    const editor = await import('../../src/ts/editor-ctrl.ts');

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    const prev = editor.getActiveTab();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true }));
    await new Promise(r => setTimeout(r, 10));
    // Tab should not change
    expect(editor.getActiveTab()).toBe(prev);
  });

  // ── Ctrl+M shortcut ───────────────────────────────────────────────────

  it('Ctrl+M on VIEW tab switches to META', async () => {
    const ui = await getUI();
    const editor = await import('../../src/ts/editor-ctrl.ts');

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    await ui.showEditor({ id: 'test', content: 'hello', created_at: 0, updated_at: 0, current: '', meta: {} });
    await new Promise(r => setTimeout(r, 10));
    expect(editor.getActiveTab()).toBe('view');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true }));
    await new Promise(r => setTimeout(r, 10));
    expect(editor.getActiveTab()).toBe('meta');
  });

  it('Ctrl+M on RAW tab switches to META', async () => {
    const ui = await getUI();
    const editor = await import('../../src/ts/editor-ctrl.ts');

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    await ui.showEditor({ id: 'test', content: 'hello', created_at: 0, updated_at: 0, current: '', meta: {} });
    await new Promise(r => setTimeout(r, 10));
    document.getElementById('tab-btn-raw').click();
    expect(editor.getActiveTab()).toBe('raw');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true }));
    await new Promise(r => setTimeout(r, 10));
    expect(editor.getActiveTab()).toBe('meta');
  });

  it('Ctrl+M is no-op when no note is open', async () => {
    const ui = await getUI();
    const editor = await import('../../src/ts/editor-ctrl.ts');

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    const prev = editor.getActiveTab();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true }));
    await new Promise(r => setTimeout(r, 10));
    expect(editor.getActiveTab()).toBe(prev);
  });

  it('wires Escape to close modal', async () => {
    const ui = await getUI();
    const modal = await import('../../src/ts/modal.ts');
    const onCancelModal = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal, onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    // Open the modal first
    modal.openModal(null, '');

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
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    const input = document.getElementById('modal-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('wires modal Enter key for rename', async () => {
    const ui = await getUI();
    const modal = await import('../../src/ts/modal.ts');
    const onRenameConfirm = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm,
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    // Open in rename mode first
    modal.openRenameModal('old-name');

    const input = document.getElementById('modal-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onRenameConfirm).toHaveBeenCalledWith('old-name');
  });

  // ── App menu dropdown ───────────────────────────────────────────────────

  it('btnMenu click toggles .open on header-brand', async () => {
    const ui = await getUI();
    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    const brand = document.getElementById('header-brand');
    const btn = document.getElementById('btn-menu');

    expect(brand.classList.contains('open')).toBe(false);

    btn.click();
    expect(brand.classList.contains('open')).toBe(true);

    btn.click();
    expect(brand.classList.contains('open')).toBe(false);
  });

  it('menuFolder switches to notes mode and closes dropdown', async () => {
    const ui = await getUI();
    const onToggleTrash = vi.fn();

    // Put sidebar in trash mode first so the switch fires
    ui.setMode('trash');

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(), onToggleTrash,
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
      onTrashPreview: vi.fn(), onTrashRestore: vi.fn(),
      onTrashPurge: vi.fn(), onTrashEmpty: vi.fn(),
    });

    const brand = document.getElementById('header-brand');
    const btn = document.getElementById('btn-menu');
    const menuFolder = document.getElementById('menu-folder');

    // Open the dropdown first
    btn.click();
    expect(brand.classList.contains('open')).toBe(true);

    menuFolder.click();
    expect(onToggleTrash).toHaveBeenCalledOnce();
    expect(brand.classList.contains('open')).toBe(false);
  });

  it('menuResetDb calls onResetDB and closes dropdown', async () => {
    const ui = await getUI();
    const onResetDB = vi.fn();

    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB,
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    const brand = document.getElementById('header-brand');
    const btn = document.getElementById('btn-menu');
    const menuResetDb = document.getElementById('menu-reset-db');

    btn.click();
    expect(brand.classList.contains('open')).toBe(true);

    menuResetDb.click();
    expect(onResetDB).toHaveBeenCalledOnce();
    expect(brand.classList.contains('open')).toBe(false);
  });

  it('click outside dropdown closes it', async () => {
    const ui = await getUI();
    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    const brand = document.getElementById('header-brand');
    const btn = document.getElementById('btn-menu');

    btn.click();
    expect(brand.classList.contains('open')).toBe(true);

    document.body.click();
    expect(brand.classList.contains('open')).toBe(false);
  });

  it('click inside dropdown (non-button) does not close it', async () => {
    const ui = await getUI();
    ui.bindEvents({
      onOpen: vi.fn(), onDelete: vi.fn(), onSearch: vi.fn(),
      onSave: vi.fn(), onNew: vi.fn(), onCreate: vi.fn(),
      onCancelModal: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(),
      onRename: vi.fn(), onRenameConfirm: vi.fn(),
      onResetDB: vi.fn(),
      onSignIn: vi.fn(), onDismissLogin: vi.fn(),
    });

    const brand = document.getElementById('header-brand');
    const btn = document.getElementById('btn-menu');
    const appMenu = document.getElementById('app-menu');

    btn.click();
    expect(brand.classList.contains('open')).toBe(true);

    appMenu.click();
    expect(brand.classList.contains('open')).toBe(true);
  });
});

// ── Resizable sidebar ───────────────────────────────────────────────────────

describe('initResizer()', () => {
  const LS_KEY = 'leaf:sidebar-width';

  beforeEach(() => {
    localStorage.removeItem(LS_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(LS_KEY);
  });

  it('restores width from localStorage on init', async () => {
    localStorage.setItem(LS_KEY, '300');
    const ui = await getUI();
    ui.initResizer();

    const app = document.getElementById('app');
    expect(app.style.getPropertyValue('--sidebar-w')).toBe('300px');
  });

  it('clamps restored width to min (120)', async () => {
    localStorage.setItem(LS_KEY, '50');
    const ui = await getUI();
    ui.initResizer();

    const app = document.getElementById('app');
    expect(app.style.getPropertyValue('--sidebar-w')).toBe('120px');
  });

  it('clamps restored width to max (500)', async () => {
    localStorage.setItem(LS_KEY, '9999');
    const ui = await getUI();
    ui.initResizer();

    const app = document.getElementById('app');
    expect(app.style.getPropertyValue('--sidebar-w')).toBe('500px');
  });

  it('ignores NaN in localStorage', async () => {
    localStorage.setItem(LS_KEY, 'not-a-number');
    const ui = await getUI();
    ui.initResizer();

    const app = document.getElementById('app');
    // Should leave the variable untouched (default 220px from CSS)
    expect(app.style.getPropertyValue('--sidebar-w')).toBe('');
  });

  it('does not throw when resizer element is missing', async () => {
    // Remove the resizer from the DOM
    const resizer = document.getElementById('sidebar-resizer');
    if (resizer) resizer.remove();

    const ui = await getUI();
    expect(() => ui.initResizer()).not.toThrow();
  });

  it('persists width to localStorage on mouseup', async () => {
    const ui = await getUI();
    ui.initResizer();

    const sidebar  = document.getElementById('sidebar');
    const resizer  = document.getElementById('sidebar-resizer');

    // jsdom doesn't do CSS layout, so getBoundingClientRect().width
    // always returns 0.  Mock it to return a controlled value.
    const origRect = sidebar.getBoundingClientRect.bind(sidebar);
    const rectW = vi.fn(() => 220);
    sidebar.getBoundingClientRect = () => {
      const r = origRect();
      r.width = rectW();
      return r;
    };

    // Simulate drag: mousedown → mousemove → mouseup
    resizer.dispatchEvent(new MouseEvent('mousedown', {
      clientX: 220, bubbles: true,
    }));
    document.dispatchEvent(new MouseEvent('mousemove', {
      clientX: 320, bubbles: true,
    }));
    // Update the mocked width so mouseup reads the new value
    rectW.mockReturnValue(320);
    document.dispatchEvent(new MouseEvent('mouseup', {
      clientX: 320, bubbles: true,
    }));

    expect(localStorage.getItem(LS_KEY)).toBe('320');
  });
});
