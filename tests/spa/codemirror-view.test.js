/**
 * Tests for src/ts/codemirror-view.ts — CodeMirror TabPanel implementation.
 *
 * Covers:
 *   - _replaceBody() frontmatter → body merge logic
 *   - tabPanel.init() caches textarea ref
 *   - tabPanel.show() with mock CM factory
 *   - Spellcheck language resolution during cmShow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Import helpers ───────────────────────────────────────────────────────────

async function loadCMView() {
  vi.resetModules();
  return await import('../../src/ts/codemirror-view.ts');
}

async function loadSpellcheck() {
  vi.resetModules();
  return await import('../../src/ts/codemirror/spellcheck.ts');
}

// ── DOM setup ─────────────────────────────────────────────────────────────────

function setupDOM() {
  document.body.innerHTML = `
    <textarea id="note-area"></textarea>
    <div id="tab-code"></div>
    <div id="editor-tabs" style="display:none">
      <button id="tab-btn-code" class="tab-btn" role="tab">Code</button>
    </div>
  `;
}

beforeEach(() => {
  setupDOM();
});

afterEach(() => {
  document.body.innerHTML = '';
});

// ── _replaceBody() ────────────────────────────────────────────────────────────

describe('_replaceBody()', () => {
  it('returns just the body when no frontmatter exists', async () => {
    const { _replaceBody } = await loadCMView();
    expect(_replaceBody('Just a paragraph.', 'new body')).toBe('new body');
  });

  it('preserves frontmatter and replaces the body', async () => {
    const { _replaceBody } = await loadCMView();
    const content = [
      '---',
      'title: My Note',
      'author: alice',
      '---',
      '',
      'Old body text.',
    ].join('\n');

    const result = _replaceBody(content, 'New body text.\n');

    expect(result).toContain('---');
    expect(result).toContain('title: My Note');
    expect(result).toContain('author: alice');
    expect(result).toContain('New body text.');
    expect(result).not.toContain('Old body text.');
  });

  it('handles frontmatter with Windows line endings (\\r\\n)', async () => {
    const { _replaceBody } = await loadCMView();
    const content = '---\r\ntitle: Win\r\n---\r\nBody here';

    const result = _replaceBody(content, 'new body');

    expect(result).toContain('title: Win');
    expect(result).toContain('new body');
    expect(result).not.toContain('Body here');
  });

  it('returns new body for empty input', async () => {
    const { _replaceBody } = await loadCMView();
    expect(_replaceBody('', 'only body')).toBe('only body');
  });

  it('handles frontmatter at the very start of content', async () => {
    const { _replaceBody } = await loadCMView();
    const content = '---\nkey: val\n---\nbody';

    const result = _replaceBody(content, 'replaced');

    expect(result).toBe('---\nkey: val\n---\nreplaced');
  });

  it('does not treat --- in body as frontmatter delimiter', async () => {
    const { _replaceBody } = await loadCMView();
    // Only the first --- block is frontmatter
    const content = [
      '---',
      'title: Note',
      '---',
      '',
      'Some text with --- in the middle.',
      'More text.',
    ].join('\n');

    const result = _replaceBody(content, 'new body');

    expect(result).toBe('---\ntitle: Note\n---\nnew body');
    expect(result).not.toContain('Some text');
  });

  it('preserves trailing newlines in frontmatter', async () => {
    const { _replaceBody } = await loadCMView();
    const content = '---\ntitle: X\n---\n\nBody starts after blank line.';

    const result = _replaceBody(content, 'clean body');

    // The regex /^---\r?\n([\\s\\S]*?)\r?\n---\r?\n?/ captures one
    // optional newline after ---, so a blank line before body is lost.
    expect(result).toBe('---\ntitle: X\n---\nclean body');
  });

  it('handles frontmatter with multiple keys', async () => {
    const { _replaceBody } = await loadCMView();
    const content = [
      '---',
      'title: Complex Note',
      'author: bob',
      'tags: test, example',
      'lang: en-US',
      '---',
      '',
      '# Section',
      'Content here.',
    ].join('\n');

    const result = _replaceBody(content, '# New Section\nFresh content.');

    expect(result).toContain('title: Complex Note');
    expect(result).toContain('author: bob');
    expect(result).toContain('tags: test, example');
    expect(result).toContain('lang: en-US');
    expect(result).toContain('# New Section');
    expect(result).not.toContain('# Section');
  });
});

// ── tabPanel.init() ───────────────────────────────────────────────────────────

describe('tabPanel.init()', () => {
  it('caches the textarea reference', async () => {
    const { tabPanel } = await loadCMView();
    // init() should not throw when textarea exists
    expect(() => tabPanel.init()).not.toThrow();
  });

  it('does not throw when textarea is missing', async () => {
    // Remove the textarea from DOM
    document.body.innerHTML = '<div id="tab-code"></div>';

    const { tabPanel } = await loadCMView();
    expect(() => tabPanel.init()).not.toThrow();
  });
});

// ── tabPanel.show() with mock factory ────────────────────────────────────────

describe('tabPanel.show()', () => {
  it('calls the factory with the code tab parent', async () => {
    const { init, tabPanel } = await loadCMView();
    tabPanel.init();

    // Install a mock factory
    const mockFactory = vi.fn(() => ({
      state: { doc: { toString: () => 'body', length: 4 } },
      dispatch: vi.fn(),
      destroy: vi.fn(),
      dom: document.createElement('div'),
      focus: vi.fn(),
    }));
    init(mockFactory);

    await tabPanel.show({
      content: '---\ntitle: Test\n---\nHello world',
      noteData: { id: 'test', content: '---\ntitle: Test\n---\nHello world', meta: {} },
    });

    // Factory should be called with the tab-code element and the body
    expect(mockFactory).toHaveBeenCalledTimes(1);
    const [parent, initialDoc, onChange] = mockFactory.mock.calls[0];
    expect(parent).toBe(document.getElementById('tab-code'));
    // initialDoc should be the body without frontmatter
    expect(initialDoc).toBe('Hello world');
    // onChange should be a function
    expect(typeof onChange).toBe('function');
  });

  it('does not call factory if not initialized', async () => {
    const { tabPanel } = await loadCMView();
    // Don't call init() with a factory

    await tabPanel.show({
      content: 'plain text',
      noteData: { id: 'test', content: 'plain text', meta: {} },
    });

    // Should not throw — just returns early
  });

  it('reuses existing editor on second show (updates content)', async () => {
    const { init, tabPanel } = await loadCMView();
    tabPanel.init();

    let viewInstance = null;
    const mockFactory = vi.fn((parent, doc, onChange) => {
      viewInstance = {
        state: { doc: { toString: () => doc, length: doc.length } },
        dispatch: vi.fn(),
        destroy: vi.fn(),
        dom: document.createElement('div'),
        focus: vi.fn(),
      };
      return viewInstance;
    });
    init(mockFactory);

    // First show
    await tabPanel.show({
      content: 'Hello',
      noteData: { id: 'a', content: 'Hello', meta: {} },
    });
    expect(mockFactory).toHaveBeenCalledTimes(1);

    // Second show — should reuse, not recreate
    await tabPanel.show({
      content: 'Hello', // same content, no dispatch needed
      noteData: { id: 'a', content: 'Hello', meta: {} },
    });
    expect(mockFactory).toHaveBeenCalledTimes(1); // still 1

    // Third show with different content — should dispatch changes
    await tabPanel.show({
      content: 'World',
      noteData: { id: 'a', content: 'World', meta: {} },
    });
    expect(mockFactory).toHaveBeenCalledTimes(1); // still 1, reused
    // Should have dispatched to update the content
    expect(viewInstance.dispatch).toHaveBeenCalled();
  });

  it('does not dispatch when content is unchanged', async () => {
    const { init, tabPanel } = await loadCMView();
    tabPanel.init();

    const mockView = {
      state: { doc: { toString: () => 'same content', length: 12 } },
      dispatch: vi.fn(),
      destroy: vi.fn(),
      dom: document.createElement('div'),
      focus: vi.fn(),
    };

    init(() => mockView);

    await tabPanel.show({
      content: 'same content',
      noteData: { id: 'x', content: 'same content', meta: {} },
    });

    // Content is the same as current doc — no dispatch needed
    expect(mockView.dispatch).not.toHaveBeenCalled();
  });
});

// ── tabPanel.focus() ─────────────────────────────────────────────────────────

describe('tabPanel.focus()', () => {
  it('calls focus on the CM view if available', async () => {
    const { init, tabPanel } = await loadCMView();
    tabPanel.init();

    const mockView = {
      state: { doc: { toString: () => 'test', length: 4 } },
      dispatch: vi.fn(),
      destroy: vi.fn(),
      dom: document.createElement('div'),
      focus: vi.fn(),
    };
    init(() => mockView);

    await tabPanel.show({
      content: 'test',
      noteData: { id: 'x', content: 'test', meta: {} },
    });

    tabPanel.focus();
    expect(mockView.focus).toHaveBeenCalled();
  });

  it('does not throw when focus is called before show', async () => {
    const { tabPanel } = await loadCMView();
    tabPanel.init();
    expect(() => tabPanel.focus()).not.toThrow();
  });
});

// ── tabPanel.hide() ──────────────────────────────────────────────────────────

describe('tabPanel.hide()', () => {
  it('does not throw (no-op — textarea kept in sync by flush)', async () => {
    const { tabPanel } = await loadCMView();
    tabPanel.init();
    expect(() => tabPanel.hide()).not.toThrow();
  });
});

// ── Spellcheck language during cmShow ─────────────────────────────────────────

describe('spellcheck lang during cmShow', () => {
  it('resolves spellcheck language from frontmatter', async () => {
    // Must load both modules in the same reset context:
    // loadCMView() + loadSpellcheck() each call vi.resetModules(),
    // which would break the shared module state.  Load together.
    vi.resetModules();
    const cmView = await import('../../src/ts/codemirror-view.ts');
    const spellcheck = await import('../../src/ts/codemirror/spellcheck.ts');
    const { init, tabPanel } = cmView;
    const { getSpellcheckLang, setSpellcheckLang } = spellcheck;

    tabPanel.init();
    setSpellcheckLang('en-US');

    init(() => ({
      state: { doc: { toString: () => 'body', length: 4 } },
      dispatch: vi.fn(),
      destroy: vi.fn(),
      dom: document.createElement('div'),
      focus: vi.fn(),
    }));

    await tabPanel.show({
      content: '---\nlang: es\n---\nHola mundo',
      noteData: {
        id: 'test',
        content: '---\nlang: es\n---\nHola mundo',
        meta: { lang: 'es' },
      },
    });

    expect(getSpellcheckLang()).toBe('es');

    // Reset
    setSpellcheckLang('en-US');
  });

  it('falls back to default when no frontmatter lang', async () => {
    vi.resetModules();
    const cmView = await import('../../src/ts/codemirror-view.ts');
    const spellcheck = await import('../../src/ts/codemirror/spellcheck.ts');
    const { init, tabPanel } = cmView;
    const { getSpellcheckLang, setSpellcheckLang } = spellcheck;

    tabPanel.init();
    setSpellcheckLang('en-US');

    init(() => ({
      state: { doc: { toString: () => 'body', length: 4 } },
      dispatch: vi.fn(),
      destroy: vi.fn(),
      dom: document.createElement('div'),
      focus: vi.fn(),
    }));

    await tabPanel.show({
      content: 'No frontmatter, just body.',
      noteData: {
        id: 'test',
        content: 'No frontmatter, just body.',
        meta: {},
      },
    });

    // Should fall through to document lang or en-US
    expect(getSpellcheckLang()).toBe('en-US');
  });
});
