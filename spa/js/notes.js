/**
 * notes.js — data access layer
 *
 * All reads/writes go to IndexedDB first.
 * Every mutating operation also queues a change for sync.js to push.
 * The server is never called directly from here.
 *
 * Function signatures are identical to the previous version so app.js
 * needs no changes.
 */

import {
  dbListNotes,
  dbGetNote,
  dbSaveNote,
  dbDeleteNote,
  dbCreateNote,
  queueChange,
} from './db.js';

/**
 * @returns {Promise<Array<{id, created_at, updated_at}>>}
 */
export async function listNotes() {
  return dbListNotes();
}

/**
 * @param {string} id
 * @returns {Promise<{content: string}>}
 */
export async function loadNote(id) {
  const note = await dbGetNote(id);
  return { content: note?.content ?? '' };
}

/**
 * Save content to IndexedDB and queue an UPDATE for the server.
 * @param {string} id
 * @param {string} content
 * @returns {Promise<{ok: boolean}>}
 */
export async function saveNote(id, content) {
  await dbSaveNote(id, content);
  await queueChange('UPDATE', id, content);
  return { ok: true };
}

/**
 * Create a new note in IndexedDB and queue a CREATE for the server.
 * @param {string} id
 * @returns {Promise<{ok: boolean, file: string}>}
 */
export async function createNote(id) {
  await dbCreateNote(id);
  await queueChange('CREATE', id, '');
  return { ok: true, file: id };
}

/**
 * Soft-delete in IndexedDB and queue a DELETE for the server.
 * @param {string} id
 * @returns {Promise<{ok: boolean}>}
 */
export async function deleteNote(id) {
  await dbDeleteNote(id);
  await queueChange('DELETE', id, null);
  return { ok: true };
}
