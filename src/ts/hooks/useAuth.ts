/**
 * useAuth.ts — Hook wrapping the auth layer.
 *
 * Provides login/logout/session-restore functions that call auth.ts and
 * login-ctrl.ts, dispatching auth state changes to the reducer.
 *
 * Phase 2: hook exists, can be called manually.
 * Phase 5: wired to LoginScreen, StatusBar, and boot sequence.
 */

import { useCallback } from 'react';
import { useAppDispatch, useAppState } from '../state/AppContext.js';
import { getUsername, tryRestoreSession, onAuthFailure, login as authLogin, logout as authLogout } from '../auth.js';
import { isAuthEnabled } from '../config.js';
import { syncStart, stopSync } from '../sync.js';

export function useAuth() {
  const dispatch = useAppDispatch();
  const auth = useAppState().auth;

  /**
   * Try to restore an existing session (cookie-based refresh token).
   * Returns 'ok', 'auth-failed', or 'network-error'.
   * On 'ok', dispatches LOGIN and starts the sync poll loop.
   */
  const restoreSession = useCallback(async () => {
    const result = await tryRestoreSession();
    if (result === 'ok') {
      const username = getUsername();
      if (username) {
        dispatch({ type: 'LOGIN', username });
        syncStart();
      }
    }
    return result;
  }, [dispatch]);

  /**
   * Authenticate with username + password.
   * Returns the full LoginResult so callers can inspect errors / status codes.
   * Dispatches LOGIN on success.
   */
  const login = useCallback(async (username: string, password: string) => {
    const result = await authLogin(username, password);
    if (result.ok) {
      dispatch({ type: 'LOGIN', username: result.username! });
      syncStart(); // fire-and-forget — starts push+pull poll loop
    }
    return result;
  }, [dispatch]);

  /**
   * Log out — clears token, dispatches LOGOUT.
   */
  const logout = useCallback(async () => {
    await authLogout();
    stopSync();
    dispatch({ type: 'LOGOUT' });
  }, [dispatch]);

  /** Show the login screen (e.g. on auth failure). */
  const showLogin = useCallback(() => {
    dispatch({ type: 'SHOW_LOGIN' });
  }, [dispatch]);

  /** Dismiss the login screen (e.g. "continue offline"). */
  const dismissLogin = useCallback(() => {
    dispatch({ type: 'HIDE_LOGIN' });
  }, [dispatch]);

  /** Show sign-in button (pre-login state). */
  const showSignIn = useCallback(() => {
    // No-op for now — Phase 5 wires the login UI
  }, []);

  /** Register auth-failure listener. Calls showLogin on 401. */
  const onFailure = useCallback(() => {
    onAuthFailure(showLogin);
  }, [showLogin]);

  return {
    /** Current auth state from context. */
    ...auth,
    /** Whether auth is enabled in the server SPA config (reads live, re-evaluated each render). */
    isAuthEnabled: isAuthEnabled(),
    /** Get the current username directly from the auth module (sync). */
    getUsername,
    /** Restore session from refresh cookie. */
    restoreSession,
    /** Log in with username + password. */
    login,
    /** Log out. */
    logout,
    /** Show the login screen. */
    showLogin,
    /** Dismiss login and continue offline. */
    dismissLogin,
    /** Show the sign-in prompt. */
    showSignIn,
    /** Register the auth-failure handler. */
    onFailure,
  };
}
