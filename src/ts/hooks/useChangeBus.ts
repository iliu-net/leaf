/**
 * useChangeBus.ts — Hook subscribing to the change-bus for cross-tab/sync events.
 *
 * On mount, subscribes to change-bus events (notes created/deleted/renamed
 * in other tabs, or server-sync events).  Dispatches the appropriate
 * reducer actions to keep React state in sync.
 *
 * On unmount, unsubscribes.
 *
 * Phase 2: hook exists, can be called manually.
 * Phase 3-5: wired in the boot sequence (App.tsx or a top-level effect).
 */

import { useEffect } from 'react';
import { subscribe } from '../change-bus.js';
import type { ChangeEvent } from '../change-bus.js';
import { useAppDispatch, useAppState } from '../state/AppContext.js';
import * as notes from '../notes.js';
import { handleChange } from '../change-handler.js';
import type { ChangeHandlerDeps } from '../change-handler.js';
import { stripFrontmatterKey } from '../frontmatter.js';
import { loadMergedTrashEntries } from './useTrash.js';

/**
 * Subscribe to change-bus events and keep React state in sync.
 *
 * For cross-tab/sync events that affect the currently open note, reloads
 * the note and dispatches NOTE_SELECTED.  For list-level changes (add,
 * delete, rename), refreshes the note list and/or trash list.
 */
export function useChangeBus() {
  const dispatch = useAppDispatch();
  const state = useAppState();

  useEffect(() => {
    const unsub = subscribe(async (event: ChangeEvent) => {
      // Helper: reload the currently active note from IndexedDB and
      // dispatch NOTE_SELECTED if its content differs from React state.
      async function reloadCurrentNoteIfChanged() {
        if (!state.activeNoteId) return;
        try {
          const data = await notes.loadNote(state.activeNoteId);
          if (stripFrontmatterKey(data.content, 'edit-time') !==
              stripFrontmatterKey(state.activeNoteContent ?? '', 'edit-time')) {
            dispatch({
              type: 'NOTE_SELECTED',
              id: data.id,
              content: data.content,
              isSystemNote: notes.isSystemNote(data.id),
              noteData: {
                created_at: data.created_at,
                updated_at: data.updated_at,
                current: data.current,
                created_by: data.created_by,
                updated_by: data.updated_by,
                meta: data.meta,
              },
            });
          }
        } catch {
          // Note may have been deleted — clear editor
          if (state.activeNoteId) {
            dispatch({ type: 'CLEAR_EDITOR' });
          }
        }
      }

      switch (event.type) {
        case 'saved': {
          // If the saved note is the one currently open, reload it.
          if (event.id === state.activeNoteId) {
            await reloadCurrentNoteIfChanged();
          }
          // Always refresh the sidebar list.
          const list = await notes.listNotes();
          dispatch({ type: 'NOTES_LOADED', notes: list });
          break;
        }

        case 'server-sync': {
          // Server pull may have updated the currently viewed note.
          // Reload it unconditionally — we don't know which IDs changed.
          await reloadCurrentNoteIfChanged();
          // Always refresh the sidebar list.
          const list = await notes.listNotes();
          dispatch({ type: 'NOTES_LOADED', notes: list });
          break;
        }

        case 'created': {
          // New note created — refresh the list
          const list = await notes.listNotes();
          dispatch({ type: 'NOTES_LOADED', notes: list });
          break;
        }

        case 'deleted': {
          // If the deleted note is the one currently open, clear the editor.
          if (event.id === state.activeNoteId) {
            dispatch({ type: 'CLEAR_EDITOR' });
          }
          // Refresh both lists — a note may have been soft-deleted (→ trash)
          // or permanently purged (→ removed from trash).
          const list = await notes.listNotes();
          dispatch({ type: 'NOTES_LOADED', notes: list });
          const trashEntries = await loadMergedTrashEntries();
          dispatch({ type: 'TRASH_LOADED', trash: trashEntries });
          break;
        }

        case 'renamed': {
          // If the renamed note was open, clear the editor (the old ID is gone)
          if (event.id === state.activeNoteId) {
            dispatch({ type: 'CLEAR_EDITOR' });
          }
          // Refresh the list (the new note ID may have appeared)
          const list = await notes.listNotes();
          dispatch({ type: 'NOTES_LOADED', notes: list });
          break;
        }

        case 'restored':
        case 'trash-emptied': {
          // Trash state changed — refresh both note list and trash list.
          const list = await notes.listNotes();
          dispatch({ type: 'NOTES_LOADED', notes: list });
          const trashEntries = await loadMergedTrashEntries();
          dispatch({ type: 'TRASH_LOADED', trash: trashEntries });
          break;
        }
      }
    });

    return unsub;
  }, [state.activeNoteId, state.activeNoteContent, dispatch]);
}

/**
 * Build change-handler dependencies from current app state.
 * Used by the full change-handler when a note is modified by another tab.
 */
export function useChangeHandlerDeps(): ChangeHandlerDeps {
  const state = useAppState();
  const dispatch = useAppDispatch();

  return {
    currentId: state.activeNoteId,
    isTrashMode: state.sidebarMode === 'trash',
    reloadCurrentNote: async () => {
      if (!state.activeNoteId) return;
      try {
        const data = await notes.loadNote(state.activeNoteId);
        dispatch({
          type: 'NOTE_SELECTED',
          id: state.activeNoteId,
          content: data.content,
          isSystemNote: notes.isSystemNote(state.activeNoteId),
          noteData: {
            created_at: data.created_at,
            updated_at: data.updated_at,
            current: data.current,
            created_by: data.created_by,
            updated_by: data.updated_by,
            meta: data.meta,
          },
        });
      } catch {
        dispatch({ type: 'CLEAR_EDITOR' });
      }
    },
    reloadNoteAs: async (newId: string) => {
      try {
        const data = await notes.loadNote(newId);
        dispatch({
          type: 'NOTE_SELECTED',
          id: newId,
          content: data.content,
          isSystemNote: notes.isSystemNote(newId),
          noteData: {
            created_at: data.created_at,
            updated_at: data.updated_at,
            current: data.current,
            created_by: data.created_by,
            updated_by: data.updated_by,
            meta: data.meta,
          },
        });
      } catch {
        dispatch({ type: 'CLEAR_EDITOR' });
      }
    },
    editorNoteId: () => state.activeNoteId,
    refreshSidebar: async () => {
      const list = await notes.listNotes();
      dispatch({ type: 'NOTES_LOADED', notes: list });
    },
    refreshTrash: async () => {
      // Trash refresh is handled by the useTrash hook — this is a no-op here
      // since ChangeHandlerDeps needs this field for the legacy interface.
    },
    clearEditor: () => dispatch({ type: 'CLEAR_EDITOR' }),
    updateTrashCount: async () => {
      // Handled by useTrash hook
    },
    toast: (msg: string) => {
      const id = `toast-${Date.now()}`;
      dispatch({ type: 'ADD_TOAST', id, message: msg });
      // Auto-dismiss handled centrally by ToastItem useEffect.
    },
    setTrashCount: (_n: number) => {
      // Handled by useTrash hook
    },
    setActiveNote: (id: string) => {
      // The old ui.setActiveNote highlighted the sidebar item.
      // In React, this is derived from state.activeNoteId.
      // We dispatch a no-op that just ensures the ID is tracked.
    },
  };
}
