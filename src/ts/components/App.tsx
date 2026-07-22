/**
 * App.tsx — Root application component.
 *
 * Phase 3: wired Sidebar with resizer, note tree, search, mode switching,
 *          header menu, context menu, modal (with path-prefix + search pre-fill).
 */

import { useCallback, useEffect, useMemo } from 'react';
import { AppProvider, useAppDispatch, useAppState } from '../state/AppContext.js';
import { useResizer } from '../hooks/useResizer.js';
import { useAuth } from '../hooks/useAuth.js';
import { onAuthFailure } from '../auth.js';
import { useNotes } from '../hooks/useNotes.js';
import { useChangeBus } from '../hooks/useChangeBus.js';
import { useNoteHistory } from '../hooks/useNoteHistory.js';
import { useHotkeys } from '../hooks/useHotkeys.js';
import { useAutoSave } from '../hooks/useAutoSave.js';
import { useEditTime } from '../hooks/useEditTime.js';
import { useConfirmDialog } from '../hooks/useConfirm.js';
import { fetchSpaConfig, getSpaConfig, isAuthEnabled } from '../config.js';
import Header from './Header.js';
import Sidebar from './Sidebar.js';
import EditorWrap from './EditorWrap.js';
import StatusBar from './StatusBar.js';
import Modal from './Modal.js';
import ConfirmDialog from './ConfirmDialog.js';
import LoginScreen from './LoginScreen.js';
import ToastContainer from './Toast.js';
import ImageEditor from './ImageEditor.js';

function AppContent() {
  const dispatch = useAppDispatch();
  const state = useAppState();
  const { logout, restoreSession, showLogin } = useAuth();
  const { onMouseDown: onResizerMouseDown } = useResizer();
  const { refreshList, createNote, renameNote: renameNoteFn, loadNote } = useNotes();

  // ── Boot ──
  useEffect(() => {
    // Fetch server config, then activate configured markdown plugins
    // (wikilinks, tasklists, highlight, inline-extras, toc, etc.)
    // Lazy-import loadPlugins so markdown-it stays code-split.
    fetchSpaConfig()
      .then(() => {
        const cfg = getSpaConfig();
        if (cfg.markdown?.plugins?.length) {
          return import('../markdown.js').then(m =>
            m.loadPlugins(cfg.markdown!.plugins!)
          );
        }
      })
      .catch(err => console.warn('[boot] Plugin loading failed:', err))
      .finally(async () => {
        await refreshList().catch(err => console.warn('[boot] Failed to load notes:', err));
        // Session restore — try to auto-login from refresh cookie
        const result = await restoreSession();
        if (result === 'auth-failed' && navigator.onLine) {
          showLogin();
        }
        // network-error → stay offline, sign-in button visible
      });
    import('../pwa.js').then(m => m.initPwa().catch(() => {}));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Register auth-failure listener — shows login on 401 mid-session
  useEffect(() => {
    return onAuthFailure(showLogin);
  }, [showLogin]);

  useChangeBus();
  useNoteHistory();
  useHotkeys();
  useAutoSave();
  useEditTime();

  // ── Confirm dialog ──
  const { handleConfirm, handleCancel } = useConfirmDialog();

  // ── Modal ──

  const handleOpenModal = useCallback((mode: 'create' | 'rename', noteId?: string, searchValue?: string) => {
    dispatch({ type: 'SET_MODAL', open: true, mode, noteId, searchValue });
  }, [dispatch]);

  const handleModalClose = useCallback(() => {
    dispatch({ type: 'SET_MODAL', open: false, mode: 'create' });
  }, [dispatch]);

  const handleModalSubmit = useCallback(async (value: string) => {
    if (state.modal.mode === 'rename' && state.modal.noteId) {
      await renameNoteFn(state.modal.noteId, value);
    } else {
      await createNote(value, '');
      try { await loadNote(value); } catch { /* may not exist */ }
    }
    dispatch({ type: 'SET_MODAL', open: false, mode: 'create' });
  }, [state.modal, createNote, renameNoteFn, loadNote, dispatch]);

  // Compute default value for create modal: path prefix + search value
  const modalDefaultValue = useMemo(() => {
    if (state.modal.mode !== 'create') return '';
    const sv = state.modal.searchValue || '';
    let prefix = '';
    if (state.activeNoteId) {
      const lastColon = state.activeNoteId.lastIndexOf(':');
      if (lastColon !== -1) {
        prefix = state.activeNoteId.substring(0, lastColon + 1);
      }
    }
    return prefix + sv;
  }, [state.modal.mode, state.modal.searchValue, state.activeNoteId]);

  const handleLogout = useCallback(async () => {
    await logout();
  }, [logout]);

  return (
    <>
      <Header />
      <div id="main">
        <Sidebar
          onOpenModal={handleOpenModal}
          onLogout={handleLogout}
          onResetDB={() => {}}
        />
        <div id="sidebar-resizer" aria-hidden="true" onMouseDown={onResizerMouseDown} />
        <EditorWrap />
      </div>
      <StatusBar />
      <Modal
        open={state.modal.open}
        mode={state.modal.mode}
        noteId={state.modal.noteId}
        defaultValue={modalDefaultValue}
        onClose={handleModalClose}
        onSubmit={handleModalSubmit}
      />
      <ConfirmDialog
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
      <LoginScreen />
      <ToastContainer />
      <ImageEditor />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
