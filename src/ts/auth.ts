/**
 * auth.ts — client-side authentication
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

// ── Types ────────────────────────────────────────────────────────────────

export interface LoginResult {
  ok: boolean;
  username?: string;
  error?: string;
}

type AuthFailureListener = () => void;

// ── Imports ──────────────────────────────────────────────────────────────

import { apiUrl } from './config.js';

// ── Constants ────────────────────────────────────────────────────────────

const AUTH_URL = apiUrl('auth');

// ── Token store (memory only) ─────────────────────────────────────────────

let _token: string | null = null;
let _username: string | null = null;
let _expires = 0;   // token expiry unix timestamp (seconds)

export function getToken(): string | null { return _token; }
export function getUsername(): string | null { return _username; }
export function isLoggedIn(): boolean { return _token !== null && Date.now() / 1000 < _expires; }

function setToken(token: string, username: string, expires: number): void {
  _token    = token;
  _username = username;
  _expires  = expires;
}

function clearToken(): void {
  _token    = null;
  _username = null;
  _expires  = 0;
}

// ── Auth failure listeners ────────────────────────────────────────────────
// Called when the token cannot be refreshed — user must log in again

const authFailureListeners: AuthFailureListener[] = [];

export function onAuthFailure(fn: AuthFailureListener): () => void {
  authFailureListeners.push(fn);
  return () => {
    const i = authFailureListeners.indexOf(fn);
    if (i !== -1) authFailureListeners.splice(i, 1);
  };
}

function notifyAuthFailure(): void {
  clearToken();
  authFailureListeners.forEach(fn => fn());
}

// ── Login ─────────────────────────────────────────────────────────────────

/**
 * Attempt to log in with username and password.
 * On success, stores the token and returns {ok, username}.
 * On failure, returns {ok: false, error: string}.
 */
export async function login(username: string, password: string): Promise<LoginResult> {
  try {
    const res = await fetch(`${AUTH_URL}?action=login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });

    const data = await res.json() as Record<string, unknown>;

    if (!res.ok || !data.ok) {
      return { ok: false, error: (data.error as string) ?? 'Login failed' };
    }

    setToken(data.token as string, data.username as string, data.expires as number);
    return { ok: true, username: data.username as string };

  } catch {
    return { ok: false, error: 'Network error — check your connection' };
  }
}

// ── Silent refresh ────────────────────────────────────────────────────────

type RefreshResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'auth' | 'network' };

/**
 * Silently refresh the access token using the httpOnly refresh cookie.
 * Returns the new token string, or null if refresh failed.
 * Multiple simultaneous calls share one in-flight request.
 */
export async function refreshToken(): Promise<string | null> {
  const result = await refreshTokenImpl(true);
  return result.ok ? result.token : null;
}

/**
 * Internal refresh with configurable auth-failure signaling.
 *
 * @param signalAuthFailure — if true, calls notifyAuthFailure() when the
 *   server explicitly rejects the refresh (401 or ok: false).  Set to
 *   false for boot-time silent restore so the caller can decide the UX.
 */
let _refreshPromise: Promise<RefreshResult> | null = null;

async function refreshTokenImpl(signalAuthFailure: boolean): Promise<RefreshResult> {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const res = await fetch(`${AUTH_URL}?action=refresh`, {
        method:      'POST',
        credentials: 'same-origin',   // send the httpOnly refresh cookie
      });

      if (!res.ok) {
        if (signalAuthFailure) notifyAuthFailure();
        return { ok: false, reason: 'auth' };
      }

      const data = await res.json() as Record<string, unknown>;

      // If the response doesn't have a boolean ok field, it's not a
      // valid auth response — treat as network error (e.g. SW fallback
      // or proxy returning an unexpected body).
      if (typeof data.ok !== 'boolean') {
        return { ok: false, reason: 'network' };
      }

      if (!data.ok) {
        if (signalAuthFailure) notifyAuthFailure();
        return { ok: false, reason: 'auth' };
      }

      setToken(data.token as string, data.username as string, data.expires as number);
      return { ok: true, token: data.token as string };

    } catch {
      // Network error — don't notify auth failure, just return null
      // so the caller can treat it as a temporary offline state
      return { ok: false, reason: 'network' };
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
 */
export async function logout(): Promise<void> {
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
 */
export async function authFetch(url: string | URL | Request, options: RequestInit = {}): Promise<Response> {
  const makeHeaders = (token: string | null): Record<string, string> => ({
    ...(options.headers as Record<string, string> | undefined),
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
 */
export async function tryRestoreSession(): Promise<'ok' | 'auth-failed' | 'network-error'> {
  const result = await refreshTokenImpl(false);
  if (result.ok) return 'ok';
  if (result.reason === 'auth') return 'auth-failed';
  return 'network-error';
}
