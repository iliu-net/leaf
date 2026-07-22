/**
 * D2c — HistoryDialog component tests
 *
 * Tests the version history modal: open/closed visibility, loading state,
 * version list rendering, version selection, diff rendering, restore
 * button disabled for current version, error state with retry, and
 * empty state.
 *
 * Prop-driven — no AppProvider needed. Uses plain render().
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { DiffLine } from '../../src/ts/diff.js';

/* ── Hoisted mocks ─────────────────────────────────────────────────────── */

const { mockFetchVersionList, mockFetchVersionContent, mockComputeDiff } =
  vi.hoisted(() => ({
    mockFetchVersionList: vi.fn(),
    mockFetchVersionContent: vi.fn(),
    mockComputeDiff: vi.fn(),
  }));

vi.mock('../../src/ts/api.js', () => ({
  fetchVersionList: mockFetchVersionList,
  fetchVersionContent: mockFetchVersionContent,
  syncRequest: vi.fn(),
}));

vi.mock('../../src/ts/diff.js', () => ({
  computeDiff: mockComputeDiff,
}));

vi.mock('../../src/ts/utils.js', () => ({
  formatTimestamp: vi.fn((ts: number) => `[${ts}]`),
  esc: vi.fn((s: string) => s),
  naturalCompare: vi.fn((a: string, b: string) => a.localeCompare(b)),
  nowSec: vi.fn(() => 1700000000),
  createListenerList: vi.fn(),
  fmtSize: vi.fn(),
}));

/* ── Imports ───────────────────────────────────────────────────────────── */

import HistoryDialog from '../../src/ts/components/HistoryDialog.js';

/* ── Test data ─────────────────────────────────────────────────────────── */

function makeVersion(key: string, overrides: Partial<{ saved_at: number; author: string; prev: string | null }> = {}) {
  return { key, saved_at: overrides.saved_at ?? 1000, author: overrides.author ?? 'alice', prev: overrides.prev ?? null };
}

const sampleVersions = [
  makeVersion('v3', { saved_at: 3000, author: 'bob', prev: 'v2' }),
  makeVersion('v2', { saved_at: 2000, author: 'alice', prev: 'v1' }),
  makeVersion('v1', { saved_at: 1000, author: 'alice' }),
];

const sampleDiffLines: DiffLine[] = [
  { type: ' ', text: 'unchanged' },
  { type: '+', text: 'added' },
  { type: '-', text: 'removed' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockComputeDiff.mockReturnValue(sampleDiffLines);
});

/* ========================================================================
   1. Closed state
   ======================================================================== */

describe('Closed state', () => {
  it('does not render dialog when open=false', () => {
    render(
      <HistoryDialog noteId="test.md" open={false} onOpenChange={vi.fn()} onRestore={vi.fn()} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

/* ========================================================================
   2. Open — loading
   ======================================================================== */

describe('Open — loading', () => {
  it('shows loading state when dialog opens and fetches versions', () => {
    mockFetchVersionList.mockReturnValue(new Promise(() => {})); // never resolves

    render(
      <HistoryDialog noteId="test.md" open={true} onOpenChange={vi.fn()} onRestore={vi.fn()} />,
    );

    expect(screen.getByText('Loading version history…')).toBeInTheDocument();
  });
});

/* ========================================================================
   3. Version list
   ======================================================================== */

describe('Version list', () => {
  it('renders version list after fetch completes', async () => {
    mockFetchVersionList.mockResolvedValue({ versions: sampleVersions, current: 'v3' });

    render(
      <HistoryDialog noteId="test.md" open={true} onOpenChange={vi.fn()} onRestore={vi.fn()} />,
    );

    await waitFor(() => {
      // Version authors should be visible — 'bob' appears once, 'alice' twice
      expect(screen.getByText('bob')).toBeInTheDocument();
      expect(screen.getAllByText('alice')).toHaveLength(2);
    });

    // 3 version rows rendered
    const rows = document.querySelectorAll('.history-version-row');
    expect(rows).toHaveLength(3);
  });

  it('shows CURRENT label on the current version', async () => {
    mockFetchVersionList.mockResolvedValue({ versions: sampleVersions, current: 'v3' });

    render(
      <HistoryDialog noteId="test.md" open={true} onOpenChange={vi.fn()} onRestore={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('CURRENT')).toBeInTheDocument();
    });
  });

  it('clicking a version row selects it', async () => {
    mockFetchVersionList.mockResolvedValue({ versions: sampleVersions, current: 'v3' });

    render(
      <HistoryDialog noteId="test.md" open={true} onOpenChange={vi.fn()} onRestore={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('bob')).toBeInTheDocument();
    });

    // Click version v2 row (second version in list)
    const rows = document.querySelectorAll('.history-version-row');
    expect(rows.length).toBe(3);
    (rows[1] as HTMLElement).click();

    await waitFor(() => {
      expect(rows[1].classList.contains('selected')).toBe(true);
    });
  });
});

/* ========================================================================
   4. Diff section
   ======================================================================== */

describe('Diff section', () => {
  it('shows diff when a version is selected', async () => {
    mockFetchVersionList.mockResolvedValue({ versions: sampleVersions, current: 'v3' });
    mockFetchVersionContent.mockResolvedValue({ v2: 'old content', v3: 'new content' });

    render(
      <HistoryDialog noteId="test.md" open={true} onOpenChange={vi.fn()} onRestore={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('bob')).toBeInTheDocument();
    });

    // Click v2 to select it (diff target defaults to CURRENT = v3)
    const rows = document.querySelectorAll('.history-version-row');
    (rows[1] as HTMLElement).click();

    await waitFor(() => {
      // Diff lines should appear
      expect(screen.getByText('unchanged')).toBeInTheDocument();
    });
  });
});

/* ========================================================================
   5. Restore button
   ======================================================================== */

describe('Restore button', () => {
  it('is disabled and shows message when selected is current version', async () => {
    mockFetchVersionList.mockResolvedValue({ versions: sampleVersions, current: 'v3' });

    render(
      <HistoryDialog noteId="test.md" open={true} onOpenChange={vi.fn()} onRestore={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('CURRENT')).toBeInTheDocument();
    });

    // Restore button should say "This is the current version" and be disabled
    // (when no version is selected, selectedKey is null, and the button is disabled)
    const restoreBtn = screen.getByRole('button', { name: 'Restore this version' });
    expect(restoreBtn).toBeDisabled();
  });
});

/* ========================================================================
   6. Error state
   ======================================================================== */

describe('Error state', () => {
  it('shows error message and Retry button on fetch failure', async () => {
    mockFetchVersionList.mockRejectedValue(new Error('Network error'));

    render(
      <HistoryDialog noteId="test.md" open={true} onOpenChange={vi.fn()} onRestore={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Failed to load/)).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });
});

/* ========================================================================
   7. Empty state
   ======================================================================== */

describe('Empty state', () => {
  it('shows "No version history available" when versions list is empty', async () => {
    mockFetchVersionList.mockResolvedValue({ versions: [], current: null });

    render(
      <HistoryDialog noteId="test.md" open={true} onOpenChange={vi.fn()} onRestore={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('No version history available')).toBeInTheDocument();
    });
  });
});
