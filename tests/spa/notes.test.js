/**
 * Tests for src/ts/notes.ts — data access layer over db.ts.
 *
 * Uses the real db module with fake-indexeddb (set up in setup.js).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  listNotes, loadNote, saveNote, createNote, deleteNote, renameNote,
} from '../../src/ts/notes.ts';
import { db, queueGetPending, dbGetNote } from '../../src/ts/db.ts';
import '../../src/ts/sync.ts';  // registers change-bus → queueChange handler
import { flush } from '../../src/ts/change-bus.ts';

async function seedNote(id, content = '', extra = {}) {
  await db.notes.put({
    id, content, created_at: 1, updated_at: 1, deleted: 0,
    current: 'local', created_by: '', updated_by: '',
    ...extra,
  });
}

describe('notes.js integration', () => {
  it('listNotes returns all non-deleted notes', async () => {
    await seedNote('b', 'two');
    await seedNote('a', 'one');

    const list = await listNotes();
    expect(list.map(n => n.id)).toEqual(['a', 'b']);
  });

  it('listNotes returns empty array when no notes', async () => {
    const list = await listNotes();
    expect(list).toEqual([]);
  });

  it('loadNote returns content of an existing note', async () => {
    await seedNote('test', 'hello world');
    const result = await loadNote('test');
    expect(result.content).toBe('hello world');
  });

  it('loadNote returns empty content for missing note', async () => {
    const result = await loadNote('ghost');
    expect(result.content).toBe('');
  });

  it('saveNote persists content and queues an UPDATE', async () => {
    await seedNote('my-note', 'original');
    const result = await saveNote('my-note', 'updated content');

    expect(result.ok).toBe(true);
    // Content is saved as-is — no frontmatter injection (authorship is in NoteRecord fields)
    const note = await dbGetNote('my-note');
    expect(note.content).toBe('updated content');
    expect(note.updated_by).toBe('unknown');
    // Check queue — sync.ts handler creates queue entries asynchronously via change-bus
    await flush();
    const queue = await queueGetPending();
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('UPDATE');
    expect(queue[0].id).toBe('my-note');
    expect(queue[0].content).toBe('updated content');
    expect(queue[0].version).toBe('local');
  });

  it('saveNote creates the note record if it does not exist yet', async () => {
    await saveNote('brand-new', 'hello');
    const note = await dbGetNote('brand-new');
    // Content saved as-is, authorship in NoteRecord fields
    expect(note.content).toBe('hello');
    expect(note.created_by).toBe('unknown');
    expect(note.updated_by).toBe('unknown');
  });

  it('createNote creates a note and queues a CREATE', async () => {
    const result = await createNote('my-new-note');

    expect(result.ok).toBe(true);
    expect(result.file).toBe('my-new-note');

    const note = await dbGetNote('my-new-note');
    // Content is empty (no frontmatter injection); authorship in NoteRecord fields
    expect(note.content).toBe('');
    expect(note.created_by).toBe('unknown');
    expect(note.updated_by).toBe('unknown');

    await flush();
    const queue = await queueGetPending();
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('CREATE');
    expect(queue[0].id).toBe('my-new-note');
    expect(queue[0].content).toBe('');
    expect(queue[0].version).toBe('local');
  });

  it('createNote queues a CREATE even if note already exists, leaving content untouched', async () => {
    await seedNote('existing', 'original');
    await createNote('existing');
    // dbCreateNote is a no-op for existing notes — content is preserved.
    // A CREATE is still queued (server validates whether it's a true create).
    const note = await dbGetNote('existing');
    expect(note.content).toBe('original');

    await flush();
    const queue = await queueGetPending();
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('CREATE');
    expect(queue[0].id).toBe('existing');
  });

  it('deleteNote soft-deletes and queues a DELETE', async () => {
    await seedNote('delete-me', 'bye');
    const result = await deleteNote('delete-me');

    expect(result.ok).toBe(true);
    expect(await dbGetNote('delete-me')).toBeNull(); // soft-deleted

    await flush();
    const queue = await queueGetPending();
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('DELETE');
    expect(queue[0].id).toBe('delete-me');
    expect(queue[0].content).toBeNull();
    expect(queue[0].version).toBe('local');
  });

  it('deleteNote is a no-op for non-existent note (no queue entry)', async () => {
    await deleteNote('ghost');
    // sync.ts handler only queues if dbGetNoteAny finds a tombstone.
    // For a note that never existed, there is no tombstone → no queue entry.
    await flush();
    const queue = await queueGetPending();
    expect(queue).toHaveLength(0);
  });

  it('renameNote renames and queues a RENAME', async () => {
    await seedNote('old-name', 'some content');
    const result = await renameNote('old-name', 'new-name');

    expect(result.ok).toBe(true);
    expect(await dbGetNote('old-name')).toBeNull();
    const renamed = await dbGetNote('new-name');
    expect(renamed.content).toBe('some content');

    await flush();
    const queue = await queueGetPending();
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('RENAME');
    expect(queue[0].id).toBe('old-name');
    expect(queue[0].renamed_to).toBe('new-name');
    expect(queue[0].version).toBe('local');
  });

  it('renameNote does not queue for non-existent note', async () => {
    // dbRenameNote returns early (no-op).  sync.ts handler only queues if
    // dbGetNote(newId) finds the renamed note — but it doesn't exist.
    await renameNote('ghost', 'new-name');
    expect(await dbGetNote('new-name')).toBeNull();
    await flush();
    const queue = await queueGetPending();
    expect(queue).toHaveLength(0);
  });

  it('multiple operations each add to the queue', async () => {
    await seedNote('a', '');
    await seedNote('b', '');
    await saveNote('a', 'updated');
    await saveNote('b', 'updated');
    await deleteNote('a');

    await flush();
    const queue = await queueGetPending();
    // save('a') → UPDATE, save('b') → UPDATE, delete('a') → DELETE
    // All three are queued via change-bus. queueChange for UPDATE collapses
    // pending entries for the same id, but DELETE is a different type.
    // Handler ordering is async (published simultaneously), so exact count
    // depends on which handler finishes first.
    expect(queue.length).toBeGreaterThanOrEqual(2);
    const types = queue.map(e => e.type);
    expect(types).toContain('DELETE');
    expect(types).toContain('UPDATE');
  });
});
