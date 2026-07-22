/**
 * LoginScreen.tsx — Login overlay component.
 *
 * Phase 5a: React port of the vanilla login screen (login-view.ts +
 *           login-ctrl.ts). Renders a fixed full-viewport overlay when
 *           state.auth.showLogin is true. Local useState for ephemeral
 *           form fields; auth state changes (LOGIN / HIDE_LOGIN) drive
 *           mount / unmount.
 *
 * Phase 5: auth/login/toast wiring.
 */

import { useState, useEffect, useCallback, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAppState } from '../state/AppContext.js';
import { useAuth } from '../hooks/useAuth.js';

export default function LoginScreen() {
  const { auth: { showLogin } } = useAppState();
  const { login, dismissLogin } = useAuth();

  // ── Ephemeral form state — reset on every open ──
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Clear form fields when the login screen opens
  useEffect(() => {
    if (showLogin) {
      setUsername('');
      setPassword('');
      setShowPassword(false);
      setError('');
      setLoading(false);
    }
  }, [showLogin]);

  // ── Submit handler ──
  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    const u = username.trim();
    if (!u || !password) return;

    setError('');
    setLoading(true);

    try {
      const result = await login(u, password);
      if (!result.ok) {
        const msg = result.error ?? 'Login failed';
        setError(result.status ? `${msg} (${result.status})` : msg);
      }
    } catch {
      setError('Network error — check your connection');
    } finally {
      setLoading(false);
    }
  }, [username, password, login]);

  // ── Render ──

  return (
    <Dialog.Root open={showLogin} onOpenChange={(isOpen) => { if (!isOpen) dismissLogin(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="login-overlay" />
        <Dialog.Content className="login-content">
          <Dialog.Title asChild>
            <h1 className="login-heading">Sign in</h1>
          </Dialog.Title>

          <div id="login-brand">
            <div className="logo" aria-hidden="true">
              <svg width="16" height="16" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
                <path d="M9 12h6m-6 4h6m2 4H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l5 5v11a2 2 0 0 1-2 2z"/>
              </svg>
            </div>
            <span>Leaf</span>
          </div>

          <form id="login-form" onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="login-username">Username</label>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck="false"
                required
                value={username}
                onChange={e => setUsername(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="login-password">Password</label>
              <div className="password-wrap">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle btn-icon"
                  title={showPassword ? 'Hide password' : 'Show password'}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(v => !v)}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg width="16" height="16" fill="none" stroke="currentColor"
                         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                         viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 9.9A3 3 0 0 0 7.05 11a3 3 0 0 0 2.85 2.85"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" fill="none" stroke="currentColor"
                         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                         viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <Dialog.Description asChild>
              <p className="login-error" role="alert" aria-live="assertive">{error}</p>
            </Dialog.Description>

            <button
              id="login-btn"
              type="submit"
              className="btn btn-primary btn-full"
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <Dialog.Close asChild>
            <button id="login-close" className="btn-icon" title="Close (Esc)" type="button">
              &times;
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
