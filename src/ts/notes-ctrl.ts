/**
 * notes-ctrl.ts — notes controller
 *
 * Handles creating, opening, saving, deleting, renaming, and listing notes.
 * Owns note-list state (all notes, search query, filtering).
 * Receives a getCurrentId callback from app.ts for UI highlighting.
 * Editor state (current, content, dirty) is owned by app.ts.
 */

import * as ui    from './ui.js';
import * as modal from './modal.js';
import * as notes from './notes.js';
import type { NoteData, NoteMeta } from './notes.js';
import { safeName } from './utils.js';

// ── Note list state ──────────────────────────────────────────────────────────

let _allNotes: NoteMeta[] = [];
let _query = '';

/** Callback provided by app.ts — returns the currently open note ID. */
let _getCurrentId: () => string | null = () => null;

/** Set the callback for querying the current note ID. Called once by app.ts. */
export function init(getCurrentId: () => string | null): void {
  _getCurrentId = getCurrentId;
}

// ── Filtering ────────────────────────────────────────────────────────────────

function applyFilter(): NoteMeta[] {
  return _query
    ? _allNotes.filter(n => n.id.toLowerCase().includes(_query))
    : [..._allNotes];
}

// ── Note list ────────────────────────────────────────────────────────────────

export async function refreshList(selectId: string | null = null): Promise<void> {
  try {
    _allNotes = await notes.listNotes();
    const filtered = applyFilter();
    ui.renderNoteList(filtered, _getCurrentId());
    ui.updateNoteCount(_allNotes.length, filtered.length);
    if (selectId) await openNote(selectId);
  } catch (err) {
    ui.toast(`Failed to load notes: ${(err as Error).message}`, true);
  }
}

export async function openNote(id: string): Promise<NoteData> {
  // Dirty check is handled by app.ts before calling this.
  const data: NoteData = await notes.loadNote(id);
  ui.showEditor(data);
  ui.setActiveNote(id);
  ui.setDirty(false);
  ui.setStatus(`Opened "${id}"`);
  return data;
}

export async function saveNote(id: string): Promise<void> {
  const content = ui.flushAndGetContent();
  await notes.saveNote(id, content);
  ui.setDirty(false);
  ui.setStatus(`Saved "${id}"`);
  ui.toast(`Saved "${id}"`);
}

export async function deleteNote(id: string): Promise<{ wasCurrent: boolean }> {
  if (!confirm(`Move "${id}" to trash?`)) return { wasCurrent: false };
  await notes.deleteNote(id);
  const wasCurrent = _getCurrentId() === id;
  if (wasCurrent) ui.hideEditor();
  await refreshList();
  ui.setStatus(`Deleted "${id}"`);
  ui.toast(`Deleted "${id}"`);
  return { wasCurrent };
}

export async function handleRename(id: string): Promise<void> {
  modal.openRenameModal(id);
}

export async function handleRenameConfirm(oldId: string): Promise<void> {
  const raw = modal.getModalValue();
  if (!raw) { modal.setModalError('Please enter a name.'); return; }
  const newId = safeName(raw);
  if (!newId) { modal.setModalError('Name contains no valid characters.'); return; }
  if (newId === oldId) { modal.closeModal(); return; }
  try {
    await notes.renameNote(oldId, newId);
    modal.closeModal();
    await refreshList(newId);
    ui.toast(`Renamed to "${newId}"`);
  } catch (err) {
    modal.setModalError((err as Error).message || 'Could not rename note.');
  }
}

export async function createNote(): Promise<void> {
  const raw = modal.getModalValue();
  if (!raw) { modal.setModalError('Please enter a name.'); return; }
  const name = safeName(raw);
  if (!name) { modal.setModalError('Name contains no valid characters.'); return; }
  modal.setModalHint(`Will be saved as: ${name}`);
  try {
    const data = await notes.createNote(name);
    modal.closeModal();
    ui.clearSearch();
    await refreshList(data.file);
    ui.toast(`Created "${data.file}"`);
  } catch (err) {
    modal.setModalError((err as Error).message || 'Could not create note.');
  }
}

export function handleSearch(query: string): void {
  _query = query.toLowerCase().trim();
  const filtered = applyFilter();
  ui.renderNoteList(filtered, _getCurrentId());
  ui.updateNoteCount(_allNotes.length, filtered.length);
}
