/**
 * Toast.tsx — Toast notification container.
 *
 * Phase 5c: reads state.toasts[] from context, renders each toast with
 *           auto-dismiss (3s). Error toasts get the .err class.
 *           Callers only dispatch ADD_TOAST — cleanup is centralized here.
 */

import { useEffect } from 'react';
import { useAppState, useAppDispatch } from '../state/AppContext.js';

export default function ToastContainer() {
  const { toasts } = useAppState();

  return (
    <div id="toast-container" aria-live="assertive" aria-atomic="true">
      {toasts.map(t => (
        <ToastItem key={t.id} id={t.id} message={t.message} isError={t.isError} />
      ))}
    </div>
  );
}

function ToastItem({ id, message, isError }: { id: string; message: string; isError?: boolean }) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: 'REMOVE_TOAST', id });
    }, 3000);
    return () => clearTimeout(timer);
  }, [id, dispatch]);

  return (
    <div className={`toast${isError ? ' err' : ''}`} role="alert">
      {message}
    </div>
  );
}
