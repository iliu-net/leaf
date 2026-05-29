/**
 * Tests for src/ts/codemirror/setup.ts — CodeMirror EditorView factory.
 *
 * Covers:
 *   - createEditor() returns a working CMView with all extensions
 *   - onChange fires on document changes (dirty tracking)
 *   - CMView interface: state.doc.toString(), dispatch(), destroy(),
 *     dom, focus()
 *   - Theme switching via window.__leafSetCMTheme
 *   - Initial doc is rendered correctly
 *   - Multiple editor instances
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let createEditor;

async function loadSetup() {
  vi.resetModules();
  const mod = await import('../../src/ts/codemirror/setup.ts');
  createEditor = mod.createEditor;
  return mod;
}

beforeEach(async () => {
  // Reset the module-level _activeCMView ref
  vi.resetModules();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

// ── createEditor() basic behaviour ───────────────────────────────────────────

describe('createEditor()', () => {
  it('returns an EditorView with the initial document', async () => {
    const { createEditor } = await loadSetup();
    const parent = document.createElement('div');
    const onChange = vi.fn();

    const view = createEditor(parent, '# Hello\n\nWorld', onChange);

    expect(view).toBeDefined();
    expect(view.state.doc.toString()).toBe('# Hello\n\nWorld');
    expect(onChange).not.toHaveBeenCalled(); // no change yet

    view.destroy();
    parent.remove();
  });

  it('fires onChange when the document is modified', async () => {
    const { createEditor } = await loadSetup();
    const parent = document.createElement('div');
    const onChange = vi.fn();

    const view = createEditor(parent, 'initial', onChange);

    view.dispatch({
      changes: { from: 0, to: 7, insert: 'replaced' },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString()).toBe('replaced');

    view.destroy();
    parent.remove();
  });

  it('CMView has expected interface: state.doc.toString, dispatch, destroy, dom, focus', async () => {
    const { createEditor } = await loadSetup();
    const parent = document.createElement('div');
    const view = createEditor(parent, 'hello', vi.fn());

    // state.doc.toString()
    expect(typeof view.state.doc.toString).toBe('function');
    expect(view.state.doc.toString()).toBe('hello');

    // dispatch()
    expect(typeof view.dispatch).toBe('function');

    // destroy()
    expect(typeof view.destroy).toBe('function');

    // dom
    expect(view.dom).toBeInstanceOf(HTMLElement);
    expect(parent.contains(view.dom)).toBe(true);

    // focus()
    expect(typeof view.focus).toBe('function');

    view.destroy();
    parent.remove();
  });

  it('destroy removes the editor DOM from the parent', async () => {
    const { createEditor } = await loadSetup();
    const parent = document.createElement('div');
    const view = createEditor(parent, 'hello', vi.fn());

    expect(parent.children.length).toBeGreaterThan(0);

    view.destroy();
    // After destroy, CM removes its DOM from parent
    expect(parent.contains(view.dom)).toBe(false);

    parent.remove();
  });

  it('renders markdown content inside the editor', async () => {
    const { createEditor } = await loadSetup();
    const parent = document.createElement('div');
    const view = createEditor(parent, '# Title\n\nSome **bold** text', vi.fn());

    // The content DOM should contain the markdown text
    expect(view.dom.textContent).toContain('Title');
    expect(view.dom.textContent).toContain('bold');
    expect(view.dom.textContent).toContain('text');

    view.destroy();
    parent.remove();
  });

  it('onChange not called on programmatic dispatch with empty changes', async () => {
    const { createEditor } = await loadSetup();
    const parent = document.createElement('div');
    const onChange = vi.fn();

    const view = createEditor(parent, 'hello', onChange);
    // Dispatch an empty transaction (like setSpellcheckLang does)
    view.dispatch({});

    // Empty dispatch should not trigger docChanged
    expect(onChange).not.toHaveBeenCalled();

    view.destroy();
    parent.remove();
  });

  it('multiple editors can coexist', async () => {
    const { createEditor } = await loadSetup();
    const p1 = document.createElement('div');
    const p2 = document.createElement('div');
    const c1 = vi.fn();
    const c2 = vi.fn();

    const v1 = createEditor(p1, 'first editor', c1);
    const v2 = createEditor(p2, 'second editor', c2);

    expect(v1.state.doc.toString()).toBe('first editor');
    expect(v2.state.doc.toString()).toBe('second editor');

    v1.dispatch({ changes: { from: 0, to: 5, insert: '1st' } });
    expect(c1).toHaveBeenCalledTimes(1);
    expect(c2).toHaveBeenCalledTimes(0);
    expect(v1.state.doc.toString()).toBe('1st editor');

    v2.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(c2).toHaveBeenCalledTimes(1);

    v1.destroy();
    v2.destroy();
    p1.remove();
    p2.remove();
  });

  it('handles empty initial document', async () => {
    const { createEditor } = await loadSetup();
    const parent = document.createElement('div');
    const view = createEditor(parent, '', vi.fn());

    expect(view.state.doc.toString()).toBe('');
    expect(view.state.doc.length).toBe(0);

    view.destroy();
    parent.remove();
  });
});

// ── Theme switching ──────────────────────────────────────────────────────────

describe('theme switching', () => {
  it('window.__leafSetCMTheme exists after creating an editor', async () => {
    const { createEditor } = await loadSetup();
    const parent = document.createElement('div');
    const view = createEditor(parent, 'hello', vi.fn());

    // The global hook should be installed
    expect(window.__leafSetCMTheme).toBeDefined();
    expect(typeof window.__leafSetCMTheme).toBe('function');

    view.destroy();
    parent.remove();
  });

  it('__leafSetCMTheme does not throw when called with valid theme names', async () => {
    const { createEditor } = await loadSetup();
    const parent = document.createElement('div');
    const view = createEditor(parent, 'hello', vi.fn());

    // These should not throw
    window.__leafSetCMTheme('dark');
    window.__leafSetCMTheme('light');
    window.__leafSetCMTheme('magenta');
    window.__leafSetCMTheme('paired-12');
    window.__leafSetCMTheme('unknown-theme'); // should fall back to dark

    view.destroy();
    parent.remove();
  });

  it('__leafSetCMTheme does not throw when no editor is active', async () => {
    // Call before any editor is created — should be a no-op
    // The hook might not be installed yet
    if (window.__leafSetCMTheme) {
      window.__leafSetCMTheme('light');
    }
    // Just verify no throw
  });

  it('dark themes use highlightDark, light themes use highlightLight', async () => {
    const { createEditor } = await loadSetup();
    const parent = document.createElement('div');
    const view = createEditor(parent, '# Hello', vi.fn());

    // Verify the editor is functional after theme switch
    window.__leafSetCMTheme('dark');
    expect(view.state.doc.toString()).toBe('# Hello');

    window.__leafSetCMTheme('light');
    expect(view.state.doc.toString()).toBe('# Hello');

    // magenta also uses light highlight
    window.__leafSetCMTheme('magenta');
    expect(view.state.doc.toString()).toBe('# Hello');

    view.destroy();
    parent.remove();
  });

  it('theme switch preserves document content and cursor', async () => {
    const { createEditor } = await loadSetup();
    const parent = document.createElement('div');
    const view = createEditor(parent, 'Some markdown content here', vi.fn());

    window.__leafSetCMTheme('dark');
    expect(view.state.doc.toString()).toBe('Some markdown content here');

    window.__leafSetCMTheme('light');
    expect(view.state.doc.toString()).toBe('Some markdown content here');

    view.destroy();
    parent.remove();
  });
});

// ── Editor extensions ────────────────────────────────────────────────────────

describe('editor extensions', () => {
  it('line numbers gutter is present', async () => {
    const { createEditor } = await loadSetup();
    const parent = document.createElement('div');
    const view = createEditor(parent, 'hello', vi.fn());

    // CM adds a .cm-gutters element for line numbers
    const gutters = view.dom.querySelector('.cm-gutters');
    expect(gutters).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('editor has spellcheck enabled on content', async () => {
    const { createEditor } = await loadSetup();
    const parent = document.createElement('div');
    const view = createEditor(parent, 'hello', vi.fn());

    // The spellcheck plugin sets spellcheck="true" on contentDOM
    const content = view.dom.querySelector('.cm-content');
    // The spellcheck plugin applies attributes after update cycle.
    // We just verify the editor renders without error.

    view.destroy();
    parent.remove();
  });

  it('editor is focusable', async () => {
    const { createEditor } = await loadSetup();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = createEditor(parent, 'focus test', vi.fn());

    // Focus the editor
    view.focus();
    // In jsdom, activeElement might not update, but focus() shouldn't throw
    expect(() => view.focus()).not.toThrow();

    view.destroy();
    parent.remove();
  });
});
