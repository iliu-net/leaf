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
import type { NoteData, NoteMeta, FullTextResult } from './notes.js';
import { safeName } from './utils.js';
import { listSystemNotes } from './system-notes/registry.js';
import { DOM, $maybe } from './dom-ids.js';
import { renderSystemSection, renderFullTextResults, renderTagList, getMode, getView } from './sidebar.js';
import { dbGetNote } from './db.js';
import { parseFrontmatter } from './frontmatter.js';
import { mergeTags } from './autotag.js';
import type { TagViewItem } from './tag-view.js';
import { setSearchHighlight } from './markdown-view.js';

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
    renderSystemSection();
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
  // In tags mode, delegate filtering to the TagView (client-side filter)
  if (getMode() === 'tags') {
    _query = query.toLowerCase().trim();
    getView()?.setFilter?.(_query);
    return;
  }

  _query = query.toLowerCase().trim();
  const userFiltered = applyFilter();

  if (_query) {
    // Search active → merge system notes into flat results
    const sysMatches = listSystemNotes()
      .filter(d => d.id.toLowerCase().includes(_query) || d.label.toLowerCase().includes(_query))
      .map(d => ({
        id: d.id,
        created_at: 0,
        updated_at: 0,
        current: '',
      }));
    const merged = [...userFiltered, ...sysMatches]
      .sort((a, b) => a.id.localeCompare(b.id));
    ui.renderNoteList(merged, _getCurrentId());
    ui.updateNoteCount(_allNotes.length, merged.length);

    // Hide system section during search
    const sysSection = $maybe(DOM.SYSTEM_NOTES_SECTION);
    if (sysSection) sysSection.style.display = 'none';
  } else {
    // Search cleared → restore separate sections
    ui.renderNoteList(userFiltered, _getCurrentId());
    ui.updateNoteCount(_allNotes.length, userFiltered.length);
    renderSystemSection();
    setSearchHighlight(null);
  }
}

/**
 * Full-text search: scan all active notes' content for the query.
 * Called when the user presses Enter in the search box.
 */
export async function handleFullTextSearch(query: string): Promise<void> {
  const q = query.trim();
  if (!q) return;

  _query = q.toLowerCase();

  try {
    const results: FullTextResult[] = await notes.fullTextSearch(q);
    renderFullTextResults(results, _getCurrentId());
    ui.updateNoteCount(_allNotes.length, results.length);
    setSearchHighlight(q);

    // Hide system section during search
    const sysSection = $maybe(DOM.SYSTEM_NOTES_SECTION);
    if (sysSection) sysSection.style.display = 'none';

    if (results.length === 0) {
      ui.setStatus(`No results for "${q}"`, 3000);
    } else {
      ui.setStatus(`${results.length} result${results.length !== 1 ? 's' : ''} for "${q}"`);
    }
  } catch (err) {
    ui.toast(`Full-text search failed: ${(err as Error).message}`, true);
  }
}

// ── Tags mode ──────────────────────────────────────────────────────────────

/**
 * Load all notes with their merged tags and render the tag view.
 */
export async function refreshTagList(): Promise<void> {
  const allNotes = await notes.listNotes();
  const items: TagViewItem[] = [];

  for (const meta of allNotes) {
    const record = await dbGetNote(meta.id);
    if (!record || !record.content) {
      items.push({ ...meta, tags: [] });
      continue;
    }
    const fm = parseFrontmatter(record.content);
    const userTags: string[] = Array.isArray(fm.meta['user-tags']) ? fm.meta['user-tags'] : [];
    const autoTags: string[] = Array.isArray(fm.meta['auto-tags']) ? fm.meta['auto-tags'] : [];
    const tags = mergeTags(userTags, autoTags);
    items.push({ ...meta, tags });
  }

  renderTagList(items, _getCurrentId());
  ui.updateNoteCount(allNotes.length, allNotes.length);
}

/**
 * Toggle between notes mode and tags mode.
 */
export async function handleToggleTags(): Promise<void> {
  if (getMode() === 'tags') {
    ui.setMode('notes');
    await refreshList();
  } else {
    ui.setMode('tags');
    await refreshTagList();
  }
}
