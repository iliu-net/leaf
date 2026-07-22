/**
 * useConfirm.ts — Promise-based confirm dialog hook.
 *
 * Phase 6f: replaces window.confirm() with a styled Radix Dialog.
 *   - confirm(opts) returns Promise<boolean> — true = confirmed, false = cancelled.
 *   - Callbacks held in a ref (not in state) so they close over the caller's scope.
 */

import { useCallback } from 'react';
import { useAppDispatch } from '../state/AppContext.js';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'default';
}

/** Module-level ref — shared across all callers so App.tsx and useNotes
 *  can communicate through the same Promise resolver. */
let _resolver: ((result: boolean) => void) | null = null;

/** Call from the component that renders <ConfirmDialog>. */
export function useConfirmDialog() {
  const dispatch = useAppDispatch();

  const handleConfirm = useCallback(() => {
    _resolver?.(true);
    _resolver = null;
    dispatch({ type: 'HIDE_CONFIRM' });
  }, [dispatch]);

  const handleCancel = useCallback(() => {
    _resolver?.(false);
    _resolver = null;
    dispatch({ type: 'HIDE_CONFIRM' });
  }, [dispatch]);

  return { handleConfirm, handleCancel };
}

/** Call from anywhere that needs to show a confirm dialog. */
export function useConfirm() {
  const dispatch = useAppDispatch();

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      _resolver = resolve;
      dispatch({
        type: 'SHOW_CONFIRM',
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel || 'Confirm',
        variant: opts.variant || 'default',
      });
    });
  }, [dispatch]);

  return { confirm };
}
