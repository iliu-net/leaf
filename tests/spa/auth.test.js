/**
 * Tests for spa/js/auth.js — authentication & token management.
 *
 * Mocks global fetch to simulate server responses.
 * Uses vi.resetModules() before each test to clear module-level token state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Helpers ─────────────────────────────────────────────────────────────────

function mockFetch(status, body) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  );
}

function mockFetchFail() {
  return vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
}

// ── Login ───────────────────────────────────────────────────────────────────

describe('login()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function getAuth() {
    vi.resetModules();
    return await import('../../src/ts/auth.ts');
  }

  it('returns ok:true and stores token on success', async () => {
    const auth = await getAuth();
    const fetchSpy = mockFetch(200, {
      ok: true, token: 'jwt-token', username: 'alice', expires: 9999999999,
    });

    const result = await auth.login('alice', 'pass123');

    expect(result.ok).toBe(true);
    expect(result.username).toBe('alice');
    expect(auth.getToken()).toBe('jwt-token');
    expect(auth.getUsername()).toBe('alice');
    expect(auth.isLoggedIn()).toBe(true);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('action=login'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('alice'),
      })
    );
  });

  it('returns ok:false on server error', async () => {
    const auth = await getAuth();
    mockFetch(401, { ok: false, error: 'Invalid credentials' });
    const result = await auth.login('alice', 'wrong');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Invalid credentials');
    expect(auth.getToken()).toBeNull();
  });

  it('returns ok:false when server returns 200 but ok:false', async () => {
    const auth = await getAuth();
    mockFetch(200, { ok: false, error: 'Account locked' });
    const result = await auth.login('alice', 'pass');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Account locked');
  });

  it('returns network error on fetch rejection', async () => {
    const auth = await getAuth();
    mockFetchFail();
    const result = await auth.login('alice', 'pass');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Network error');
  });
});

// ── Token state ─────────────────────────────────────────────────────────────

describe('token state', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function getAuth() {
    vi.resetModules();
    return await import('../../src/ts/auth.ts');
  }

  it('isLoggedIn returns false when no token', async () => {
    const auth = await getAuth();
    expect(auth.isLoggedIn()).toBe(false);
  });

  it('isLoggedIn returns false when token is expired', async () => {
    const auth = await getAuth();
    mockFetch(200, {
      ok: true, token: 'expired-token', username: 'alice', expires: Date.now() / 1000 - 10,
    });
    await auth.login('alice', 'pass');
    expect(auth.isLoggedIn()).toBe(false);
  });
});

// ── Refresh ─────────────────────────────────────────────────────────────────

describe('refreshToken()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function getAuth() {
    vi.resetModules();
    return await import('../../src/ts/auth.ts');
  }

  it('returns a token on successful refresh', async () => {
    const auth = await getAuth();
    mockFetch(200, {
      ok: true, token: 'new-token', username: 'alice', expires: 9999999999,
    });

    const token = await auth.refreshToken();
    expect(token).toBe('new-token');
    expect(auth.getToken()).toBe('new-token');
  });

  it('returns null and calls auth failure listeners on 401', async () => {
    const auth = await getAuth();
    mockFetch(401, { ok: false, error: 'Refresh failed' });

    const listener = vi.fn();
    auth.onAuthFailure(listener);

    const token = await auth.refreshToken();
    expect(token).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('returns null on network error without firing auth failure', async () => {
    const auth = await getAuth();
    mockFetchFail();

    const listener = vi.fn();
    auth.onAuthFailure(listener);

    const token = await auth.refreshToken();
    expect(token).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent refresh calls', async () => {
    const auth = await getAuth();
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      callCount++;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, token: 't', username: 'u', expires: 9999999999 }))
      );
    });

    const [r1, r2] = await Promise.all([auth.refreshToken(), auth.refreshToken()]);
    expect(r1).toBe('t');
    expect(r2).toBe('t');
    expect(callCount).toBe(1);
  });
});

// ── Logout ──────────────────────────────────────────────────────────────────

describe('logout()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function getAuth() {
    vi.resetModules();
    return await import('../../src/ts/auth.ts');
  }

  it('clears token and notifies listeners', async () => {
    const auth = await getAuth();
    // First log in
    mockFetch(200, {
      ok: true, token: 'some-token', username: 'alice', expires: 9999999999,
    });
    await auth.login('alice', 'pass');

    const listener = vi.fn();
    auth.onAuthFailure(listener);

    // Mock logout endpoint
    mockFetch(200, { ok: true });

    await auth.logout();

    expect(auth.getToken()).toBeNull();
    expect(auth.getUsername()).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('clears local state even if server request fails', async () => {
    const auth = await getAuth();
    mockFetch(200, { ok: true, token: 't', username: 'u', expires: 9999999999 });
    await auth.login('u', 'p');

    mockFetchFail();
    await auth.logout();

    expect(auth.getToken()).toBeNull();
  });
});

// ── authFetch ───────────────────────────────────────────────────────────────

describe('authFetch()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function getAuth() {
    vi.resetModules();
    return await import('../../src/ts/auth.ts');
  }

  it('attaches Authorization header when token exists', async () => {
    const auth = await getAuth();
    // Login first
    mockFetch(200, { ok: true, token: 'my-token', username: 'u', expires: 9999999999 });
    await auth.login('u', 'p');

    const fetchSpy = mockFetch(200, { data: 'ok' });

    await auth.authFetch('/api/endpoint', { method: 'GET' });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/endpoint',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer my-token' }),
      })
    );
  });

  it('retries once on 401 after successful token refresh', async () => {
    const auth = await getAuth();
    // Login with initial token
    mockFetch(200, { ok: true, token: 'first-token', username: 'u', expires: 9999999999 });
    await auth.login('u', 'p');

    // Mock: first request returns 401, refresh succeeds, second request succeeds
    let callNum = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
      callNum++;
      if (url.toString().includes('action=refresh')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, token: 'refreshed-token', username: 'u', expires: 9999999999 }))
        );
      }
      if (callNum === 1) {
        return Promise.resolve(new Response(null, { status: 401 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ data: 'ok' }), { status: 200 }));
    });

    const res = await auth.authFetch('/api/data');
    expect(res.status).toBe(200);
    expect(auth.getToken()).toBe('refreshed-token');
  });

  it('does not retry on non-401 errors', async () => {
    const auth = await getAuth();
    mockFetch(200, { ok: true, token: 't', username: 'u', expires: 9999999999 });
    await auth.login('u', 'p');

    const fetchSpy = mockFetch(403, { error: 'Forbidden' });

    const res = await auth.authFetch('/api/data');
    expect(res.status).toBe(403);
    // Should have only called once
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns the original 401 response if refresh fails', async () => {
    const auth = await getAuth();
    mockFetch(200, { ok: true, token: 't', username: 'u', expires: 9999999999 });
    await auth.login('u', 'p');

    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        // refresh request also fails
        return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 401 }));
      }
      return Promise.resolve(new Response(null, { status: 401 }));
    });

    const res = await auth.authFetch('/api/data');
    expect(res.status).toBe(401);
  });
});

// ── tryRestoreSession ───────────────────────────────────────────────────────

describe('tryRestoreSession()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function getAuth() {
    vi.resetModules();
    return await import('../../src/ts/auth.ts');
  }

  it("returns 'ok' when refresh succeeds", async () => {
    const auth = await getAuth();
    mockFetch(200, { ok: true, token: 't', username: 'u', expires: 9999999999 });
    const result = await auth.tryRestoreSession();
    expect(result).toBe('ok');
  });

  it("returns 'auth-failed' when refresh fails with HTTP error", async () => {
    const auth = await getAuth();
    mockFetch(401, { ok: false });
    const result = await auth.tryRestoreSession();
    expect(result).toBe('auth-failed');
  });

  it("returns 'network-error' when server is unreachable", async () => {
    const auth = await getAuth();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
    const result = await auth.tryRestoreSession();
    expect(result).toBe('network-error');
  });

  it("returns 'network-error' when response lacks boolean ok field", async () => {
    const auth = await getAuth();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Offline', changes: [] }), { status: 200 })
    );
    const result = await auth.tryRestoreSession();
    expect(result).toBe('network-error');
  });
});

// ── Auth failure listener management ────────────────────────────────────────

describe('onAuthFailure()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function getAuth() {
    vi.resetModules();
    return await import('../../src/ts/auth.ts');
  }

  it('returns an unsubscribe function', async () => {
    const auth = await getAuth();
    const fn = vi.fn();
    const unsub = auth.onAuthFailure(fn);
    expect(typeof unsub).toBe('function');
    expect(unsub).not.toThrow();
  });
});
