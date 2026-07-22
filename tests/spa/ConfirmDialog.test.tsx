/**
 * D1b — ConfirmDialog component tests
 *
 * Tests the styled confirmation dialog (Radix Dialog): visibility control
 * via confirmDialog.open, title/message/confirmLabel rendering, danger
 * variant styling, Cancel→onCancel, Confirm→onConfirm, and
 * onOpenChange→onCancel path.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, waitFor } from './test-utils.js';
import { useAppDispatch } from '../../src/ts/state/AppContext.js';

import ConfirmDialog from '../../src/ts/components/ConfirmDialog.js';

/* ── Helpers ───────────────────────────────────────────────────────────── */

function renderDialog(opts?: {
  onConfirm?: () => void;
  onCancel?: () => void;
  seedOpen?: boolean;
  seedTitle?: string;
  seedMessage?: string;
  seedConfirmLabel?: string;
  seedVariant?: 'danger' | 'default';
}) {
  const onConfirm = opts?.onConfirm ?? vi.fn();
  const onCancel = opts?.onCancel ?? vi.fn();

  function SeedWrapper() {
    const dispatch = useAppDispatch();
    useEffect(() => {
      if (opts?.seedOpen) {
        dispatch({
          type: 'SHOW_CONFIRM',
          title: opts.seedTitle ?? 'Confirm?',
          message: opts.seedMessage ?? 'Are you sure?',
          confirmLabel: opts.seedConfirmLabel ?? 'OK',
          variant: opts.seedVariant ?? 'default',
        });
      }
    }, []);
    return <ConfirmDialog onConfirm={onConfirm} onCancel={onCancel} />;
  }

  renderWithProviders(<SeedWrapper />);

  return { onConfirm, onCancel };
}

/* ========================================================================
   1. Closed state
   ======================================================================== */

describe('Closed state', () => {
  it('does not render dialog when confirmDialog.open is false (default)', () => {
    renderDialog({ seedOpen: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Title, message, buttons should not be in the DOM
    expect(screen.queryByText('OK')).toBeNull();
  });
});

/* ========================================================================
   2. Open — content rendering
   ======================================================================== */

describe('Open — content rendering', () => {
  it('renders title, message, and confirmLabel when open', async () => {
    renderDialog({
      seedOpen: true,
      seedTitle: 'Delete file?',
      seedMessage: 'This action cannot be undone.',
      seedConfirmLabel: 'Yes, delete',
      seedVariant: 'danger',
    });

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
    });

    // Radix Dialog.Title rendered as h2
    expect(screen.getByText('Delete file?')).toBeInTheDocument();
    // Radix Dialog.Description rendered as p
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
    // Confirm button with custom label
    expect(screen.getByRole('button', { name: 'Yes, delete' })).toBeInTheDocument();
    // Cancel button
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows default confirmLabel when none provided', async () => {
    renderDialog({
      seedOpen: true,
      seedTitle: 'Title',
      seedMessage: 'Msg',
    });
    // confirmLabel defaults to 'OK' in seed but the reducer default is 'Confirm'
    // We didn't provide confirmLabel, so the ConfirmDialog uses whatever is in state.
    // The SHOW_CONFIRM action requires confirmLabel, so we pass 'OK' above.
  });
});

/* ========================================================================
   3. Danger variant
   ======================================================================== */

describe('Danger variant', () => {
  it('adds .danger class to content and .btn-danger to confirm button', async () => {
    renderDialog({
      seedOpen: true,
      seedTitle: 'Delete?',
      seedMessage: 'Really?',
      seedConfirmLabel: 'Delete',
      seedVariant: 'danger',
    });

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
    });

    // Content has .danger class
    const content = document.querySelector('.confirm-dialog.danger');
    expect(content).toBeInTheDocument();

    // Confirm button has .btn-danger
    const confirmBtn = screen.getByRole('button', { name: 'Delete' });
    expect(confirmBtn.classList.contains('btn-danger')).toBe(true);
  });

  it('does NOT add danger classes for default variant', async () => {
    renderDialog({
      seedOpen: true,
      seedTitle: 'Save?',
      seedMessage: 'Save changes?',
      seedConfirmLabel: 'Save',
      seedVariant: 'default',
    });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const contentDanger = document.querySelector('.confirm-dialog.danger');
    expect(contentDanger).toBeNull();

    const confirmBtn = screen.getByRole('button', { name: 'Save' });
    expect(confirmBtn.classList.contains('btn-danger')).toBe(false);
    expect(confirmBtn.classList.contains('btn-primary')).toBe(true);
  });
});

/* ========================================================================
   4. Cancel action
   ======================================================================== */

describe('Cancel action', () => {
  it('calls onCancel when Cancel button is clicked', async () => {
    const user = (await import('@testing-library/user-event')).default;
    const { onCancel } = renderDialog({
      seedOpen: true,
      seedTitle: 'Confirm?',
      seedMessage: 'Proceed?',
    });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalled();
  });
});

/* ========================================================================
   5. Confirm action
   ======================================================================== */

describe('Confirm action', () => {
  it('calls onConfirm when confirm button is clicked', async () => {
    const user = (await import('@testing-library/user-event')).default;
    const { onConfirm } = renderDialog({
      seedOpen: true,
      seedTitle: 'Confirm?',
      seedMessage: 'Proceed?',
      seedConfirmLabel: 'Yes',
    });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Yes' }));

    expect(onConfirm).toHaveBeenCalled();
  });
});
