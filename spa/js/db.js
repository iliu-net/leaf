/**
 * db.js — Dexie database setup
 *
 * Two tables:
 *
 *   notes — the primary data store, one record per note
 *   {
 *     id:         string   — note identifier
 *     content:    string   — full raw text including frontmatter (opaque)
 *     created_at: number   — unix timestamp ms, set once on CREATE
 *     updated_at: number   — unix timestamp ms, updated on every save
 *     deleted:    0 | 1    — soft delete flag
 *   }
 *
 *   queue — pending changes waiting to be pushed to the server
 *   {
 *     seq:     number   — auto-increment, determines push order
 *     type:    string   — 'CREATE' | 'UPDATE' | 'DELETE'
 *     id:      string   — note id this change applies to
 *     content: string   — note content at time of change (null for DELETE)
 *     status:  string   — 'pending' | 'sent'
 *   }
 *
 * Dexie is a plain UMD global loaded via <script> tag in index.html.
 * No addons required.
 */

const { Dexie } = window;

if (!Dexie) {
  throw new Error('[db] Dexie not found — check <script> tag in index.html.');
}

export const db = new Dexie('notes-app');

db.version(1).stores({
  notes: 'id, updated_at, deleted',
  queue: '++seq, status',
});

// ── Notes helpers ─────────────────────────────────────────────────────────

/**
 * Return all live notes sorted by id, metadata only (no content).
 * @returns {Promise<Array<{id, created_at, updated_at}>>}
 */
export async function dbListNotes() {
  const notes = await db.notes.where('deleted').equals(0).toArray();
  notes.sort((a, b) => a.id.localeCompare(b.id));
  return notes.map(({ id, created_at, updated_at }) => ({ id, created_at, updated_at }));
}

/**
 * Return one live note record, or null if missing/deleted.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function dbGetNote(id) {
  const note = await db.notes.get(id);
  if (!note || note.deleted) return null;
  return note;
}

/**
 * Write or update a note record in IndexedDB.
 * Preserves created_at if the note already exists.
 * @param {string} id
 * @param {string} content
 */
export async function dbSaveNote(id, content) {
  const now      = Date.now();
  const existing = await db.notes.get(id);
  await db.notes.put({
    id,
    content,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted:    0,
  });
}

/**
 * Soft-delete a note (sets deleted=1).
 * @param {string} id
 */
export async function dbDeleteNote(id) {
  const existing = await db.notes.get(id);
  if (!existing) return;
  await db.notes.put({ ...existing, deleted: 1, updated_at: Date.now() });
}

/**
 * Create a new empty note if it doesn't already exist.
 * @param {string} id
 */
export async function dbCreateNote(id) {
  const existing = await db.notes.get(id);
  if (existing) return;
  const now = Date.now();
  await db.notes.put({ id, content: '', created_at: now, updated_at: now, deleted: 0 });
}

/**
 * Apply a change received from the server into the local notes table.
 * Does not touch the queue — server changes are not re-queued.
 * @param {'CREATE'|'UPDATE'|'DELETE'} type
 * @param {string} id
 * @param {string|null} content
 */
export async function dbApplyServerChange(type, id, content) {
  if (type === 'DELETE') {
    const existing = await db.notes.get(id);
    if (existing) {
      await db.notes.put({ ...existing, deleted: 1, updated_at: Date.now() });
    }
    return;
  }
  // CREATE or UPDATE
  const existing = await db.notes.get(id);
  await db.notes.put({
    id,
    content:    content ?? '',
    created_at: existing?.created_at ?? Date.now(),
    updated_at: Date.now(),
    deleted:    0,
  });
}

// ── Queue helpers ─────────────────────────────────────────────────────────

/**
 * Add a change to the outbound queue.
 * For UPDATE/CREATE, collapses any existing pending entry for the same note
 * so we never push stale intermediate versions.
 * @param {'CREATE'|'UPDATE'|'DELETE'} type
 * @param {string} id
 * @param {string|null} content
 */
export async function queueChange(type, id, content = null) {
  if (type === 'UPDATE' || type === 'CREATE') {
    // Remove any pending (unsent) entry for this note to avoid redundant pushes
    await db.queue
      .where('status').equals('pending')
      .filter(e => e.id === id)
      .delete();
  }
  await db.queue.add({ type, id, content, status: 'pending' });
}

/**
 * Return all pending queue entries in insertion order.
 * @returns {Promise<Array>}
 */
export async function queueGetPending() {
  return db.queue.where('status').equals('pending').sortBy('seq');
}

/**
 * Mark a queue entry as sent (will be cleaned up later).
 * @param {number} seq
 */
export async function queueMarkSent(seq) {
  await db.queue.update(seq, { status: 'sent' });
}

/**
 * Remove all sent entries — called after a successful push+pull cycle.
 */
export async function queuePruneSent() {
  await db.queue.where('status').equals('sent').delete();
}
