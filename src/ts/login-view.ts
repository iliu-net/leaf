/**
 * login-view.ts — login view
 *
 * Owns all login-screen DOM, extracted from ui.ts.
 */

// ── DOM refs ──────────────────────────────────────────────────────────────

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const loginScreen  = $('login-screen');
const appShell     = $('app');
const loginForm    = $('login-form');
const loginUser    = $('login-username') as HTMLInputElement;
const loginPass    = $('login-password') as HTMLInputElement;
const loginBtn     = $('login-btn') as HTMLButtonElement;
const loginErr     = $('login-error');
const usernameDisp = $('username-display');
const btnLogout    = $('btn-logout');
const btnSignin    = $('btn-signin') as HTMLButtonElement;
const loginClose   = $('login-close') as HTMLButtonElement;

// ── Public API ────────────────────────────────────────────────────────────

/** Show the login screen, hide the app shell. */
export function showLoginScreen(): void {
  loginScreen.classList.add('visible');
  loginScreen.style.display = 'flex';
  appShell.style.display    = 'none';
  loginUser.value = ''; loginUser.focus();
  loginPass.value = '';
  loginErr.textContent = '';
}

/**
 * Hide the login screen, show the app shell.
 * @param username  displayed in the header, or null for offline/unauthenticated state
 */
export function showAppShell(username: string | null): void {
  loginScreen.classList.remove('visible');
  loginScreen.style.display = 'none';
  appShell.style.display    = 'flex';

  if (username) {
    usernameDisp.textContent = username;
    usernameDisp.style.display = 'inline';
    btnSignin.style.display = 'none';
    btnLogout.style.display = 'inline-block';
  } else {
    usernameDisp.style.display = 'none';
    btnSignin.style.display = 'inline-block';
    btnLogout.style.display = 'none';
  }
}

/** Show an error message on the login form. */
export function setLoginError(msg: string): void {
  loginErr.textContent = msg;
}

/** Show/hide a loading state on the login button. */
export function setLoginLoading(loading: boolean): void {
  loginBtn.disabled     = loading;
  loginBtn.textContent  = loading ? 'Signing in…' : 'Sign in';
}

/** Hide the login screen, show the app shell (dismiss). */
export function hideLoginScreen(): void {
  loginScreen.classList.remove('visible');
  loginScreen.style.display = 'none';
  appShell.style.display    = 'flex';
}

/** True if the login screen is currently visible. */
export function isLoginVisible(): boolean {
  return loginScreen.classList.contains('visible');
}

/**
 * Show an inline message in the sidebar when there are no notes,
 * we're offline, and there's no session.
 */
export function showOfflineFirstVisit(): void {
  const fileList = document.getElementById('file-list');
  if (!fileList) return;
  fileList.innerHTML = '';
  const el = document.createElement('div');
  el.style.cssText = 'padding:20px 12px;text-align:center;font-size:11px;'
    + 'color:var(--text-3);font-family:var(--font-mono);line-height:1.6';
  el.innerHTML = 'No notes yet.<br>Sign in to sync or<br>create one locally.';
  fileList.appendChild(el);
}

// ── Event binding ────────────────────────────────────────────────────────

export interface LoginEventHandlers {
  onLogin: (u: string, p: string) => void;
  onSignIn: () => void;
  onLogout: () => void;
  onDismissLogin: () => void;
}

/**
 * Wire login screen DOM events to handlers.
 */
export function bindLoginEvents(handlers: LoginEventHandlers): void {
  // Login form submit
  loginForm.addEventListener('submit', e => {
    e.preventDefault();
    const u = loginUser.value.trim();
    const p = loginPass.value;
    if (u && p) handlers.onLogin(u, p);
  });

  // Sign-in button
  btnSignin.addEventListener('click', () => handlers.onSignIn());

  // Logout button
  btnLogout.addEventListener('click', () => handlers.onLogout());

  // Login close / dismiss button
  loginClose.addEventListener('click', () => handlers.onDismissLogin());

  // Escape key to dismiss login overlay
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && loginScreen.classList.contains('visible')) {
      handlers.onDismissLogin();
    }
  });
}
