/**
 * auth.js — client-side authentication
 *
 * Manages the JWT access token lifecycle:
 *   - Login:   POST to auth.php?action=login, store token in memory
 *   - Refresh: POST to auth.php?action=refresh (cookie sent automatically)
 *   - Logout:  POST to auth.php?action=logout, clear token
 *
 * Token storage:
 *   Access token  — JS module-level variable (memory only).
 *                   Cleared on tab close. Refresh cookie re-issues it silently.
 *   Refresh token — httpOnly cookie managed entirely by the server.
 *                   JS never reads or writes it directly.
 *
 * Token refresh strategy:
 *   - authFetch() is a drop-in replacement for fetch() that automatically
 *     attaches the Authorization header and retries once on 401 after
 *     attempting a silent token refresh.
 *   - If refresh also fails (cookie expired / logged out), onAuthFailure()
 *     callbacks fire so app.js can show the login screen.
 */

const AUTH_URL = '../api/auth.php';

// ── Token store (memory only) ─────────────────────────────────────────────

let _token    = null;   // current JWT string
let _username = null;   // logged-in username
let _expires  = 0;      // token expiry unix timestamp (seconds)

export function getToken()    { return _token; }
export function getUsername() { return _username; }
export function isLoggedIn()  { return _token !== null && Date.now() / 1000 < _expires; }

function setToken(token, username, expires) {
  _token    = token;
  _username = username;
  _expires  = expires;
}

function clearToken() {
  _token    = null;
  _username = null;
  _expires  = 0;
}

// ── Auth failure listeners ────────────────────────────────────────────────
// Called when the token cannot be refreshed — user must log in again

const authFailureListeners = [];

export function onAuthFailure(fn) {
  authFailureListeners.push(fn);
  return () => {
    const i = authFailureListeners.indexOf(fn);
    if (i !== -1) authFailureListeners.splice(i, 1);
  };
}

function notifyAuthFailure() {
  clearToken();
  authFailureListeners.forEach(fn => fn());
}

// ── Login ─────────────────────────────────────────────────────────────────

/**
 * Attempt to log in with username and password.
 * On success, stores the token and returns {ok, username}.
 * On failure, returns {ok: false, error: string}.
 *
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ok: boolean, username?: string, error?: string}>}
 */
export async function login(username, password) {
  try {
    const res = await fetch(`${AUTH_URL}?action=login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? 'Login failed' };
    }

    setToken(data.token, data.username, data.expires);
    return { ok: true, username: data.username };

  } catch (err) {
    return { ok: false, error: 'Network error — check your connection' };
  }
}

// ── Silent refresh ────────────────────────────────────────────────────────

let _refreshPromise = null;   // deduplicate concurrent refresh attempts

/**
 * Silently refresh the access token using the httpOnly refresh cookie.
 * Returns the new token string, or null if refresh failed.
 * Multiple simultaneous calls share one in-flight request.
 *
 * @returns {Promise<string|null>}
 */
export async function refreshToken() {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const res = await fetch(`${AUTH_URL}?action=refresh`, {
        method:      'POST',
        credentials: 'same-origin',   // send the httpOnly refresh cookie
      });

      if (!res.ok) {
        notifyAuthFailure();
        return null;
      }

      const data = await res.json();
      if (!data.ok) {
        notifyAuthFailure();
        return null;
      }

      setToken(data.token, data.username, data.expires);
      return data.token;

    } catch {
      // Network error — don't notify auth failure, just return null
      // so the caller can treat it as a temporary offline state
      return null;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

// ── Logout ────────────────────────────────────────────────────────────────

/**
 * Log out the current user.
 * Clears the server-side refresh token and the in-memory access token.
 *
 * @returns {Promise<void>}
 */
export async function logout() {
  try {
    await fetch(`${AUTH_URL}?action=logout`, {
      method:      'POST',
      credentials: 'same-origin',
    });
  } catch {
    // Best-effort — clear local state regardless
  }
  clearToken();
  notifyAuthFailure();
}

// ── Authenticated fetch ───────────────────────────────────────────────────

/**
 * Drop-in replacement for fetch() that:
 *   1. Attaches Authorization: Bearer <token> to every request
 *   2. On 401, attempts a silent token refresh and retries once
 *   3. If refresh fails, fires onAuthFailure() listeners
 *
 * Use this for all requests to api.php and sync.php.
 *
 * @param {string}  url
 * @param {object}  options  — standard fetch options
 * @returns {Promise<Response>}
 */
export async function authFetch(url, options = {}) {
  const makeHeaders = (token) => ({
    ...options.headers,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  });

  // First attempt
  const res = await fetch(url, { ...options, headers: makeHeaders(_token) });

  if (res.status !== 401) return res;

  // Got 401 — try a silent refresh
  const newToken = await refreshToken();
  if (!newToken) {
    // refreshToken() already called notifyAuthFailure() if needed
    return res;
  }

  // Retry with new token
  return fetch(url, { ...options, headers: makeHeaders(newToken) });
}

// ── Boot: attempt silent restore from refresh cookie ─────────────────────

/**
 * Called once at app boot. Tries to restore a session from the
 * refresh cookie without requiring the user to log in again.
 *
 * Returns true if a valid session was restored, false otherwise.
 *
 * @returns {Promise<boolean>}
 */
export async function tryRestoreSession() {
  const token = await refreshToken();
  return token !== null;
}
