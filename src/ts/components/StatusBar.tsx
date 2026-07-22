/**
 * StatusBar.tsx — Bottom status bar.
 *
 * Phase 5d: wired status message, offline badge, sync indicator.
 */

import { useEffect } from 'react';
import { useAppState, useAppDispatch } from '../state/AppContext.js';
import { onSyncStatus } from '../sync.js';

export default function StatusBar() {
  const { status, isOffline, syncStatus } = useAppState();
  const dispatch = useAppDispatch();

  // ── Online / offline → SET_OFFLINE ──
  useEffect(() => {
    const goOnline = () => dispatch({ type: 'SET_OFFLINE', isOffline: false });
    const goOffline = () => dispatch({ type: 'SET_OFFLINE', isOffline: true });
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [dispatch]);

  // ── Sync status bus → SET_SYNC_STATUS + SET_OFFLINE ──
  useEffect(() => {
    return onSyncStatus((statusText, isOnline) => {
      dispatch({ type: 'SET_SYNC_STATUS', status: statusText });
      dispatch({ type: 'SET_OFFLINE', isOffline: !isOnline });
      if (statusText === 'SYNCING') {
        dispatch({ type: 'SET_STATUS', status: 'Syncing…' });
      } else {
        // Clear the syncing message once sync completes, errors, or goes offline.
        // Other transient messages (e.g. "Saved …") may overwrite this later.
        dispatch({ type: 'SET_STATUS', status: '' });
      }
    });
  }, [dispatch]);

  // ── Render ──
  return (
    <div id="statusbar" role="status" aria-live="polite">
      <span id="status-msg">{status}</span>
      <span id="app-version" className="status-item muted">{__APP_VERSION__}</span>
      {isOffline && (
        <span id="offline-badge" className="status-item visible">offline</span>
      )}
      <span id="sync-status" className="status-item">{syncStatus}</span>
    </div>
  );
}
