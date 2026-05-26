/**
 * Tests for spa/js/db.js — IndexedDB persistence layer via Dexie.
 *
 * fake-indexeddb is installed in setup.js so Dexie works without a real browser.
 * Each test starts with a fresh database (tables cleared in afterEach in setup.js).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  db, dbListNotes, dbGetNote, dbSaveNote, dbDeleteNote,
  dbCreateNote, dbRenameNote, dbApplyServerChange,
  queueChange, queueGetPending, queueMarkSent, queuePruneSent,
  dbPurgeDeletedNotes,
} from '../../src/ts/db.ts';

// ── Helpers ─────────────────────────────────────────────────────────────────

async function seedNote(id, content = '', extra = {}) {
  await db.notes.put({ id, content, created_at: 1, updated_at: 1, deleted: 0, current: 'local', ...extra });
}

// ── Notes CRUD ──────────────────────────────────────────────────────────────

describe('notes table', () => {
  it('dbListNotes returns empty array when no notes exist', async () => {
    const list = await dbListNotes();
    expect(list).toEqual([]);
  });

  it('dbListNotes returns only non-deleted notes, sorted by id', async () => {
    await seedNote('z-note', 'z');
    await seedNote('a-note', 'a');
    await seedNote('m-note', 'm');

    const list = await dbListNotes();
    expect(list.map(n => n.id)).toEqual(['a-note', 'm-note', 'z-note']);
    // Should not include content field
    expect(list[0]).not.toHaveProperty('content');
  });

  it('dbListNotes excludes deleted notes', async () => {
    await seedNote('alive', 'hello');
    await seedNote('dead', 'gone', { deleted: 1 });

    const list = await dbListNotes();
    expect(list.map(n => n.id)).toEqual(['alive']);
  });

  it('dbGetNote returns a live note', async () => {
    await seedNote('test', 'hello world');
    const note = await dbGetNote('test');
    expect(note).not.toBeNull();
    expect(note.id).toBe('test');
    expect(note.content).toBe('hello world');
  });

  it('dbGetNote returns null for missing note', async () => {
    const note = await dbGetNote('nope');
    expect(note).toBeNull();
  });

  it('dbGetNote returns null for deleted note', async () => {
    await seedNote('dead', 'gone', { deleted: 1 });
    const note = await dbGetNote('dead');
    expect(note).toBeNull();
  });

  it('dbSaveNote creates a new note', async () => {
    await dbSaveNote('new-note', 'content!');
    const note = await dbGetNote('new-note');
    expect(note.content).toBe('content!');
    expect(note.deleted).toBe(0);
    expect(note.created_at).toBeTruthy();
    expect(note.updated_at).toBeTruthy();
  });

  it('dbSaveNote updates an existing note preserving created_at and current', async () => {
    await seedNote('existing', 'original', { created_at: 100, updated_at: 100, current: 'v1' });
    await dbSaveNote('existing', 'updated');

    const note = await dbGetNote('existing');
    expect(note.content).toBe('updated');
    expect(note.created_at).toBe(100);  // preserved
    expect(note.updated_at).toBeGreaterThan(100);
    expect(note.current).toBe('v1');    // preserved
  });

  it('dbSaveNote sets current to "local" for a new note', async () => {
    await dbSaveNote('new-note', 'content!');
    const note = await dbGetNote('new-note');
    expect(note.current).toBe('local');
  });

  it('dbDeleteNote soft-deletes a note', async () => {
    await seedNote('doom', 'bye');
    await dbDeleteNote('doom');

    const note = await db.notes.get('doom');
    expect(note.deleted).toBe(1);

    // Should not appear in list
    const list = await dbListNotes();
    expect(list.find(n => n.id === 'doom')).toBeUndefined();
  });

  it('dbDeleteNote is a no-op for non-existent note', async () => {
    // Should not throw
    await dbDeleteNote('ghost');
  });

  it('dbCreateNote creates an empty note with current="local"', async () => {
    const result = await dbCreateNote('brand-new');
    const note = await dbGetNote('brand-new');
    expect(note.content).toBe('');
    expect(note.deleted).toBe(0);
    expect(note.current).toBe('local');
  });

  it('dbCreateNote is a no-op if note already exists', async () => {
    await seedNote('existing', 'original', { created_at: 50 });
    await dbCreateNote('existing');

    const note = await dbGetNote('existing');
    expect(note.content).toBe('original');  // unchanged
    expect(note.created_at).toBe(50);       // unchanged
  });
});

// ── Rename ──────────────────────────────────────────────────────────────────

describe('dbRenameNote()', () => {
  it('renames a note and preserves content and timestamps', async () => {
    await seedNote('old-name', 'some content', { created_at: 100, updated_at: 200 });
    await dbRenameNote('old-name', 'new-name');

    // Old id should be gone
    const old = await dbGetNote('old-name');
    expect(old).toBeNull();

    // New id should exist with same data
    const note = await dbGetNote('new-name');
    expect(note.content).toBe('some content');
    expect(note.created_at).toBe(100);
    expect(note.updated_at).toBeGreaterThan(200);
  });

  it('is a no-op if old id does not exist', async () => {
    await dbRenameNote('ghost', 'new-name');
    const note = await dbGetNote('new-name');
    expect(note).toBeNull();
  });

  it('rewrites pending queue entries for the old id', async () => {
    await seedNote('old', 'data');
    await queueChange('UPDATE', 'old', 'data');
    await queueChange('CREATE', 'other', '');

    await dbRenameNote('old', 'new');

    const pending = await queueGetPending();
    const renamed = pending.find(e => e.id === 'new');
    expect(renamed).toBeTruthy();
    expect(pending.find(e => e.id === 'old')).toBeUndefined();
    // The other queue entry should be untouched
    expect(pending.find(e => e.id === 'other')).toBeTruthy();
  });
});

// ── Apply server changes ────────────────────────────────────────────────────

describe('dbApplyServerChange()', () => {
  it('applies CREATE for a new note', async () => {
    await dbApplyServerChange('CREATE', 'remote-note', 'remote content', 'server:v1');
    const note = await dbGetNote('remote-note');
    expect(note.content).toBe('remote content');
    expect(note.current).toBe('server:v1');
  });

  it('applies UPDATE for an existing note', async () => {
    await seedNote('my-note', 'old', { current: 'v1' });
    await dbApplyServerChange('UPDATE', 'my-note', 'new content', 'v2');
    const note = await dbGetNote('my-note');
    expect(note.content).toBe('new content');
    expect(note.current).toBe('v2');
  });

  it('applies DELETE for an existing note', async () => {
    await seedNote('delete-me', 'bye');
    await dbApplyServerChange('DELETE', 'delete-me', null);
    const note = await dbGetNote('delete-me');
    expect(note).toBeNull();
  });

  it('DELETE is a no-op for non-existent note', async () => {
    await dbApplyServerChange('DELETE', 'ghost', null);
    // Should not throw
  });

  it('applies RENAME', async () => {
    await seedNote('old-name', 'content', { current: 'v1' });
    await dbApplyServerChange('RENAME', 'old-name', 'new-name');
    expect(await dbGetNote('old-name')).toBeNull();
    const note = await dbGetNote('new-name');
    expect(note).not.toBeNull();
    expect(note.current).toBe('v1');
  });

  it('RENAME is a no-op if old id does not exist', async () => {
    await dbApplyServerChange('RENAME', 'ghost', 'new-name');
    expect(await dbGetNote('new-name')).toBeNull();
  });

  it('RENAME rewrites pending queue entries', async () => {
    await seedNote('old', 'data', { current: 'local' });
    await queueChange('UPDATE', 'old', 'data', 'local');
    await dbApplyServerChange('RENAME', 'old', 'new');
    const pending = await queueGetPending();
    expect(pending.find(e => e.id === 'new')).toBeTruthy();
    expect(pending.find(e => e.id === 'old')).toBeUndefined();
  });

  it('CREATE preserves existing note current if no version sent', async () => {
    await seedNote('existing', 'original', { created_at: 100, current: 'v1' });
    await dbApplyServerChange('CREATE', 'existing', 'overwrite');
    const note = await dbGetNote('existing');
    expect(note.content).toBe('overwrite');
    expect(note.created_at).toBe(100);
    expect(note.current).toBe('v1');
  });

  it('CREATE overwrites current when version is sent', async () => {
    await seedNote('existing', 'original', { created_at: 100, current: 'v1' });
    await dbApplyServerChange('CREATE', 'existing', 'overwrite', 'v2');
    const note = await dbGetNote('existing');
    expect(note.content).toBe('overwrite');
    expect(note.current).toBe('v2');
  });
});

// ── Queue ───────────────────────────────────────────────────────────────────

describe('queue operations', () => {
  it('queueChange adds a pending entry', async () => {
    await queueChange('UPDATE', 'my-note', 'content');
    const pending = await queueGetPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].type).toBe('UPDATE');
    expect(pending[0].id).toBe('my-note');
    expect(pending[0].content).toBe('content');
    expect(pending[0].status).toBe('pending');
    expect(pending[0].version).toBe('local');
  });

  it('queueChange collapses duplicate pending entries for the same note', async () => {
    await queueChange('UPDATE', 'my-note', 'v1');
    await queueChange('UPDATE', 'my-note', 'v2');
    const pending = await queueGetPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].content).toBe('v2');
  });

  it('queueChange does not collapse entries for different notes', async () => {
    await queueChange('UPDATE', 'note-a', 'a');
    await queueChange('UPDATE', 'note-b', 'b');
    const pending = await queueGetPending();
    expect(pending).toHaveLength(2);
  });

  it('queueChange collapses CREATE + UPDATE into one UPDATE', async () => {
    await queueChange('CREATE', 'new-note', '');
    await queueChange('UPDATE', 'new-note', 'content');
    const pending = await queueGetPending();
    expect(pending).toHaveLength(1);
    // The second operation (UPDATE) collapses the first (CREATE)
    // and replaces it
    expect(pending[0].type).toBe('UPDATE');
    expect(pending[0].content).toBe('content');
  });

  it('queueChange with extra stores additional properties and version', async () => {
    await queueChange('RENAME', 'old', null, 'local', { renamed_to: 'new' });
    const pending = await queueGetPending();
    expect(pending[0].renamed_to).toBe('new');
    expect(pending[0].version).toBe('local');
  });

  it('queueMarkSent marks an entry as sent', async () => {
    await queueChange('UPDATE', 'test', 'data');
    const pending = await queueGetPending();
    await queueMarkSent(pending[0].seq);
    const sent = await db.queue.where('status').equals('sent').toArray();
    expect(sent).toHaveLength(1);
  });

  it('queuePruneSent removes all sent entries', async () => {
    await queueChange('UPDATE', 'a', '1');
    await queueChange('UPDATE', 'b', '2');
    const pending = await queueGetPending();

    // Mark both as sent
    for (const p of pending) await queueMarkSent(p.seq);
    await queuePruneSent();

    const remaining = await db.queue.toArray();
    expect(remaining).toHaveLength(0);
  });

  it('queuePruneSent does not remove pending entries', async () => {
    await queueChange('UPDATE', 'keep', 'me');
    await queueChange('UPDATE', 'will-send', 'later');
    const pending = await queueGetPending();

    // Mark the SECOND as sent (not the first)
    await queueMarkSent(pending[1].seq);
    await queuePruneSent();

    // Only 'keep' should remain pending
    const remaining = await queueGetPending();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('keep');
  });

  it('entries are returned in insertion order', async () => {
    await queueChange('UPDATE', 'first', '1');
    await queueChange('UPDATE', 'second', '2');
    await queueChange('UPDATE', 'third', '3');

    const pending = await queueGetPending();
    expect(pending.map(e => e.id)).toEqual(['first', 'second', 'third']);
  });
});

// ── Purge ───────────────────────────────────────────────────────────────────

describe('dbPurgeDeletedNotes()', () => {
  const DAY_MS = 86400 * 1000;

  it('removes deleted notes older than 7 days', async () => {
    const old = Date.now() - 10 * DAY_MS;
    await db.notes.put({ id: 'stale', content: '', created_at: old, updated_at: old, deleted: 1 });
    await dbPurgeDeletedNotes();
    const note = await db.notes.get('stale');
    expect(note).toBeUndefined();
  });

  it('keeps deleted notes newer than 7 days', async () => {
    const recent = Date.now() - 3 * DAY_MS;
    await db.notes.put({ id: 'fresh', content: '', created_at: recent, updated_at: recent, deleted: 1 });
    await dbPurgeDeletedNotes();
    const note = await db.notes.get('fresh');
    expect(note).not.toBeUndefined();
  });

  it('does not touch live (non-deleted) notes', async () => {
    await db.notes.put({ id: 'alive', content: 'hey', created_at: Date.now(), updated_at: Date.now(), deleted: 0 });
    await dbPurgeDeletedNotes();
    const note = await db.notes.get('alive');
    expect(note).not.toBeUndefined();
  });
});
