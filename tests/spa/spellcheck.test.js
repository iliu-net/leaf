/**
 * Tests for src/ts/codemirror/spellcheck.ts
 *
 * Covers:
 *   - resolveSpellcheckLang() four-tier priority chain
 *   - getSpellcheckLang() / setSpellcheckLang() module-level state
 *   - 'spellcheck-lang-changed' custom event dispatch
 *   - spellcheckPlugin() factory function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  resolveSpellcheckLang,
  getSpellcheckLang,
  setSpellcheckLang,
  spellcheckPlugin,
} from '../../src/ts/codemirror/spellcheck.ts';

// ── resolveSpellcheckLang() ───────────────────────────────────────────────────

describe('resolveSpellcheckLang()', () => {
  it('returns fmLang when provided (highest priority)', () => {
    expect(resolveSpellcheckLang('es', 'fr')).toBe('es');
  });

  it('returns fmLang even when configDefault is also set', () => {
    expect(resolveSpellcheckLang('de', 'en')).toBe('de');
  });

  it('falls back to configDefault when fmLang is undefined', () => {
    expect(resolveSpellcheckLang(undefined, 'fr')).toBe('fr');
  });

  it('falls back to configDefault when fmLang is empty', () => {
    expect(resolveSpellcheckLang('', 'pt')).toBe('pt');
  });

  it('falls back to document.documentElement.lang when both fm and config are empty', () => {
    document.documentElement.setAttribute('lang', 'de');
    expect(resolveSpellcheckLang(undefined, undefined)).toBe('de');
    document.documentElement.removeAttribute('lang');
  });

  it('falls back to en-US when nothing is set anywhere', () => {
    document.documentElement.removeAttribute('lang');
    expect(resolveSpellcheckLang(undefined, undefined)).toBe('en-US');
  });

  it('fmLang takes priority over configDefault', () => {
    expect(resolveSpellcheckLang('es', 'fr')).toBe('es');
  });

  it('configDefault takes priority over document lang', () => {
    document.documentElement.setAttribute('lang', 'de');
    expect(resolveSpellcheckLang(undefined, 'pt-BR')).toBe('pt-BR');
    document.documentElement.removeAttribute('lang');
  });

  it('document lang takes priority over hardcoded en-US', () => {
    document.documentElement.setAttribute('lang', 'it');
    expect(resolveSpellcheckLang(undefined, undefined)).toBe('it');
    document.documentElement.removeAttribute('lang');
  });

  it('handles falsy fmLang (0, false) as empty', () => {
    expect(resolveSpellcheckLang(0, 'fr')).toBe('fr');
  });
});

// ── getSpellcheckLang() / setSpellcheckLang() ─────────────────────────────────

describe('getSpellcheckLang() / setSpellcheckLang()', () => {
  beforeEach(() => {
    setSpellcheckLang('en-US');
  });

  afterEach(() => {
    setSpellcheckLang('en-US');
  });

  it('getSpellcheckLang returns current language', () => {
    expect(getSpellcheckLang()).toBe('en-US');
  });

  it('setSpellcheckLang updates the module-level language', () => {
    setSpellcheckLang('es');
    expect(getSpellcheckLang()).toBe('es');
  });

  it('setSpellcheckLang ignores the same value (no-op)', () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    setSpellcheckLang('en-US');
    expect(spy).not.toHaveBeenCalled();
  });

  it('setSpellcheckLang fires spellcheck-lang-changed custom event', () => {
    const handler = vi.fn();
    window.addEventListener('spellcheck-lang-changed', handler);
    setSpellcheckLang('fr');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'spellcheck-lang-changed', detail: 'fr' }),
    );
    window.removeEventListener('spellcheck-lang-changed', handler);
  });

  it('setSpellcheckLang ignores empty string', () => {
    setSpellcheckLang('es');
    setSpellcheckLang('');
    expect(getSpellcheckLang()).toBe('es');
  });

  it('setSpellcheckLang ignores null', () => {
    setSpellcheckLang('es');
    setSpellcheckLang(null);
    expect(getSpellcheckLang()).toBe('es');
  });

  it('setSpellcheckLang ignores undefined', () => {
    setSpellcheckLang('es');
    setSpellcheckLang(undefined);
    expect(getSpellcheckLang()).toBe('es');
  });

  it('handles multiple language changes', () => {
    setSpellcheckLang('de');
    expect(getSpellcheckLang()).toBe('de');
    setSpellcheckLang('fr');
    expect(getSpellcheckLang()).toBe('fr');
    setSpellcheckLang('pt-BR');
    expect(getSpellcheckLang()).toBe('pt-BR');
  });

  it('event detail matches the new language exactly', () => {
    const handler = vi.fn();
    window.addEventListener('spellcheck-lang-changed', handler);
    setSpellcheckLang('ja');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'ja' }),
    );
    window.removeEventListener('spellcheck-lang-changed', handler);
  });
});

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
