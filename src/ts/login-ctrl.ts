/**
 * login-ctrl.ts — login controller
 *
 * Handles login, logout, sign-in, and dismiss-login flows.
 * Returns boolean from handleLogin so the caller (app.ts) can decide
 * what to do on success — no onSuccess callback, no circular dependency.
 */

import { login, logout } from './auth.js';
import * as loginView from './login-view.js';

/**
 * Handle login form submission.
 * @returns true if login succeeded, false otherwise.
 */
export async function handleLogin(
  username: string,
  password: string,
): Promise<boolean> {
  loginView.setLoginError('');
  loginView.setLoginLoading(true);

  const result = await login(username, password);

  loginView.setLoginLoading(false);

  if (!result.ok) {
    loginView.setLoginError(result.error ?? '');
    return false;
  }

  return true;
}

/** Handle logout. auth.ts fires onAuthFailure which app.ts hooks to showLogin(). */
export async function handleLogout(): Promise<void> {
  await logout();
  // onAuthFailure will fire and call showLogin()
}

/** Show the login screen (manual sign-in trigger). */
export function handleSignIn(): void {
  loginView.showLoginScreen();
}

/** Dismiss the login overlay, stay in offline mode. */
export function handleDismissLogin(): void {
  loginView.hideLoginScreen();
  // Stay in offline mode — user chose not to authenticate
}
