/**
 * D1c — StatusBar component tests
 *
 * Tests the bottom status bar: status message, offline badge visibility,
 * and sync status display.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor } from './test-utils.js';
import { useAppDispatch } from '../../src/ts/state/AppContext.js';

/* ── Mocks ─────────────────────────────────────────────────────────────── */

vi.mock('../../src/ts/sync.js', () => ({
  onSyncStatus: vi.fn(() => {
    // Return an unsubscribe function
    return () => {};
  }),
  stopSync: vi.fn(),
  clearRevision: vi.fn(),
}));

/* ── Imports ───────────────────────────────────────────────────────────── */

import StatusBar from '../../src/ts/components/StatusBar.js';

/* ── Helpers ───────────────────────────────────────────────────────────── */

function renderStatusBar() {
  return renderWithProviders(<StatusBar />);
}

function renderWithSeed(dispatches: Array<{ type: string; [key: string]: any }>) {
  function SeedWrapper() {
    const dispatch = useAppDispatch();
    useEffect(() => {
      for (const action of dispatches) {
        dispatch(action as any);
      }
    }, []);
    return <StatusBar />;
  }
  return renderWithProviders(<SeedWrapper />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ========================================================================
   1. Status message
   ======================================================================== */

describe('Status message', () => {
  it('shows empty status by default', () => {
    renderStatusBar();
    const msg = document.getElementById('status-msg');
    expect(msg).toBeInTheDocument();
    expect(msg!.textContent).toBe('');
  });

  it('shows status text when SET_STATUS is dispatched', async () => {
    renderWithSeed([{ type: 'SET_STATUS', status: 'Saved note.md' }]);

    await waitFor(() => {
      const msg = document.getElementById('status-msg');
      expect(msg!.textContent).toBe('Saved note.md');
    });
  });
});

/* ========================================================================
   2. Offline badge
   ======================================================================== */

describe('Offline badge', () => {
  it('shows offline badge when isOffline is true', async () => {
    renderWithSeed([{ type: 'SET_OFFLINE', isOffline: true }]);

    await waitFor(() => {
      const badge = document.getElementById('offline-badge');
      expect(badge).toBeInTheDocument();
      expect(badge!.textContent).toBe('offline');
      expect(badge!.classList.contains('visible')).toBe(true);
    });
  });

  it('does NOT show offline badge when isOffline is false (default)', () => {
    renderStatusBar();
    const badge = document.getElementById('offline-badge');
    expect(badge).toBeNull();
  });
});

/* ========================================================================
   3. Sync status
   ======================================================================== */

describe('Sync status', () => {
  it('shows sync status text when SET_SYNC_STATUS is dispatched', async () => {
    renderWithSeed([{ type: 'SET_SYNC_STATUS', status: 'SYNCING' }]);

    await waitFor(() => {
      const el = document.getElementById('sync-status');
      expect(el!.textContent).toBe('SYNCING');
    });
  });

  it('shows empty sync status by default', () => {
    renderStatusBar();
    const el = document.getElementById('sync-status');
    expect(el!.textContent).toBe('');
  });
});

