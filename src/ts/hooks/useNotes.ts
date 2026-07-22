/**
 * useNotes.ts — Hook wrapping the notes data layer.
 *
 * Calls the existing notes.ts module directly for all data operations.
 * After each mutation, dispatches to the reducer to keep React state in sync.
 *
 * Phase 2: hook exists, can be called manually.
 * Phase 3-4: wired to Sidebar and Editor components.
 */

import { useAppDispatch, useAppState } from '../state/AppContext.js';
import * as notes from '../notes.js';
import { isSystemNote } from '../notes.js';
import type { NoteData } from '../notes.js';
import { useConfirm } from './useConfirm.js';

export function useNotes() {
  const dispatch = useAppDispatch();
  const state = useAppState();
  const { confirm } = useConfirm();

  return {
    /** Current list of note metadata (for sidebar). */
    noteList: state.notes,
    /** Currently open note ID. */
    activeNoteId: state.activeNoteId,
    /** Currently open note content. */
    activeNoteContent: state.activeNoteContent,

    /**
     * Load the note list from IndexedDB and update React state.
     * Call on boot and after any mutation that changes the list.
     */
    async refreshList(): Promise<void> {
      const list = await notes.listNotes();
      dispatch({ type: 'NOTES_LOADED', notes: list });
    },

    /**
     * Load a single note's full content and mark it as the active note.
     * Call when clicking a note in the sidebar or navigating via history.
     */
    async loadNote(id: string): Promise<NoteData> {
      const data = await notes.loadNote(id);
      dispatch({
        type: 'NOTE_SELECTED',
        id: data.id,
        content: data.content,
        isSystemNote: isSystemNote(data.id),
        noteData: {
          created_at: data.created_at,
          updated_at: data.updated_at,
          current: data.current,
          created_by: data.created_by,
          updated_by: data.updated_by,
          meta: data.meta,
        },
      });
      return data;
    },

    /**
     * Save note content to IndexedDB.
     * The reducer only marks isDirty=false; the caller is responsible for
     * providing the content (which may include auto-merged edit-time).
     */
    async saveNote(id: string, content: string): Promise<void> {
      await notes.saveNote(id, content);
      dispatch({ type: 'NOTE_SAVED' });
    },

    /**
     * Create a new note (empty content) and return its ID.
     * Does NOT open the modal — that's UI orchestration handled later.
     */
    async createNote(id: string, content: string): Promise<void> {
      await notes.saveNote(id, content);
      // Refresh the list so the sidebar picks up the new note
      const list = await notes.listNotes();
      dispatch({ type: 'NOTES_LOADED', notes: list });
    },

    /**
     * Delete a note (soft-delete → trash) after confirmation.
     * Returns whether the deleted note was the currently open one.
     */
    async deleteNote(id: string): Promise<{ wasCurrent: boolean }> {
      const ok = await confirm({
        title: 'Delete note',
        message: `Move "${id}" to trash?`,
        confirmLabel: 'Move to trash',
        variant: 'danger',
      });
      if (!ok) return { wasCurrent: false };
      const wasCurrent = id === state.activeNoteId;
      await notes.deleteNote(id);
      if (wasCurrent) {
        dispatch({ type: 'CLEAR_EDITOR' });
      }
      const list = await notes.listNotes();
      dispatch({ type: 'NOTES_LOADED', notes: list });
      return { wasCurrent };
    },

    /**
     * Rename a note (data layer — commits to IndexedDB, publishes event).
     * Call AFTER the user confirms the new name in the modal.
     */
    async renameNote(oldId: string, newId: string): Promise<void> {
      if (newId === oldId) return;
      await notes.renameNote(oldId, newId);
      if (state.activeNoteId === oldId) {
        dispatch({ type: 'CLEAR_EDITOR' });
      }
      const list = await notes.listNotes();
      dispatch({ type: 'NOTES_LOADED', notes: list });
    },

    /**
     * Search across all notes' content.
     * Returns results from the data layer; does not dispatch.
     */
    async fullTextSearch(query: string) {
      return notes.fullTextSearch(query);
    },

    /** Mark content as changed (on every keystroke). */
    setContent(content: string): void {
      dispatch({ type: 'NOTE_CONTENT_CHANGED', content });
    },

    /** Clear the editor (no note open). */
    clearEditor(): void {
      dispatch({ type: 'CLEAR_EDITOR' });
    },
  };
}
