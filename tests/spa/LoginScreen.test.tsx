/**
 * C3 — LoginScreen component tests
 *
 * Radix Dialog component using useAppState (showLogin) + useAuth (login, dismissLogin).
 * Mocks the auth.ts and sync.ts data layers; exercises real hooks + real reducer.
 *
 * See docs/plans/c3-loginscreen-plan.md for the full test table.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor, user } from './test-utils.js';
import { useAppDispatch } from '../../src/ts/state/AppContext.js';
import LoginScreen from '../../src/ts/components/LoginScreen.js';

/* ── Mocks ────────────────────────────────────────────────────────────── */

vi.mock('../../src/ts/auth.js', () => ({
  login: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  getUsername: vi.fn(() => null),
  tryRestoreSession: vi.fn(),
  onAuthFailure: vi.fn(),
}));

vi.mock('../../src/ts/sync.js', () => ({
  syncStart: vi.fn(),
  stopSync: vi.fn(),
}));

import { login as authLogin } from '../../src/ts/auth.js';
import { syncStart } from '../../src/ts/sync.js';

/* ── Test wrapper ──────────────────────────────────────────────────────── */

/**
 * Wraps LoginScreen with a dispatch call so the dialog can be opened/closed
 * via a `show` prop.  This lets us test re-open, close, and the form-reset
 * effect without needing to call dispatch from outside the provider tree.
 */
function TestLoginScreen({ show = true }: { show?: boolean }) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch({ type: show ? 'SHOW_LOGIN' : 'HIDE_LOGIN' });
  }, [show, dispatch]);
  return <LoginScreen />;
}

function renderLoginScreen(show = true) {
  return renderWithProviders(<TestLoginScreen show={show} />);
}

/* ── Setup / teardown ──────────────────────────────────────────────────── */

beforeEach(() => {
  vi.clearAllMocks();
});

/* ========================================================================
   1. Render — visibility
   ======================================================================== */

describe('Render — visibility', () => {
  it('does not render when showLogin is false (default)', () => {
    // Render without dispatching SHOW_LOGIN — LoginScreen directly
    renderWithProviders(<LoginScreen />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders dialog when showLogin is true', async () => {
    renderLoginScreen(true);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    });
  });
});

/* ========================================================================
   2. Form elements
   ======================================================================== */

