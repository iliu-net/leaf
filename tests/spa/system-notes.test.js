/**
 * Tests for src/ts/system-notes/registry.ts
 *
 * Verifies registration, retrieval, and duplicate detection across all
 * modules — both statically imported (builtin.ts) and lazily loaded
 * (plugin modules like emoji.ts).  The md-loader Vite plugin in
 * vitest.config.js handles .md imports so the plugin modules load cleanly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

async function freshRegistry() {
  vi.resetModules();
  return await import('../../src/ts/system-notes/registry.js');
}

// ── Basic registry API ──────────────────────────────────────────────────────

describe('registerSystemNote()', () => {
  it('registers a system note', async () => {
    const { registerSystemNote, getSystemNote } = await freshRegistry();
    registerSystemNote({
      id: '@about:test',
      label: 'Test',
      content: function () { return '# Test'; },
    });
    const def = getSystemNote('@about:test');
    expect(def).toBeDefined();
    expect(def.label).toBe('Test');
  });

  it('returns content lazily', async () => {
    const { registerSystemNote, getSystemNote } = await freshRegistry();
    registerSystemNote({
      id: '@about:test',
      label: 'Test',
      content: function () { return '# Hello World'; },
    });
    const def = getSystemNote('@about:test');
    expect(def).toBeDefined();
    expect(def.content()).toBe('# Hello World');
  });

  it('warns and skips on duplicate registration', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(function () {});
    const { registerSystemNote, getSystemNote } = await freshRegistry();

    registerSystemNote({
      id: '@about:dup',
      label: 'First',
      content: function () { return '# First'; },
    });
    registerSystemNote({
      id: '@about:dup',
      label: 'Second (should be skipped)',
      content: function () { return '# Second'; },
    });

    const def = getSystemNote('@about:dup');
    expect(def).toBeDefined();
    expect(def.label).toBe('First');
    expect(def.content()).toBe('# First');

    // Warning was logged
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Duplicate');
    expect(warn.mock.calls[0][0]).toContain('@about:dup');

    warn.mockRestore();
  });
});

describe('getSystemNote()', () => {
  it('returns undefined for an unregistered id', async () => {
    const { getSystemNote } = await freshRegistry();
    expect(getSystemNote('@about:ghost')).toBeUndefined();
  });
});

describe('listSystemNotes()', () => {
  it('returns all registered notes', async () => {
    const { registerSystemNote, listSystemNotes } = await freshRegistry();
    registerSystemNote({ id: '@about:a', label: 'A', content: function () { return 'A'; } });
    registerSystemNote({ id: '@about:b', label: 'B', content: function () { return 'B'; } });
    registerSystemNote({ id: '@about:c', label: 'C', content: function () { return 'C'; } });

    const list = listSystemNotes();
    expect(list).toHaveLength(3);
    expect(list.map(function (d) { return d.id; }).sort()).toEqual(['@about:a', '@about:b', '@about:c']);
  });

  it('returns an empty array when nothing is registered', async () => {
    const { listSystemNotes } = await freshRegistry();
    expect(listSystemNotes()).toEqual([]);
  });
});

describe('isSystemNote()', () => {
  it('returns true for a registered note', async () => {
    const { registerSystemNote, isSystemNote } = await freshRegistry();
    registerSystemNote({ id: '@about:test', label: 'T', content: function () { return ''; } });
    expect(isSystemNote('@about:test')).toBe(true);
  });

  it('returns false for an unregistered id', async () => {
    const { isSystemNote } = await freshRegistry();
    expect(isSystemNote('my-user-note')).toBe(false);
    expect(isSystemNote('@about:ghost')).toBe(false);
  });
});

// ── Duplicate detection across all modules ──────────────────────────────────

describe('no duplicate registrations across all modules', () => {
  it('built-in and plugin modules have no conflicting IDs', async () => {
    vi.resetModules();

    var dupWarns = [];
    var warnSpy = vi.spyOn(console, 'warn').mockImplementation(function (msg) {
      if (typeof msg === 'string' && msg.includes('Duplicate')) {
        dupWarns.push(msg);
      }
    });

    // Load all modules that call registerSystemNote (side-effect imports)
    var registry = await import('../../src/ts/system-notes/registry.js');
    await import('../../src/ts/system-notes/builtin.js');

    // Discover and import every extension module — any that register
    // system notes will be picked up automatically.  Wrap each in a
    // try/catch so a broken import in one extension doesn't block the rest.
    var extModules = import.meta.glob('../../src/ts/extensions/*.ts');
    await Promise.all(
      Object.values(extModules).map(function (load) {
        return load().catch(function (err) {
          console.warn('[test] failed to import extension:', err.message);
        });
      }),
    );

    var all = registry.listSystemNotes();
    var ids = all.map(function (d) { return d.id; });

    // No duplicate IDs (check the data directly)
    var seen = new Set();
    var dups = [];
    for (var i = 0; i < ids.length; i++) {
      if (seen.has(ids[i])) dups.push(ids[i]);
      seen.add(ids[i]);
    }
    expect(dups).toEqual([]);

    // No console.warn from duplicate skips
    expect(dupWarns).toHaveLength(0);

    // Sanity: we registered something (6 builtin + emoji + wikilinks + highlight)
    expect(all.length).toBeGreaterThanOrEqual(9);

    warnSpy.mockRestore();
  });
});
