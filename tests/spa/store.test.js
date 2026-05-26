/**
 * Tests for src/ts/store.ts — state management & frontmatter parser.
 *
 * Note: store.js has module-level state. We use vi.resetModules() + dynamic
 * import to give each test a fresh instance.
 */

import { describe, it, expect, vi } from 'vitest';

// parseFrontmatter moved to frontmatter.ts
import { parseFrontmatter } from '../../src/ts/frontmatter.ts';

// ── Helper — get a fresh store module ───────────────────────────────────────

async function freshStore() {
  vi.resetModules();
  return await import('../../src/ts/store.ts');
}

// ── Frontmatter parser (pure function, no state needed) ─────────────────────

describe('parseFrontmatter()', () => {
  it('returns empty meta and full body when no frontmatter', () => {
    const result = parseFrontmatter('Hello world\nThis is a note.');
    expect(result.meta).toEqual({});
    expect(result.body).toBe('Hello world\nThis is a note.');
  });

  it('returns empty meta and body when input is empty string', () => {
    const result = parseFrontmatter('');
    expect(result.meta).toEqual({});
    expect(result.body).toBe('');
  });

  it('returns empty meta and body when input is only whitespace', () => {
    const result = parseFrontmatter('   \n  ');
    expect(result.meta).toEqual({});
    expect(result.body).toBe('   \n  ');
  });

  it('handles null / undefined input gracefully', () => {
    expect(parseFrontmatter(null)).toEqual({ meta: {}, body: '' });
    expect(parseFrontmatter(undefined)).toEqual({ meta: {}, body: '' });
  });

  it('parses simple frontmatter with string values', () => {
    const raw = `---
title: My Note
path: work/meetings
---
Body text here`;
    const result = parseFrontmatter(raw);
    expect(result.meta).toEqual({ title: 'My Note', path: 'work/meetings' });
    expect(result.body).toBe('Body text here');
  });

  it('parses inline array values in frontmatter', () => {
    const raw = `---
tags: [work, meetings, standup]
---
Content`;
    const result = parseFrontmatter(raw);
    expect(result.meta).toEqual({ tags: ['work', 'meetings', 'standup'] });
  });

  it('handles empty array in frontmatter', () => {
    const raw = `---
tags: []
---
Content`;
    const result = parseFrontmatter(raw);
    expect(result.meta).toEqual({ tags: [] });
  });

  it('handles CRLF line endings', () => {
    const raw = '---\r\ntitle: Test\r\n---\r\nBody';
    const result = parseFrontmatter(raw);
    expect(result.meta).toEqual({ title: 'Test' });
    expect(result.body).toBe('Body');
  });

  it('handles frontmatter with no body', () => {
    const raw = `---
title: Empty
---`;
    const result = parseFrontmatter(raw);
    expect(result.meta).toEqual({ title: 'Empty' });
    expect(result.body).toBe('');
  });

  it('skips malformed frontmatter lines', () => {
    const raw = `---
title: Valid
bad-line-no-colon
another: value
---
Body`;
    const result = parseFrontmatter(raw);
    expect(result.meta).toEqual({ title: 'Valid', another: 'value' });
  });

  it('handles body with multiple lines after frontmatter', () => {
    const raw = `---
title: Multi
---
Line 1
Line 2
Line 3`;
    const result = parseFrontmatter(raw);
    expect(result.meta.title).toBe('Multi');
    expect(result.body).toBe('Line 1\nLine 2\nLine 3');
  });
});

// ── State management ───────────────────────────────────────────────────────