describe('Form elements', () => {
  beforeEach(async () => {
    renderLoginScreen(true);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('renders username input', () => {
    const input = screen.getByLabelText('Username');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('required');
  });

  it('renders password input', () => {
    const input = screen.getByLabelText('Password');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('required');
  });

  it('renders Sign in button (enabled by default)', () => {
    const btn = screen.getByRole('button', { name: 'Sign in' });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('renders close (×) button', () => {
    const btn = screen.getByTitle('Close (Esc)');
    expect(btn).toBeInTheDocument();
  });
});

/* ========================================================================
   3. Submit — validation
   ======================================================================== */

describe('Submit — validation', () => {
  beforeEach(async () => {
    renderLoginScreen(true);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('does not call login when both fields are empty', async () => {
    const u = user.setup();
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(authLogin).not.toHaveBeenCalled();
  });

  it('does not call login when password is empty', async () => {
    const u = user.setup();
    await u.type(screen.getByLabelText('Username'), 'alice');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(authLogin).not.toHaveBeenCalled();
  });

  it('does not call login when username is whitespace-only', async () => {
    const u = user.setup();
    await u.type(screen.getByLabelText('Username'), '   ');
    await u.type(screen.getByLabelText('Password'), 'secret');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(authLogin).not.toHaveBeenCalled();
  });

  it('calls login with trimmed username and password', async () => {
    vi.mocked(authLogin).mockResolvedValue({ ok: true, username: 'alice' });

    const u = user.setup();
    await u.type(screen.getByLabelText('Username'), '  alice  ');
    await u.type(screen.getByLabelText('Password'), 'secret');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(authLogin).toHaveBeenCalledWith('alice', 'secret');
  });
});

/* ========================================================================
   4. Submit — loading state
   ======================================================================== */

describe('Submit — loading state', () => {
  it('shows "Signing in…" and disables button while loading', async () => {
    // Deferred promise — never resolves during the test
    let resolveLogin!: (value: { ok: boolean; username?: string }) => void;
    const deferred = new Promise<{ ok: boolean; username?: string }>(r => { resolveLogin = r; });
    vi.mocked(authLogin).mockReturnValue(deferred);

    renderLoginScreen(true);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const u = user.setup();
    await u.type(screen.getByLabelText('Username'), 'alice');
    await u.type(screen.getByLabelText('Password'), 'secret');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    // Before promise resolves — loading state
    const loadingBtn = screen.getByRole('button', { name: 'Signing in…' });
    expect(loadingBtn).toBeInTheDocument();
    expect(loadingBtn).toBeDisabled();

    // Clean up: resolve so the test can finish
    resolveLogin({ ok: true, username: 'alice' });
  });

  it('button is disabled so double-submit is impossible', async () => {
    let resolveLogin!: (value: { ok: boolean }) => void;
    const deferred = new Promise<{ ok: boolean }>(r => { resolveLogin = r; });
    vi.mocked(authLogin).mockReturnValue(deferred);

    renderLoginScreen(true);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const u = user.setup();
    await u.type(screen.getByLabelText('Username'), 'alice');
    await u.type(screen.getByLabelText('Password'), 'secret');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    // Button is disabled — clicking it again does nothing
    const btn = screen.getByRole('button', { name: 'Signing in…' });
    expect(btn).toBeDisabled();

    // authLogin called exactly once (not twice from double-click)
    expect(authLogin).toHaveBeenCalledTimes(1);

    resolveLogin({ ok: true });
  });

  it('preserves typed values during loading', async () => {
    let resolveLogin!: (value: { ok: boolean }) => void;
    const deferred = new Promise<{ ok: boolean }>(r => { resolveLogin = r; });
    vi.mocked(authLogin).mockReturnValue(deferred);

    renderLoginScreen(true);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const u = user.setup();
    await u.type(screen.getByLabelText('Username'), 'alice');
    await u.type(screen.getByLabelText('Password'), 'secret');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    // Values are preserved while loading
    expect(screen.getByLabelText('Username')).toHaveValue('alice');
    expect(screen.getByLabelText('Password')).toHaveValue('secret');

    resolveLogin({ ok: true });
  });
});

/* ========================================================================
   5. Submit — success
   ======================================================================== */

describe('Submit — success', () => {
  it('calls login and syncStart on success, dialog closes', async () => {
    vi.mocked(authLogin).mockResolvedValue({ ok: true, username: 'alice' });

    renderLoginScreen(true);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const u = user.setup();
    await u.type(screen.getByLabelText('Username'), 'alice');
    await u.type(screen.getByLabelText('Password'), 'secret');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    // login() was called
    expect(authLogin).toHaveBeenCalledWith('alice', 'secret');

    // syncStart was called (useAuth.login fires it on success)
    await waitFor(() => {
      expect(syncStart).toHaveBeenCalled();
    });

    // Dialog closes after LOGIN dispatch (showLogin → false)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('username is trimmed before calling login', async () => {
    vi.mocked(authLogin).mockResolvedValue({ ok: true, username: '  bob  ' });

    renderLoginScreen(true);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const u = user.setup();
    await u.type(screen.getByLabelText('Username'), '  bob  ');
    await u.type(screen.getByLabelText('Password'), 'pwd');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(authLogin).toHaveBeenCalledWith('bob', 'pwd');
  });
});

/* ========================================================================
   6. Submit — failure
   ======================================================================== */

describe('Submit — failure', () => {
  it('shows error message on login failure (ok: false)', async () => {
    vi.mocked(authLogin).mockResolvedValue({ ok: false });

    renderLoginScreen(true);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const u = user.setup();
    await u.type(screen.getByLabelText('Username'), 'alice');
    await u.type(screen.getByLabelText('Password'), 'wrong');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText('Login failed')).toBeInTheDocument();
    });
  });

  it('button re-enabled after failure', async () => {
    vi.mocked(authLogin).mockResolvedValue({ ok: false });

    renderLoginScreen(true);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const u = user.setup();
    await u.type(screen.getByLabelText('Username'), 'alice');
    await u.type(screen.getByLabelText('Password'), 'wrong');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    // Wait for error — then check button is back to normal
    await waitFor(() => {
      expect(screen.getByText('Login failed')).toBeInTheDocument();
    });

    const btn = screen.getByRole('button', { name: 'Sign in' });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('dialog stays open after failure so user can retry', async () => {
    vi.mocked(authLogin).mockResolvedValue({ ok: false });

    renderLoginScreen(true);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const u = user.setup();
    await u.type(screen.getByLabelText('Username'), 'alice');
    await u.type(screen.getByLabelText('Password'), 'wrong');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText('Login failed')).toBeInTheDocument();
    });

    // Dialog still open — user can retry
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
  });
});

/* ========================================================================
   7. Submit — network error
   ======================================================================== */

describe('Submit — network error', () => {
  it('shows network error when login rejects', async () => {
    vi.mocked(authLogin).mockRejectedValue(new Error('Network error'));

    renderLoginScreen(true);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const u = user.setup();
    await u.type(screen.getByLabelText('Username'), 'alice');
    await u.type(screen.getByLabelText('Password'), 'secret');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText('Network error — check your connection')).toBeInTheDocument();
    });
  });

  it('button re-enabled after network error', async () => {
    vi.mocked(authLogin).mockRejectedValue(new Error('Network error'));

    renderLoginScreen(true);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const u = user.setup();
    await u.type(screen.getByLabelText('Username'), 'alice');
    await u.type(screen.getByLabelText('Password'), 'secret');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText('Network error — check your connection')).toBeInTheDocument();
    });

    const btn = screen.getByRole('button', { name: 'Sign in' });
    expect(btn).not.toBeDisabled();
  });

  it('retry after network error works', async () => {
    // First attempt: network error
    vi.mocked(authLogin).mockRejectedValueOnce(new Error('Network error'));
    // Second attempt: success
    vi.mocked(authLogin).mockResolvedValueOnce({ ok: true, username: 'alice' });

    renderLoginScreen(true);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const u = user.setup();
    // First try — fails
    await u.type(screen.getByLabelText('Username'), 'alice');
    await u.type(screen.getByLabelText('Password'), 'secret');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText('Network error — check your connection')).toBeInTheDocument();
    });

    // Second try — succeeds (re-type password since form may retain values)
    const pwInput = screen.getByLabelText('Password');
    await u.clear(pwInput);
    await u.type(pwInput, 'secret');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(syncStart).toHaveBeenCalled();
  });
});

