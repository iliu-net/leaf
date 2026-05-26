/**
 * Tests for src/ts/diff.ts — line-based diff utility.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { computeDiff } from '../../src/ts/diff.ts';

// ── computeDiff ────────────────────────────────────────────────────────────

describe('computeDiff', () => {
  it('returns single unchanged entry for two empty strings', () => {
    // ''.split('\\n') → [''] for both sides, so diff finds one common empty line
    expect(computeDiff('', '')).toEqual([
      { type: ' ', text: '' },
    ]);
  });

  it('returns all-unchanged for identical strings', () => {
    const result = computeDiff('line one\nline two\nline three', 'line one\nline two\nline three');
    expect(result).toEqual([
      { type: ' ', text: 'line one' },
      { type: ' ', text: 'line two' },
      { type: ' ', text: 'line three' },
    ]);
  });

  it('detects additions only', () => {
    const result = computeDiff('old', 'old\nnew line');
    expect(result).toEqual([
      { type: ' ', text: 'old' },
      { type: '+', text: 'new line' },
    ]);
  });

  it('detects deletions only', () => {
    const result = computeDiff('line one\nline two', 'line one');
    expect(result).toEqual([
      { type: ' ', text: 'line one' },
      { type: '-', text: 'line two' },
    ]);
  });

  it('detects mixed changes', () => {
    const result = computeDiff(
      'old line\nkept line\nremoved line',
      'new line\nkept line\nadded line',
    );
    expect(result).toEqual([
      { type: '-', text: 'old line' },
      { type: '+', text: 'new line' },
      { type: ' ', text: 'kept line' },
      { type: '-', text: 'removed line' },
      { type: '+', text: 'added line' },
    ]);
  });

  it('treats empty string vs non-empty as removal of empty line + additions', () => {
    // ''.split('\\n') → [''] vs 'a\\nb\\nc'.split('\\n') → ['a','b','c']
    const result = computeDiff('', 'a\nb\nc');
    expect(result).toEqual([
      { type: '-', text: '' },
      { type: '+', text: 'a' },
      { type: '+', text: 'b' },
      { type: '+', text: 'c' },
    ]);
  });

  it('treats non-empty vs empty as deletions + addition of empty line', () => {
    const result = computeDiff('a\nb\nc', '');
    expect(result).toEqual([
      { type: '-', text: 'a' },
      { type: '-', text: 'b' },
      { type: '-', text: 'c' },
      { type: '+', text: '' },
    ]);
  });

  it('handles single-line strings', () => {
    const result = computeDiff('hello', 'world');
    expect(result).toEqual([
      { type: '-', text: 'hello' },
      { type: '+', text: 'world' },
    ]);
  });

  it('handles trailing newlines consistently', () => {
    // Trailing newline produces an extra empty line element
    const result = computeDiff('a\n', 'a\nb\n');
    expect(result).toEqual([
      { type: ' ', text: 'a' },
      { type: '+', text: 'b' },
      { type: ' ', text: '' },
    ]);
  });

  it('handles many lines efficiently', () => {
    const a = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const b = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const result = computeDiff(a, b);
    expect(result).toHaveLength(100);
    expect(result.every(line => line.type === ' ')).toBe(true);
  });
});

// ── created_by in dbApplyServerChange ──────────────────────────────────────

import { db, dbApplyServerChange, dbGetNote } from '../../src/ts/db.ts';
import { getUsername } from '../../src/ts/auth.ts';

async function seedNote(id, extra = {}) {
  await db.notes.put({
    id, content: '', created_at: 1, updated_at: 1, deleted: 0,
    current: 'local', created_by: '', updated_by: '',
    ...extra,
  });
}

describe('dbApplyServerChange created_by handling', () => {
  it('uses server-provided created_by on CREATE when note does not exist', async () => {
    await dbApplyServerChange('CREATE', 'new-note', 'hello', 'v1', null, 'alice', 'alice');

    const note = await dbGetNote('new-note');
    expect(note.created_by).toBe('alice');
    expect(note.updated_by).toBe('alice');
    expect(note.content).toBe('hello');
  });

  it('uses server-provided created_by on UPDATE when note does not exist (dedup scenario)', async () => {
    // Simulates the deduplication bug: Alice created, Bob updated,
    // Charlie syncs and only gets the UPDATE.
    await dbApplyServerChange('UPDATE', 'remote-note', 'bob edit', 'v2', 'v1', 'bob', 'alice');

    const note = await dbGetNote('remote-note');
    expect(note.created_by).toBe('alice');  // server's created_by, not bob
    expect(note.updated_by).toBe('bob');
  });

  it('preserves existing created_by on UPDATE when note already exists', async () => {
    await seedNote('existing', { created_by: 'carol', updated_by: 'carol' });

    await dbApplyServerChange('UPDATE', 'existing', 'dave edit', 'v2', 'v1', 'dave', undefined);

    const note = await dbGetNote('existing');
    // created_by preserved from existing record
    expect(note.created_by).toBe('carol');
    // updated_by updated from server author
    expect(note.updated_by).toBe('dave');
  });

  it('falls back to author on CREATE when created_by is not provided (old server)', async () => {
    await dbApplyServerChange('CREATE', 'old-server-note', 'content', 'v1', null, 'eve', undefined);

    const note = await dbGetNote('old-server-note');
    expect(note.created_by).toBe('eve');
  });

  it('leaves created_by empty on UPDATE without server created_by and no existing record', async () => {
    await dbApplyServerChange('UPDATE', 'orphan-update', 'content', 'v2', 'v1', 'frank', undefined);

    const note = await dbGetNote('orphan-update');
    expect(note.created_by).toBe('');
    expect(note.updated_by).toBe('frank');
  });
});
