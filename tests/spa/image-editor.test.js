/**
 * Tests for src/ts/image-utils.ts and the image-editor bridge.
 *
 * Covers:
 *   - Pure helpers: dataUrlSizeBytes, fmtSize, arrayBufferToDataUrl, sampleColors
 *   - openImageEditor() bridge (CustomEvent → __imgEditorCalls registry)
 *
 * React component tests for ImageEditor.tsx are deferred to Phase C6
 * (see docs/plans/test-migration.md).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Polyfill: crypto.randomUUID ───────────────────────────────────────────────
// jsdom may not provide it.

if (!crypto.randomUUID) {
  let _id = 0;
  crypto.randomUUID = () => `test-uuid-${++_id}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const RED_PIXEL_DATAURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

function dataUrlToBlob(dataUrl) {
  const [head, base64] = dataUrl.split(',');
  const mimeMatch = head.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

// ── Pure helpers (image-utils.ts) ──────────────────────────────────────────────

async function loadImageUtils() {
  vi.resetModules();
  return await import('../../src/ts/image-utils.ts');
}

describe('dataUrlSizeBytes()', () => {
  it('returns 0 for empty data part', async () => {
    const mod = await loadImageUtils();
    expect(mod.dataUrlSizeBytes('data:text/plain,')).toBe(0);
  });

  it('estimates size from base64 length', async () => {
    const mod = await loadImageUtils();
    expect(mod.dataUrlSizeBytes('data:text/plain,AAAA')).toBe(3);
  });

  it('rounds to nearest integer', async () => {
    const mod = await loadImageUtils();
    expect(mod.dataUrlSizeBytes('data:text/plain,AAAAAAA')).toBe(5);
  });

  it('handles the full data:image/png;base64,… format', async () => {
    const mod = await loadImageUtils();
    const size = mod.dataUrlSizeBytes(RED_PIXEL_DATAURL);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(200);
  });
});

describe('fmtSize()', () => {
  it('formats bytes under 1 KB', async () => {
    const mod = await loadImageUtils();
    expect(mod.fmtSize(0)).toBe('0 B');
    expect(mod.fmtSize(512)).toBe('512 B');
    expect(mod.fmtSize(1023)).toBe('1023 B');
  });

  it('formats kilobytes with one decimal', async () => {
    const mod = await loadImageUtils();
    expect(mod.fmtSize(1024)).toBe('1.0 KB');
    expect(mod.fmtSize(1536)).toBe('1.5 KB');
    expect(mod.fmtSize(10240)).toBe('10.0 KB');
  });

  it('handles large values', async () => {
    const mod = await loadImageUtils();
    expect(mod.fmtSize(1048576)).toBe('1024.0 KB');
  });
});

describe('arrayBufferToDataUrl()', () => {
  it('encodes an empty buffer', async () => {
    const mod = await loadImageUtils();
    expect(mod.arrayBufferToDataUrl(new ArrayBuffer(0), 'image/png'))
      .toBe('data:image/png;base64,');
  });

  it('encodes a simple byte sequence', async () => {
    const mod = await loadImageUtils();
    const buf = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // Hello
    expect(mod.arrayBufferToDataUrl(buf.buffer, 'text/plain'))
      .toBe('data:text/plain;base64,' + btoa('Hello'));
  });

  it('preserves the MIME type', async () => {
    const mod = await loadImageUtils();
    const buf = new Uint8Array([0x00, 0x01, 0x02]);
    const url = mod.arrayBufferToDataUrl(buf.buffer, 'application/octet-stream');
    expect(url.startsWith('data:application/octet-stream;base64,')).toBe(true);
  });
});

describe('sampleColors()', () => {
  it('returns 1 when all pixels are the same colour', async () => {
    const mod = await loadImageUtils();
    const mockCtx = {
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([0, 0, 0, 255]),
      })),
    };
    expect(mod.sampleColors(mockCtx, 100, 100)).toBe(1);
  });

  it('counts distinct colours from sampled grid', async () => {
    const mod = await loadImageUtils();
    let call = 0;
    const mockCtx = {
      getImageData: vi.fn(() => {
        const isRed = (call++ % 2 === 0);
        return { data: new Uint8ClampedArray(isRed ? [255, 0, 0, 255] : [0, 0, 255, 255]) };
      }),
    };
    expect(mod.sampleColors(mockCtx, 100, 100)).toBe(2);
  });

  it('stops early when unique colour threshold (>250) is exceeded', async () => {
    const mod = await loadImageUtils();
    let idx = 0;
    const mockCtx = {
      getImageData: vi.fn(() => {
        const v = idx++;
        return { data: new Uint8ClampedArray([v % 256, (v >> 8) % 256, (v >> 16) % 256, 255]) };
      }),
    };
    const count = mod.sampleColors(mockCtx, 500, 500);
    expect(count).toBeGreaterThan(250);
    expect(count).toBeLessThanOrEqual(260);
  });

  it('samples with a grid step based on dimensions', async () => {
    const mod = await loadImageUtils();
    const mockCtx = {
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([128, 128, 128, 255]),
      })),
    };
    mod.sampleColors(mockCtx, 60, 40);
    expect(mockCtx.getImageData).toHaveBeenCalled();
  });
});

// ── openImageEditor() bridge ─────────────────────────────────────────────────

async function loadOpenImageEditor() {
  vi.resetModules();
  const mod = await import('../../src/ts/codemirror/paste-handler.ts');
  return mod.openImageEditor;
}

describe('openImageEditor() bridge', () => {
  beforeEach(() => {
    delete window.__imgEditorCalls;
  });

  afterEach(() => {
    delete window.__imgEditorCalls;
  });

  it('returns a Promise', async () => {
    const openImageEditor = await loadOpenImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);
    const result = openImageEditor(blob);
    expect(result).toBeInstanceOf(Promise);
    // Clean up — resolve it via the registry
    window.__imgEditorCalls?.[Object.keys(window.__imgEditorCalls)[0]]?.(null);
  });

  it('initialises __imgEditorCalls registry on first call', async () => {
    expect(window.__imgEditorCalls).toBeUndefined();

    const openImageEditor = await loadOpenImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);
    const p = openImageEditor(blob);

    expect(window.__imgEditorCalls).toBeDefined();
    expect(typeof window.__imgEditorCalls).toBe('object');

    // Clean up
    const key = Object.keys(window.__imgEditorCalls)[0];
    window.__imgEditorCalls[key](null);
    await p;
  });

  it('dispatches a leaf:open-image-editor CustomEvent', async () => {
    const openImageEditor = await loadOpenImageEditor();
    const handler = vi.fn();
    window.addEventListener('leaf:open-image-editor', handler);

    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);
    const p = openImageEditor(blob);

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.type).toBe('leaf:open-image-editor');
    expect(event.detail.blob).toBe(blob);
    expect(typeof event.detail.id).toBe('string');
    expect(event.detail.id.length).toBeGreaterThan(0);

    // Clean up
    window.removeEventListener('leaf:open-image-editor', handler);
    window.__imgEditorCalls[event.detail.id](null);
    await p;
  });

  it('resolves with the value passed to the registry callback', async () => {
    const openImageEditor = await loadOpenImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);

    const p = openImageEditor(blob);

    // Resolve via the registry
    const key = Object.keys(window.__imgEditorCalls)[0];
    const result = { dataUrl: 'data:image/png;base64,abc', sizeBytes: 2 };
    window.__imgEditorCalls[key](result);

    await expect(p).resolves.toBe(result);
  });

  it('resolves with null when registry callback is called with null', async () => {
    const openImageEditor = await loadOpenImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);

    const p = openImageEditor(blob);

    const key = Object.keys(window.__imgEditorCalls)[0];
    window.__imgEditorCalls[key](null);

    await expect(p).resolves.toBeNull();
  });

  it('supports multiple concurrent calls', async () => {
    const openImageEditor = await loadOpenImageEditor();

    const blob1 = dataUrlToBlob(RED_PIXEL_DATAURL);
    const blob2 = new Blob(['fake'], { type: 'image/png' });

    const p1 = openImageEditor(blob1);
    const p2 = openImageEditor(blob2);

    const keys = Object.keys(window.__imgEditorCalls);
    expect(keys).toHaveLength(2);

    // Each call gets a unique key
    expect(keys[0]).not.toBe(keys[1]);

    // Resolve in reverse order
    window.__imgEditorCalls[keys[1]]({ dataUrl: 'data:2', sizeBytes: 2 });
    window.__imgEditorCalls[keys[0]]({ dataUrl: 'data:1', sizeBytes: 1 });

    const r1 = await p1;
    const r2 = await p2;
    expect(r1).toEqual({ dataUrl: 'data:1', sizeBytes: 1 });
    expect(r2).toEqual({ dataUrl: 'data:2', sizeBytes: 2 });

    // Registry keys persist after resolve — cleanup is the React component's
    // job (ImageEditor.close() deletes them after calling the callback).
    expect(typeof window.__imgEditorCalls[keys[0]]).toBe('function');
    expect(typeof window.__imgEditorCalls[keys[1]]).toBe('function');

    // Simulate what ImageEditor.close() does
    delete window.__imgEditorCalls[keys[0]];
    delete window.__imgEditorCalls[keys[1]];
    expect(window.__imgEditorCalls[keys[0]]).toBeUndefined();
    expect(window.__imgEditorCalls[keys[1]]).toBeUndefined();
  });

  it('each call gets a unique id', async () => {
    const openImageEditor = await loadOpenImageEditor();
    const ids = [];

    const handler = vi.fn(e => ids.push(e.detail.id));
    window.addEventListener('leaf:open-image-editor', handler);

    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);
    const p1 = openImageEditor(blob);
    const p2 = openImageEditor(blob);
    const p3 = openImageEditor(blob);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3); // all unique

    window.removeEventListener('leaf:open-image-editor', handler);
    ids.forEach(id => window.__imgEditorCalls[id]?.(null));
    await Promise.all([p1, p2, p3]);
  });
});
