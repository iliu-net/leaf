/**
 * app-auth.ts — authentication lifecycle handlers
 *
 * Extracted from app.ts. Handles login, logout, sign-in, and dismiss-login
 * flows. Imports login-screen directly for loading/error UI since it has
 * no dependency on app.ts (no circular dependency risk).
 */

import { login, logout } from './auth.js';
import * as loginScreen from './login-screen.js';

/**
 * Handle login form submission.
 * @param onSuccess  Called after successful login (app.ts passes showApp(true))
 */
export async function handleLogin(
  username: string,
  password: string,
  onSuccess: () => void,
): Promise<void> {
  loginScreen.setLoginError('');
  loginScreen.setLoginLoading(true);

  const result = await login(username, password);

  loginScreen.setLoginLoading(false);

  if (!result.ok) {
    loginScreen.setLoginError(result.error ?? '');
    return;
  }

  onSuccess();
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
