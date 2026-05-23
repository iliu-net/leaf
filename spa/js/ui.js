/**
 * ui.js — DOM rendering & interaction layer
 *
 * All direct DOM manipulation lives here.
 * Communicates with the rest of the app only via
 * the callbacks passed in from app.js (no imports of api/store).
 *
 * Note: renderFileList() receives note objects {id, created_at, updated_at}
 * and currentId is a string id, not a full object.
 */

// ── DOM refs ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const fileList     = $('file-list');
const noteArea     = $('note-area');
const emptyState   = $('empty-state');
const currentFile  = $('current-file');
const dirtyDot     = $('dirty-dot');
const btnSave      = $('btn-save');
const searchInput  = $('search');
const noteCount    = $('note-count');
const statusMsg    = $('status-msg');
const charCount    = $('char-count');
const lineCount    = $('line-count');
const offlineBadge = $('offline-badge');
const overlay      = $('modal-overlay');
const modalInput   = $('modal-input');
const modalHint    = $('modal-hint');
const modalCreate  = $('modal-create');
const modalCancel  = $('modal-cancel');
const toastCont    = $('toast-container');
const syncStatus   = $('sync-status');
const sidebarLoad  = $('sidebar-loading');

// Login screen refs
const loginScreen  = $('login-screen');
const appShell     = $('app');
const loginForm    = $('login-form');
const loginUser    = $('login-username');
const loginPass    = $('login-password');
const loginBtn     = $('login-btn');
const loginErr     = $('login-error');
const usernameDisp = $('username-display');
const btnLogout    = $('btn-logout');

let statusTimer = null;

// ── File list ─────────────────────────────────────────────────────────────

/**
 * Render the sidebar note list.
 *
 * @param {Array<{id, created_at, updated_at}>} notes
 * @param {string|null} currentId  — id of the currently open note
 */
