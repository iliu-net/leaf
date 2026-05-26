/**
 * app-files.ts — note CRUD and file-list operations
 *
 * Extracted from app.ts.  Receives core dependencies via factory function
 * so the module is testable and avoids circular imports with app.ts.
 */

import { safeName } from './utils.js';
import type { NoteData } from './notes.js';

export interface FileOpsDeps {
  store: typeof import('./store.js');
  ui: typeof import('./ui.js');
  notes: typeof import('./notes.js');
  syncNow: () => void;
}

export function createFileOps(deps: FileOpsDeps) {
  const { store, ui, notes, syncNow } = deps;

  async function refreshList(selectId: string | null = null): Promise<void> {
    try {
      const items = await notes.listNotes();
      store.setNotes(items);
      ui.renderFileList(store.getNotes(), store.getCurrent());
      ui.updateNoteCount(store.getState().notes.length, store.getNotes().length);
      if (selectId) await openFile(selectId);
    } catch (err) {
      ui.toast(`Failed to load notes: ${(err as Error).message}`, true);
    }
  }

  async function openFile(id: string): Promise<void> {
    if (store.isDirty() && !confirm('You have unsaved changes. Discard?')) return;
    try {
      const data: NoteData = await notes.loadNote(id);
      store.openNote(id, data.content);
      ui.showEditor(data);
      ui.setActiveFile(id);
      ui.setDirty(false);
      ui.setStatus(`Opened "${id}"`);
    } catch (err) {
      ui.toast(`Could not open "${id}": ${(err as Error).message}`, true);
    }
  }

  async function saveFile(): Promise<void> {
    const id = store.getCurrent();
    if (!id) return;
    const content = ui.flushAndGetContent();
    try {
      await notes.saveNote(id, content);
      store.markClean();
      ui.setDirty(false);
      ui.setStatus(`Saved "${id}"`);
      ui.toast(`Saved "${id}"`);
      syncNow();
    } catch (err) {
      ui.toast(`Save failed: ${(err as Error).message}`, true);
    }
  }

  async function deleteFile(id: string): Promise<void> {
    if (!confirm(`Move "${id}" to trash?`)) return;
    try {
      await notes.deleteNote(id);
      if (store.getCurrent() === id) {
        store.closeNote();
        ui.hideEditor();
      }
      await refreshList();
      ui.setStatus(`Deleted "${id}"`);
      ui.toast(`Deleted "${id}"`);
      syncNow();
    } catch (err) {
      ui.toast(`Delete failed: ${(err as Error).message}`, true);
    }
  }

  async function handleRenameClick(id: string): Promise<void> {
    ui.openRenameModal(id);
  }

  async function handleRenameConfirm(oldId: string): Promise<void> {
    const raw = ui.getModalValue();
    if (!raw) { ui.setModalError('Please enter a name.'); return; }
    const newId = safeName(raw);
    if (!newId) { ui.setModalError('Name contains no valid characters.'); return; }
    if (newId === oldId) { ui.closeModal(); return; }
    try {
      await notes.renameNote(oldId, newId);
      ui.closeModal();
      await refreshList(newId);
      ui.toast(`Renamed to "${newId}"`);
      syncNow();
    } catch (err) {
      ui.setModalError((err as Error).message || 'Could not rename note.');
    }
  }

  async function createFile(): Promise<void> {
    const raw = ui.getModalValue();
    if (!raw) { ui.setModalError('Please enter a name.'); return; }
    const name = safeName(raw);
    if (!name) { ui.setModalError('Name contains no valid characters.'); return; }
    ui.setModalHint(`Will be saved as: ${name}`);
    try {
      const data = await notes.createNote(name);
      ui.closeModal();
      ui.clearSearch();
      await refreshList(data.file);
      ui.toast(`Created "${data.file}"`);
      syncNow();
    } catch (err) {
      ui.setModalError((err as Error).message || 'Could not create note.');
    }
  }

  function handleSearch(query: string): void {
    store.setQuery(query);
    const filtered = store.getNotes();
    ui.renderFileList(filtered, store.getCurrent());
    ui.updateNoteCount(store.getState().notes.length, filtered.length);
  }

  return {
    refreshList,
    openFile,
    saveFile,
    deleteFile,
    createFile,
    handleRenameClick,
    handleRenameConfirm,
    handleSearch,
  };
}
