/**
 * D1a — Toast component tests
 *
 * Tests the toast notification container: render, auto-dismiss via
 * setTimeout, error variant class, and empty/no-toasts state.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, waitFor, act } from './test-utils.js';
import { useAppDispatch } from '../../src/ts/state/AppContext.js';

import ToastContainer from '../../src/ts/components/Toast.js';

/* ========================================================================
   1. Empty state
   ======================================================================== */

describe('Empty state', () => {
  it('renders container with aria-live but no toasts when none exist', () => {
    renderWithProviders(<ToastContainer />);
    const container = document.getElementById('toast-container');
    expect(container).toBeInTheDocument();
    expect(container).toHaveAttribute('aria-live', 'assertive');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/* ========================================================================
   2. Toast render
   ======================================================================== */

describe('Toast render', () => {
  it('shows toast with message when ADD_TOAST is dispatched', () => {
    function SeedWrapper() {
      const dispatch = useAppDispatch();
      useEffect(() => {
        dispatch({ type: 'ADD_TOAST', id: 't1', message: 'Note saved' });
      }, []);
      return <ToastContainer />;
    }

    renderWithProviders(<SeedWrapper />);

    const toast = screen.getByRole('alert');
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveTextContent('Note saved');
    expect(toast.classList.contains('toast')).toBe(true);
  });

  it('renders toast with .err class when isError is true', () => {
    function SeedWrapper() {
      const dispatch = useAppDispatch();
      useEffect(() => {
        dispatch({ type: 'ADD_TOAST', id: 't2', message: 'Save failed', isError: true });
      }, []);
      return <ToastContainer />;
    }

    renderWithProviders(<SeedWrapper />);

    const toast = screen.getByRole('alert');
    expect(toast.classList.contains('err')).toBe(true);
  });

  it('renders multiple toasts simultaneously', () => {
    function SeedWrapper() {
      const dispatch = useAppDispatch();
      useEffect(() => {
        dispatch({ type: 'ADD_TOAST', id: 't1', message: 'Saved note1' });
        dispatch({ type: 'ADD_TOAST', id: 't2', message: 'Error', isError: true });
      }, []);
      return <ToastContainer />;
    }

    renderWithProviders(<SeedWrapper />);

    const toasts = screen.getAllByRole('alert');
    expect(toasts).toHaveLength(2);
    expect(toasts[0]).toHaveTextContent('Saved note1');
    expect(toasts[0].classList.contains('err')).toBe(false);
    expect(toasts[1]).toHaveTextContent('Error');
    expect(toasts[1].classList.contains('err')).toBe(true);
  });
});

/* ========================================================================
   3. Auto-dismiss
   ======================================================================== */

describe('Auto-dismiss', () => {
  it('removes toast after 3000ms', async () => {
    function SeedWrapper() {
      const dispatch = useAppDispatch();
      useEffect(() => {
        dispatch({ type: 'ADD_TOAST', id: 't-vanish', message: 'Will disappear' });
      }, []);
      return <ToastContainer />;
    }

    vi.useFakeTimers();
    renderWithProviders(<SeedWrapper />);

    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Advance past the 3000ms setTimeout in ToastItem's useEffect
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Switch back to real timers so React/waitFor can process the re-render
    vi.useRealTimers();

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('clears timeout on unmount (no leak)', () => {
    const clearSpy = vi.spyOn(window, 'clearTimeout');

    function SeedWrapper() {
      const dispatch = useAppDispatch();
      useEffect(() => {
        dispatch({ type: 'ADD_TOAST', id: 't-clean', message: 'x' });
      }, []);
      return <ToastContainer />;
    }

    const { unmount } = renderWithProviders(<SeedWrapper />);
    unmount();

    // useEffect cleanup should have cleared the pending 3s timeout
    expect(clearSpy).toHaveBeenCalled();

    clearSpy.mockRestore();
  });
});
