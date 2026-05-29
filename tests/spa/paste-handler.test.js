/**
 * Tests for src/ts/codemirror/paste-handler.ts
 *
 * Covers:
 *   - extractImages() filtering of DataTransfer items
 *   - ensureTurndown() lazy-loading and caching
 *   - htmlToMarkdown() conversion (requires turndown to load)
 *   - Turndown service singleton pattern
 *   - PastePlugin existence and export shape
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function loadPasteHandler() {
  vi.resetModules();
  return await import('../../src/ts/codemirror/paste-handler.ts');
}

// ── extractImages() ──────────────────────────────────────────────────────────

describe('extractImages()', () => {
  it('returns empty array for empty DataTransferItemList', async () => {
    const { extractImages } = await loadPasteHandler();
    // jsdom doesn't have DataTransfer, so we mock a minimal items array
    const mockItems = {
      length: 0,
      0: undefined,
    };
    const result = extractImages(mockItems);
    expect(result).toEqual([]);
  });

  it('extracts image/png files', async () => {
    const { extractImages } = await loadPasteHandler();
    const fakeFile = new Blob(['fake'], { type: 'image/png' });
    const mockItems = {
      length: 1,
      0: {
        kind: 'file',
        type: 'image/png',
        getAsFile: () => fakeFile,
      },
      1: undefined,
    };
    const result = extractImages(mockItems);
    expect(result).toHaveLength(1);
    expect(result[0].blob).toBe(fakeFile);
  });

  it('extracts image/jpeg files', async () => {
    const { extractImages } = await loadPasteHandler();
    const fakeFile = new Blob(['jpeg'], { type: 'image/jpeg' });
    const mockItems = {
      length: 1,
      0: {
        kind: 'file',
        type: 'image/jpeg',
        getAsFile: () => fakeFile,
      },
    };
    const result = extractImages(mockItems);
    expect(result).toHaveLength(1);
    expect(result[0].blob).toBe(fakeFile);
  });

  it('skips non-image files', async () => {
    const { extractImages } = await loadPasteHandler();
    const mockItems = {
      length: 2,
      0: {
        kind: 'file',
        type: 'text/plain',
        getAsFile: () => new Blob(['text'], { type: 'text/plain' }),
      },
      1: {
        kind: 'file',
        type: 'application/pdf',
        getAsFile: () => new Blob(['pdf'], { type: 'application/pdf' }),
      },
    };
    const result = extractImages(mockItems);
    expect(result).toEqual([]);
  });

  it('skips items with kind !== "file"', async () => {
    const { extractImages } = await loadPasteHandler();
    const mockItems = {
      length: 1,
      0: {
        kind: 'string',
        type: 'image/png',
        getAsFile: () => null,
      },
    };
    const result = extractImages(mockItems);
    expect(result).toEqual([]);
  });

  it('handles items where getAsFile returns null', async () => {
    const { extractImages } = await loadPasteHandler();
    const mockItems = {
      length: 1,
      0: {
        kind: 'file',
        type: 'image/png',
        getAsFile: () => null,
      },
    };
    const result = extractImages(mockItems);
    expect(result).toEqual([]);
  });

  it('extracts multiple images from mixed items', async () => {
    const { extractImages } = await loadPasteHandler();
    const img1 = new Blob(['a'], { type: 'image/png' });
    const img2 = new Blob(['b'], { type: 'image/gif' });
    const mockItems = {
      length: 4,
      0: {
        kind: 'file',
        type: 'text/plain',
        getAsFile: () => new Blob(['text'], { type: 'text/plain' }),
      },
      1: {
        kind: 'file',
        type: 'image/png',
        getAsFile: () => img1,
      },
      2: {
        kind: 'string',
        type: 'text/html',
        getAsFile: () => null,
      },
      3: {
        kind: 'file',
        type: 'image/gif',
        getAsFile: () => img2,
      },
    };
    const result = extractImages(mockItems);
    expect(result).toHaveLength(2);
    expect(result[0].blob).toBe(img1);
    expect(result[1].blob).toBe(img2);
  });

  it('handles image/webp type', async () => {
    const { extractImages } = await loadPasteHandler();
    const fakeFile = new Blob(['webp'], { type: 'image/webp' });
    const mockItems = {
      length: 1,
      0: {
        kind: 'file',
        type: 'image/webp',
        getAsFile: () => fakeFile,
      },
    };
    const result = extractImages(mockItems);
    expect(result).toHaveLength(1);
  });

  it('handles image/svg+xml type', async () => {
    const { extractImages } = await loadPasteHandler();
    const fakeFile = new Blob(['<svg></svg>'], { type: 'image/svg+xml' });
    const mockItems = {
      length: 1,
      0: {
        kind: 'file',
        type: 'image/svg+xml',
        getAsFile: () => fakeFile,
      },
    };
    const result = extractImages(mockItems);
    expect(result).toHaveLength(1);
  });
});

// ── ensureTurndown() ─────────────────────────────────────────────────────────

describe('ensureTurndown()', () => {
  it('returns a Promise (or null if load fails)', async () => {
    const { ensureTurndown } = await loadPasteHandler();
    const result = ensureTurndown();
    // Should be a Promise (turndown should be available since it's in node_modules)
    expect(result).toBeInstanceOf(Promise);

    const service = await result;
    // turndown should load successfully in vitest
    expect(service).not.toBeNull();
    expect(typeof service.turndown).toBe('function');
  });

  it('returns the same promise instance on concurrent calls', async () => {
    const { ensureTurndown } = await loadPasteHandler();
    // Fresh module — both calls should return the same loading promise
    vi.resetModules();
    const fresh = await import('../../src/ts/codemirror/paste-handler.ts');

    const p1 = fresh.ensureTurndown();
    const p2 = fresh.ensureTurndown();
    expect(p1).toBe(p2); // Same promise instance

    await p1;
    await p2;
  });

  it('returns resolved promise once loaded (cached)', async () => {
    const { ensureTurndown } = await loadPasteHandler();
    const td1 = await ensureTurndown();
    const td2 = await ensureTurndown();
    expect(td1).toBe(td2); // Same instance, cached
  });

  it('handles fresh load (no cache)', async () => {
    vi.resetModules();
    const fresh = await import('../../src/ts/codemirror/paste-handler.ts');
    const td = await fresh.ensureTurndown();
    expect(td).not.toBeNull();
    expect(typeof td.turndown).toBe('function');
  });
});

// ── htmlToMarkdown() ─────────────────────────────────────────────────────────

describe('htmlToMarkdown()', () => {
  it('returns null when turndown is not loaded', async () => {
    // Fresh module before turndown is loaded
    vi.resetModules();
    const fresh = await import('../../src/ts/codemirror/paste-handler.ts');
    const result = fresh.htmlToMarkdown('<b>test</b>');
    expect(result).toBeNull();
  });

  it('converts basic HTML to Markdown', async () => {
    const { ensureTurndown, htmlToMarkdown } = await loadPasteHandler();
    await ensureTurndown();

    expect(htmlToMarkdown('<b>bold</b>')).toBe('**bold**');
    // turndown defaults to _ for emphasis (emDelimiter not configured)
    expect(htmlToMarkdown('<i>italic</i>')).toBe('_italic_');
    expect(htmlToMarkdown('<h1>Title</h1>')).toBe('# Title');
  });

  it('converts links', async () => {
    const { ensureTurndown, htmlToMarkdown } = await loadPasteHandler();
    await ensureTurndown();

    const result = htmlToMarkdown('<a href="https://example.com">Example</a>');
    expect(result).toBe('[Example](https://example.com)');
  });

  it('converts unordered lists', async () => {
    const { ensureTurndown, htmlToMarkdown } = await loadPasteHandler();
    await ensureTurndown();

    const result = htmlToMarkdown('<ul><li>A</li><li>B</li></ul>');
    // turndown uses 3-space indent after bullet marker
    expect(result).toContain('-   A');
    expect(result).toContain('-   B');
  });

  it('converts code blocks', async () => {
    const { ensureTurndown, htmlToMarkdown } = await loadPasteHandler();
    await ensureTurndown();

    const result = htmlToMarkdown('<pre><code>const x = 1;</code></pre>');
    expect(result).toContain('```');
    expect(result).toContain('const x = 1;');
  });

  it('converts images (HTML img tag)', async () => {
    const { ensureTurndown, htmlToMarkdown } = await loadPasteHandler();
    await ensureTurndown();

    const result = htmlToMarkdown('<img src="photo.png" alt="Photo">');
    expect(result).toBe('![Photo](photo.png)');
  });

  it('handles empty HTML string', async () => {
    const { ensureTurndown, htmlToMarkdown } = await loadPasteHandler();
    await ensureTurndown();

    const result = htmlToMarkdown('');
    // Empty HTML → empty Markdown
    expect(result).toBe('');
  });

  it('handles complex nested HTML', async () => {
    const { ensureTurndown, htmlToMarkdown } = await loadPasteHandler();
    await ensureTurndown();

    const html = '<div><h2>Section</h2><p>Some <strong>bold</strong> text with <em>emphasis</em>.</p><ul><li>Item 1</li><li>Item 2</li></ul></div>';
    const result = htmlToMarkdown(html);

    expect(result).toContain('## Section');
    expect(result).toContain('**bold**');
    expect(result).toContain('_emphasis_');
    expect(result).toContain('-   Item 1');
    expect(result).toContain('-   Item 2');
  });

  it('converts using ATX headings (as configured)', async () => {
    const { ensureTurndown, htmlToMarkdown } = await loadPasteHandler();
    await ensureTurndown();

    expect(htmlToMarkdown('<h1>H1</h1>')).toBe('# H1');
    expect(htmlToMarkdown('<h2>H2</h2>')).toBe('## H2');
    expect(htmlToMarkdown('<h3>H3</h3>')).toBe('### H3');
  });
});

// ── pasteHandler export ──────────────────────────────────────────────────────

describe('pasteHandler', () => {
  it('is exported as a ViewPlugin', async () => {
    const { pasteHandler } = await loadPasteHandler();
    expect(pasteHandler).toBeDefined();
    // A ViewPlugin has a spec property
    expect(typeof pasteHandler).toBe('object');
  });

  it('can be used as a CM extension', async () => {
    const { pasteHandler } = await loadPasteHandler();
    const { EditorView } = await import('@codemirror/view');
    const { EditorState } = await import('@codemirror/state');

    const parent = document.createElement('div');
    const view = new EditorView({
      state: EditorState.create({
        doc: 'test content',
        extensions: [pasteHandler],
      }),
      parent,
    });

    expect(view).toBeDefined();
    expect(view.state.doc.toString()).toBe('test content');

    view.destroy();
    parent.remove();
  });
});