describe('state management', () => {
  it('starts with default state', async () => {
    const store = await freshStore();
    const s = store.getState();
    expect(s.notes).toEqual([]);
    expect(s.filtered).toEqual([]);
    expect(s.current).toBeNull();
    expect(s.content).toBe('');
    expect(s.dirty).toBe(false);
    expect(s.query).toBe('');
  });

  it('setNotes replaces the note list and applies filter', async () => {
    const store = await freshStore();
    const notes = [{ id: 'b', created_at: 1, updated_at: 1, current: 'local' }, { id: 'a', created_at: 2, updated_at: 2, current: 'local' }];
    store.setNotes(notes);
    expect(store.getNotes()).toEqual([{ id: 'b', created_at: 1, updated_at: 1, current: 'local' }, { id: 'a', created_at: 2, updated_at: 2, current: 'local' }]);
    expect(store.getState().notes).toEqual(notes);
  });

  it('setQuery filters notes by id (case-insensitive)', async () => {
    const store = await freshStore();
    // Use names where only specific letters match
    // "alpha" has 'a', "beta" has no 'a', "gamma" has 'a'
    // Wait — "beta" DOES contain 'a'! b-e-t-a
    // Use different names: "foo", "bar", "baz"
    store.setNotes([{ id: 'Foo', created_at: 1, updated_at: 1, current: 'local' }, { id: 'Bar', created_at: 2, updated_at: 2, current: 'local' }, { id: 'Baz', created_at: 3, updated_at: 3, current: 'local' }]);

    // 'o' matches only Foo
    store.setQuery('o');
    let filtered = store.getNotes();
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('Foo');

    // 'ba' matches Bar and Baz
    store.setQuery('ba');
    filtered = store.getNotes();
    expect(filtered).toHaveLength(2);
    expect(filtered.map(n => n.id)).toContain('Bar');
    expect(filtered.map(n => n.id)).toContain('Baz');

    // Empty query returns all
    store.setQuery('');
    expect(store.getNotes()).toHaveLength(3);
  });

  it('setQuery with no match returns empty list', async () => {
    const store = await freshStore();
    store.setNotes([{ id: 'Alpha', created_at: 1, updated_at: 1, current: 'local' }, { id: 'Beta', created_at: 2, updated_at: 2, current: 'local' }]);
    store.setQuery('zzz');
    expect(store.getNotes()).toEqual([]);
  });

  it('openNote sets current note and clears dirty', async () => {
    const store = await freshStore();
    store.openNote('test-note', 'hello');
    expect(store.getCurrent()).toBe('test-note');
    expect(store.getContent()).toBe('hello');
    expect(store.isDirty()).toBe(false);
  });

  it('updateContent sets dirty flag on first change', async () => {
    const store = await freshStore();
    store.openNote('test', 'original');
    expect(store.isDirty()).toBe(false);

    store.updateContent('modified');
    expect(store.getContent()).toBe('modified');
    expect(store.isDirty()).toBe(true);
  });

  it('updateContent does not re-emit dirty if already dirty', async () => {
    const store = await freshStore();
    store.openNote('test', 'original');
    store.updateContent('v1');
    expect(store.isDirty()).toBe(true);

    store.updateContent('v2');
    expect(store.isDirty()).toBe(true);
  });

  it('markClean resets dirty flag', async () => {
    const store = await freshStore();
    store.openNote('test', 'a');
    store.updateContent('b');
    expect(store.isDirty()).toBe(true);

    store.markClean();
    expect(store.isDirty()).toBe(false);
  });

  it('closeNote resets everything', async () => {
    const store = await freshStore();
    store.openNote('test', 'content');
    store.updateContent('changed');
    store.closeNote();

    expect(store.getCurrent()).toBeNull();
    expect(store.getContent()).toBe('');
    expect(store.isDirty()).toBe(false);
  });

  it('setOnline updates state', async () => {
    const store = await freshStore();
    store.setOnline(true);
    expect(store.isOnline()).toBe(true);
    store.setOnline(false);
    expect(store.isOnline()).toBe(false);
  });

  it('setNotes triggers notes-changed event', async () => {
    const store = await freshStore();
    const handler = vi.fn();
    store.on('notes-changed', handler);

    store.setNotes([{ id: 'a', created_at: 1, updated_at: 1, current: 'local' }]);
    expect(handler).toHaveBeenCalledWith([{ id: 'a', created_at: 1, updated_at: 1, current: 'local' }]);
  });

  it('setQuery triggers count-changed event', async () => {
    const store = await freshStore();
    store.setNotes([{ id: 'a', created_at: 1, updated_at: 1, current: 'local' }, { id: 'b', created_at: 2, updated_at: 2, current: 'local' }]);
    const handler = vi.fn();
    store.on('count-changed', handler);

    store.setQuery('a');
    expect(handler).toHaveBeenCalledWith({ total: 2, shown: 1 });
  });

  it('openNote triggers note-opened and dirty-changed events', async () => {
    const store = await freshStore();
    const noteHandler = vi.fn();
    const dirtyHandler = vi.fn();
    store.on('note-opened', noteHandler);
    store.on('dirty-changed', dirtyHandler);

    store.openNote('test', 'content');
    expect(noteHandler).toHaveBeenCalledWith({ id: 'test', content: 'content' });
    expect(dirtyHandler).toHaveBeenCalledWith(false);
  });

  it('updateContent triggers dirty-changed(true)', async () => {
    const store = await freshStore();
    store.openNote('test', '');
    const handler = vi.fn();
    store.on('dirty-changed', handler);

    store.updateContent('new');
    expect(handler).toHaveBeenCalledWith(true);
  });

  it('closeNote triggers note-closed and dirty-changed(false)', async () => {
    const store = await freshStore();
    store.openNote('test', 'a');
    const closeHandler = vi.fn();
    const dirtyHandler = vi.fn();
    store.on('note-closed', closeHandler);
    store.on('dirty-changed', dirtyHandler);

    store.closeNote();
    expect(closeHandler).toHaveBeenCalledOnce();
    expect(dirtyHandler).toHaveBeenCalledWith(false);
  });

  it('on() returns an unsubscribe function', async () => {
    const store = await freshStore();
    const handler = vi.fn();
    const unsub = store.on('test-event', handler);
    expect(typeof unsub).toBe('function');

    const h2 = vi.fn();
    const u = store.on('dirty-changed', h2);
    u();
    store.openNote('x', 'y');
    expect(h2).not.toHaveBeenCalled();
  });
});