/* ========================================================================
   8. Close / dismiss
   ======================================================================== */

describe('Close / dismiss', () => {
  beforeEach(async () => {
    renderLoginScreen(true);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('closes dialog when × button is clicked', async () => {
    const u = user.setup();
    await u.click(screen.getByTitle('Close (Esc)'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('closes dialog when Escape is pressed', async () => {
    const u = user.setup();
    await u.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});

/* ========================================================================
   9. Form reset on re-open
   ======================================================================== */

describe('Form reset on re-open', () => {
  it('clears fields when re-opened after close', async () => {
    const u = user.setup();
    const { rerender } = renderLoginScreen(true);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Type into fields
    await u.type(screen.getByLabelText('Username'), 'alice');
    await u.type(screen.getByLabelText('Password'), 'secret');

    // Close via × button
    await u.click(screen.getByTitle('Close (Esc)'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    // Re-open — must toggle show so the effect re-fires
    rerender(<TestLoginScreen show={false} />);
    rerender(<TestLoginScreen show={true} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Fields are cleared
    expect(screen.getByLabelText('Username')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('clears error message on re-open', async () => {
    vi.mocked(authLogin).mockResolvedValue({ ok: false });

    const u = user.setup();
    const { rerender } = renderLoginScreen(true);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Trigger a login failure
    await u.type(screen.getByLabelText('Username'), 'bad');
    await u.type(screen.getByLabelText('Password'), 'creds');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText('Login failed')).toBeInTheDocument();
    });

    // Close
    await u.click(screen.getByTitle('Close (Esc)'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    // Re-open
    rerender(<TestLoginScreen show={false} />);
    rerender(<TestLoginScreen show={true} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // No stale error message
    expect(screen.queryByText('Login failed')).toBeNull();
  });

  it('resets loading state on re-open', async () => {
    let resolveLogin!: (value: { ok: boolean }) => void;
    const deferred = new Promise<{ ok: boolean }>(r => { resolveLogin = r; });
    vi.mocked(authLogin).mockReturnValue(deferred);

    const u = user.setup();
    const { rerender } = renderLoginScreen(true);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Submit — enters loading state
    await u.type(screen.getByLabelText('Username'), 'alice');
    await u.type(screen.getByLabelText('Password'), 'secret');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeInTheDocument();

    // Resolve the deferred promise so the component can finish
    resolveLogin({ ok: true });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    // Re-open
    rerender(<TestLoginScreen show={false} />);
    rerender(<TestLoginScreen show={true} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Loading is reset — button shows "Sign in", not "Signing in…"
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
