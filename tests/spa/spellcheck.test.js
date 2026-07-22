/**
 * Tests for src/ts/codemirror/spellcheck.ts
 *
 * Covers:
 *   - spellcheckPlugin() factory function
 *
 * Note: resolveSpellcheckLang / getSpellcheckLang / setSpellcheckLang were
 * removed in the React migration.  Spellcheck language is now managed through
 * frontmatter (lang field in MetaProfile) and the MetaTab UI.  The plugin
 * itself simply sets spellcheck="true" on .cm-line elements.
 */

import { describe, it, expect } from 'vitest';

import { spellcheckPlugin } from '../../src/ts/codemirror/spellcheck.ts';

// ── spellcheckPlugin() ────────────────────────────────────────────────────────

describe('spellcheckPlugin()', () => {
  it('returns a defined object', () => {
    const plugin = spellcheckPlugin();
    expect(plugin).toBeDefined();
    expect(typeof plugin).toBe('object');
  });

  it('each call creates a fresh instance', () => {
    const p1 = spellcheckPlugin();
    const p2 = spellcheckPlugin();
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    // Two different instances (not the same object)
    expect(p1).not.toBe(p2);
  });
});
