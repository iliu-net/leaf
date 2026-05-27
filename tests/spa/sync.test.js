/**
 * Tests for src/ts/sync.ts — sync engine.
 *
 * Mocks the auth module entirely (sync only uses authFetch from auth.js).
 * Uses vi.mock() which is hoisted to the top of the file, before any imports.
 *
 * Each test gets a fresh sync module via vi.resetModules() + dynamic import.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db, queueChange, dbGetNote } from '../../src/ts/db.ts';

// ── Mock auth.js — sync only uses authFetch from it ───────────────────────

const mockAuthFetch = vi.fn();
vi.mock('../../src/ts/auth.ts', () => ({
  authFetch: (...args) => mockAuthFetch(...args),
}));

// ── Helper: create a mock Response-like result for authFetch ─────────────

function apiResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  };
}

// ── Helper: get a fresh sync module ─────────────────────────────────────

async function freshSync() {
  vi.resetModules();
  return await import('../../src/ts/sync.ts');
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('sync status', () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
  });

  it('starts as IDLE when online', async () => {
    const sync = await freshSync();
    expect(sync.getSyncStatus()).toBe('IDLE');
  });

  it('onSyncStatus receives immediate status callback', async () => {
    const sync = await freshSync();
    const handler = vi.fn();
    sync.onSyncStatus(handler);
    expect(handler).toHaveBeenCalledWith('IDLE', true);
  });

  it('onSyncStatus returns unsubscribe function', async () => {
    const sync = await freshSync();
    const handler = vi.fn();
    const unsub = sync.onSyncStatus(handler);
    expect(typeof unsub).toBe('function');
  });

  it('subscribe registers a listener (does not fire immediately)', async () => {
    vi.resetModules();
    const { subscribe } = await import('../../src/ts/change-bus.ts');
    const handler = vi.fn();
    const unsub = subscribe(handler);
    expect(handler).not.toHaveBeenCalled();
    expect(typeof unsub).toBe('function');
    unsub();
  });
});

// ── Tick: push cycle ────────────────────────────────────────────────────────

describe('sync tick (push)', () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    localStorage.clear();
  });

  it('pushes pending changes and pulls', async () => {
    const sync = await freshSync();
    mockAuthFetch.mockResolvedValue(apiResponse(200, { changes: [], currentRevision: 1 }));

    await queueChange('CREATE', 'test-note', '');
    await sync.syncNow();

    // Called twice: once for push, once for pull
    expect(mockAuthFetch).toHaveBeenCalledTimes(2);

    // First call is push — should contain our pending change
    const callBody = JSON.parse(mockAuthFetch.mock.calls[0][1].body);
    expect(callBody.changes).toHaveLength(1);
    expect(callBody.changes[0].type).toBe(1); // CREATE = 1
    expect(callBody.changes[0].key).toBe('test-note');
    expect(callBody.changes[0].obj.version).toBe('local');
  });

  it('marks pushed entries as sent after successful push', async () => {
    const sync = await freshSync();
    mockAuthFetch.mockResolvedValue(apiResponse(200, { changes: [], currentRevision: 1 }));

    await queueChange('CREATE', 'test-note', '');
    await sync.syncNow();

    // Queue should be pruned (sent entries removed)
    const remaining = await db.queue.toArray();
    expect(remaining).toHaveLength(0);
  });

  it('still calls pull (authFetch) even when queue is empty', async () => {
    const sync = await freshSync();
    mockAuthFetch.mockResolvedValue(apiResponse(200, { changes: [], currentRevision: 1 }));

    await sync.syncNow();

    // authFetch should be called once for pull
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
  });

  it('handles multiple pending changes of different types', async () => {
    const sync = await freshSync();
    mockAuthFetch.mockResolvedValue(apiResponse(200, { changes: [], currentRevision: 1 }));

    await queueChange('CREATE', 'a', '');
    await queueChange('CREATE', 'b', '');
    await queueChange('UPDATE', 'a', 'new content');

    await sync.syncNow();

    // First call is push
    const callBody = JSON.parse(mockAuthFetch.mock.calls[0][1].body);
    // CREATE for 'a' was collapsed by the UPDATE, so we have:
    // UPDATE for 'a' and CREATE for 'b'
    expect(callBody.changes).toHaveLength(2);
  });
});

// ── Tick: pull cycle ────────────────────────────────────────────────────────

describe('sync tick (pull)', () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    localStorage.clear();
  });

  it('applies server changes to local database', async () => {
    const sync = await freshSync();
    mockAuthFetch.mockResolvedValue(apiResponse(200, {
      changes: [
        { type: 1, key: 'server-note', obj: { content: 'from server', version: 'server:v1' } },
      ],
      currentRevision: 42,
    }));

    await sync.syncNow();

    const note = await dbGetNote('server-note');
    expect(note).not.toBeNull();
    expect(note.content).toBe('from server');
  });

  it('updates revision after successful pull', async () => {
    const sync = await freshSync();
    mockAuthFetch.mockResolvedValue(apiResponse(200, {
      changes: [],
      currentRevision: 99,
    }));

    await sync.syncNow();
    expect(localStorage.getItem('notes_sync_revision')).toBe('99');
  });

  it('publishes server-sync event when changes arrive', async () => {
    vi.resetModules();
    const { subscribe } = await import('../../src/ts/change-bus.ts');
    const sync = await import('../../src/ts/sync.ts');
    const handler = vi.fn();
    subscribe(handler);

    mockAuthFetch.mockResolvedValue(apiResponse(200, {
      changes: [
        { type: 1, key: 'new-note', obj: { content: 'hello', version: 'server:v1' } },
      ],
      currentRevision: 5,
    }));

    await sync.syncNow();
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].type).toBe('server-sync');
  });

  it('does not publish server-sync when no changes arrive', async () => {
    vi.resetModules();
    const { subscribe } = await import('../../src/ts/change-bus.ts');
    const sync = await import('../../src/ts/sync.ts');
    const handler = vi.fn();
    subscribe(handler);

    mockAuthFetch.mockResolvedValue(apiResponse(200, {
      changes: [],
      currentRevision: 5,
    }));

    await sync.syncNow();
    expect(handler).not.toHaveBeenCalled();
  });
});

// ── Error handling ──────────────────────────────────────────────────────────

describe('sync error handling', () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    localStorage.clear();
  });

  it('sets status to SYNCING then ERROR on server error', async () => {
    const sync = await freshSync();
    mockAuthFetch.mockRejectedValue(new Error('Server is down'));

    const statusHandler = vi.fn();
    sync.onSyncStatus(statusHandler);

    await sync.syncNow();

    const statusCalls = statusHandler.mock.calls.map(c => c[0]);
    expect(statusCalls).toContain('SYNCING');
    expect(statusCalls).toContain('ERROR');
  });

  it('sets status to OFFLINE on AUTH_FAILURE', async () => {
    const sync = await freshSync();
    mockAuthFetch.mockRejectedValue(new Error('AUTH_FAILURE'));

    const statusHandler = vi.fn();
    sync.onSyncStatus(statusHandler);

    await sync.syncNow();

    const statusCalls = statusHandler.mock.calls.map(c => c[0]);
    // tick catches AUTH_FAILURE and sets OFFLINE
    expect(statusCalls).toContain('SYNCING');
    expect(statusCalls).toContain('OFFLINE');
  });

  it('handles 401 response as auth failure (sets OFFLINE)', async () => {
    const sync = await freshSync();
    mockAuthFetch.mockResolvedValue(apiResponse(401, { error: 'Unauthorized' }));

    const statusHandler = vi.fn();
    sync.onSyncStatus(statusHandler);

    await sync.syncNow();

    const statusCalls = statusHandler.mock.calls.map(c => c[0]);
    // 401 from authFetch → syncRequest throws AUTH_FAILURE → tick sets OFFLINE
    expect(statusCalls).toContain('SYNCING');
    expect(statusCalls).toContain('OFFLINE');
  });

  it('sets ERROR status for non-ok response with error body', async () => {
    const sync = await freshSync();
    mockAuthFetch.mockResolvedValue(apiResponse(409, { error: 'Conflict' }));

    const statusHandler = vi.fn();
    sync.onSyncStatus(statusHandler);

    await sync.syncNow();

    const statusCalls = statusHandler.mock.calls.map(c => c[0]);
    expect(statusCalls).toContain('ERROR');
  });
});

// ── stopSync ────────────────────────────────────────────────────────────────

describe('stopSync()', () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
  });

  it('can be called without errors and is idempotent', async () => {
    const sync = await freshSync();
    expect(() => sync.stopSync()).not.toThrow();
    expect(() => sync.stopSync()).not.toThrow();
  });
});
