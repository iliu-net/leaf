/**
 * app-auth.ts — authentication lifecycle handlers
 *
 * Handles login, logout, sign-in, and dismiss-login flows.
 * Returns boolean from handleLogin so the caller (app.ts) can decide
 * what to do on success — no onSuccess callback, no circular dependency.
 */

import { login, logout } from './auth.js';
import * as loginScreen from './login-screen.js';

/**
 * Handle login form submission.
 * @returns true if login succeeded, false otherwise.
 */
export async function handleLogin(
  username: string,
  password: string,
): Promise<boolean> {
  loginScreen.setLoginError('');
  loginScreen.setLoginLoading(true);

  const result = await login(username, password);

  loginScreen.setLoginLoading(false);

  if (!result.ok) {
    loginScreen.setLoginError(result.error ?? '');
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
  loginScreen.showLoginScreen();
}

/** Dismiss the login overlay, stay in offline mode. */
export function handleDismissLogin(): void {
  loginScreen.hideLoginScreen();
  // Stay in offline mode — user chose not to authenticate
}
