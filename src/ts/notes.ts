/**
 * notes.ts — data access layer
 *
 * All reads/writes go to IndexedDB first.
 * Every mutating operation also queues a change for sync.js to push.
 * The server is never called directly from here.
 */

import {
  dbListNotes,
  dbGetNote,
  dbSaveNote,
  dbDeleteNote,
  dbCreateNote,
  dbRenameNote,
  queueChange,
} from './db.js';
import type { NoteMeta } from './store.js';
import { updateFrontmatter, parseFrontmatter } from './frontmatter.js';
import type { FrontmatterResult } from './frontmatter.js';
import { getUsername } from './auth.js';
import { notifyLocalChange } from './cross-tab.js';

/**
 * Full note data returned by loadNote().
 * Merges IndexedDB record fields with parsed frontmatter.
 */
export interface NoteData {
  id: string;           // note id (filename)
  content: string;      // full raw content (frontmatter + body)
  created_at: number;   // from IndexedDB record
  updated_at: number;   // from IndexedDB record
  current: string;      // from IndexedDB record
  meta: FrontmatterResult['meta'];  // parsed frontmatter
}

/**
 * @returns Array of note metadata (id, timestamps)
 */
export async function listNotes(): Promise<NoteMeta[]> {
  return dbListNotes();
}

/**
 * Load a note's content by id.
 * @returns NoteData with content, DB fields, and parsed frontmatter
 */
export async function loadNote(id: string): Promise<NoteData> {
  const note = await dbGetNote(id);
  const content = note?.content ?? '';
  const fm = parseFrontmatter(content);
  return {
    id,
    content,
    created_at: note?.created_at ?? 0,
    updated_at: note?.updated_at ?? 0,
    current: note?.current ?? '',
    meta: fm.meta,
  };
}

/**
 * Save content to IndexedDB and queue an UPDATE for the server.
 */
export async function saveNote(id: string, content: string): Promise<{ ok: boolean }> {
  const note = await dbGetNote(id);
  const fmContent = updateFrontmatter(content, {
    updated_by: getUsername() ?? 'unknown',
  });
  await dbSaveNote(id, fmContent);
  await queueChange('UPDATE', id, fmContent, note?.current ?? 'local');
  notifyLocalChange('saved', id);
  return { ok: true };
}

/**
 * Create a new note in IndexedDB and queue a CREATE for the server.
 */
export async function createNote(id: string): Promise<{ ok: boolean; file: string }> {
  await dbCreateNote(id);

  // Write frontmatter with authorship info
  const fmContent = updateFrontmatter('', {
    created_by: getUsername() ?? 'unknown',
    updated_by: getUsername() ?? 'unknown',
  });
  await dbSaveNote(id, fmContent);

  const note = await dbGetNote(id);
  await queueChange('CREATE', id, fmContent, note?.current ?? 'local');
  notifyLocalChange('created', id);
  return { ok: true, file: id };
}

/**
 * Soft-delete in IndexedDB and queue a DELETE for the server.
 */
export async function deleteNote(id: string): Promise<{ ok: boolean }> {
  const note = await dbGetNote(id);
  await dbDeleteNote(id);
  await queueChange('DELETE', id, null, note?.current ?? 'local');
  notifyLocalChange('deleted', id);
  return { ok: true };
}

/**
 * Rename a note in IndexedDB and queue a RENAME for the server.
 */
export async function renameNote(oldId: string, newId: string): Promise<{ ok: boolean }> {
  const note = await dbGetNote(oldId);
  await dbRenameNote(oldId, newId);
  await queueChange('RENAME', oldId, null, note?.current ?? 'local', { renamed_to: newId });
  notifyLocalChange('renamed', oldId, newId);
  return { ok: true };
}