export function renderFileList(notes, currentId) {
  fileList.innerHTML = '';

  if (notes.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:20px 12px;text-align:center;font-size:11px;'
      + 'color:var(--text-3);font-family:var(--font-mono)';
    empty.textContent = 'No notes found';
    fileList.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();

  notes.forEach(note => {
    const { id } = note;
    const item = document.createElement('div');
    item.className   = 'file-item' + (id === currentId ? ' active' : '');
    item.dataset.id  = id;
    item.setAttribute('role', 'listitem');

    item.innerHTML = `
      <svg class="file-item-icon" width="13" height="13" fill="none"
           stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 12h6m-6 4h6m2 4H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l5 5v11a2 2 0 0 1-2 2z"/>
      </svg>
      <span class="file-item-name" title="${id}">${id}</span>
      <button class="file-item-del btn-icon" title="Delete note" aria-label="Delete ${id}">×</button>
    `;

    frag.appendChild(item);
  });

  fileList.appendChild(frag);
}

export function setActiveFile(id) {
  fileList.querySelectorAll('.file-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });
}

export function updateNoteCount(total, shown) {
  if (shown === total) {
    noteCount.textContent = `${total} note${total !== 1 ? 's' : ''}`;
  } else {
    noteCount.textContent = `${shown} / ${total}`;
  }
}

/**
 * Show or hide the sidebar loading indicator.
 * Only shown on first visit when IndexedDB is empty and sync is in progress.
 * @param {boolean} loading
 */
export function setSidebarLoading(loading) {
  if (!sidebarLoad) return;
  sidebarLoad.style.display = loading ? 'flex' : 'none';
}

// ── Editor ────────────────────────────────────────────────────────────────

export function showEditor(id, content) {
  emptyState.style.display = 'none';
  noteArea.style.display   = 'block';
  noteArea.value           = content;
  currentFile.innerHTML    = `<span class="fname">${id}</span>`;
  updateCounts();
  noteArea.focus();
}

export function hideEditor() {
  noteArea.style.display   = 'none';
  emptyState.style.display = 'flex';
  currentFile.innerHTML    = 'No file selected';
  charCount.textContent    = '';
  lineCount.textContent    = '';
}

export function getEditorContent() {
  return noteArea.value;
}

export function setDirty(val) {
  dirtyDot.classList.toggle('visible', val);
  btnSave.disabled = !val;
}

function updateCounts() {
  const text  = noteArea.value;
  const chars = text.length;
  const lines = text === '' ? 0 : text.split('\n').length;
  charCount.textContent = chars ? `${chars.toLocaleString()} chars` : '';
  lineCount.textContent = lines ? `${lines} ln` : '';
}

// ── Status bar ────────────────────────────────────────────────────────────

export function setStatus(msg, ttl = 3000) {
  statusMsg.textContent = msg;
  clearTimeout(statusTimer);
  if (ttl > 0) {
    statusTimer = setTimeout(() => {
      if (statusMsg.textContent === msg) statusMsg.textContent = '';
    }, ttl);
  }
}

export function setOffline(offline) {
  offlineBadge.classList.toggle('visible', offline);
}

/**
 * Update the sync status indicator in the status bar.
 * @param {string} text  — e.g. 'ONLINE', 'SYNCING', 'OFFLINE', 'ERROR'
 */
export function setSyncStatus(text) {
  if (!syncStatus) return;
  syncStatus.textContent = text === 'ONLINE' ? '' : text.toLowerCase();
}

// ── Toast ─────────────────────────────────────────────────────────────────

export function toast(msg, isErr = false) {
  const el = document.createElement('div');
  el.className   = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  toastCont.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Modal ─────────────────────────────────────────────────────────────────

export function openModal() {
  modalInput.value      = '';
  modalHint.textContent = '';
  modalHint.className   = 'modal-hint';
  overlay.classList.add('open');
  requestAnimationFrame(() => modalInput.focus());
}

export function closeModal() {
  overlay.classList.remove('open');
}

export function setModalError(msg) {
  modalHint.textContent = msg;
  modalHint.className   = 'modal-hint err';
}

export function setModalHint(msg) {
  modalHint.textContent = msg;
  modalHint.className   = 'modal-hint';
}

export function getModalValue() {
  return modalInput.value.trim();
}

// ── Login screen ──────────────────────────────────────────────────────────

/** Show the login screen, hide the app shell. */
export function showLoginScreen() {
  if (loginScreen) loginScreen.style.display = 'flex';
  if (appShell)    appShell.style.display    = 'none';
  if (loginUser)   { loginUser.value = ''; loginUser.focus(); }
  if (loginPass)   loginPass.value = '';
  if (loginErr)    loginErr.textContent = '';
}

/**
 * Hide the login screen, show the app shell.
 * @param {string} username — displayed in the header
 */
export function showAppShell(username) {
  if (loginScreen)  loginScreen.style.display  = 'none';
  if (appShell)     appShell.style.display     = 'flex';
  if (usernameDisp) usernameDisp.textContent   = username ?? '';
}

/**
 * Show an error message on the login form.
 * @param {string} msg
 */
export function setLoginError(msg) {
  if (loginErr) loginErr.textContent = msg;
}

/**
 * Show/hide a loading state on the login button.
 * @param {boolean} loading
 */
export function setLoginLoading(loading) {
  if (!loginBtn) return;
  loginBtn.disabled     = loading;
  loginBtn.textContent  = loading ? 'Signing in…' : 'Sign in';
}

// ── Event wiring ──────────────────────────────────────────────────────────

export function bindEvents({
  onOpen, onDelete, onSearch, onSave, onNew, onCreate, onCancelModal,
  onLogin, onLogout,
}) {
  // Login form
  if (loginForm) {
    loginForm.addEventListener('submit', e => {
      e.preventDefault();
      const u = loginUser?.value.trim() ?? '';
      const p = loginPass?.value ?? '';
      if (u && p && onLogin) onLogin(u, p);
    });
  }

  // Logout button
  if (btnLogout) {
    btnLogout.addEventListener('click', () => onLogout?.());
  }

  // File list — event delegation
  fileList.addEventListener('click', e => {
    const del  = e.target.closest('.file-item-del');
    const item = e.target.closest('.file-item');
    if (del && item)  { e.stopPropagation(); onDelete(item.dataset.id); return; }
    if (item)           onOpen(item.dataset.id);
  });

  // Search
  searchInput.addEventListener('input', () => onSearch(searchInput.value));

  // Editor — bubble a custom event so app.js can track dirty state
  noteArea.addEventListener('input', () => {
    updateCounts();
    noteArea.dispatchEvent(new CustomEvent('note-changed', { bubbles: true }));
  });

  // Buttons
  btnSave.addEventListener('click', onSave);
  $('btn-new').addEventListener('click', onNew);

  // Modal
  modalCreate.addEventListener('click', onCreate);
  modalCancel.addEventListener('click', onCancelModal);

  modalInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  onCreate();
    if (e.key === 'Escape') onCancelModal();
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) onCancelModal();
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      onSave();
    }
    if (e.key === 'Escape' && overlay.classList.contains('open')) {
      onCancelModal();
    }
  });

  // Unload guard — warn if unsaved changes
  window.addEventListener('beforeunload', e => {
    if (noteArea.style.display !== 'none' && dirtyDot.classList.contains('visible')) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
