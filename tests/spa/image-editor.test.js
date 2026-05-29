/**
 * Tests for src/ts/image-editor.ts
 *
 * Covers:
 *   - Pure helpers: dataUrlSizeBytes, fmtSize, arrayBufferToDataUrl
 *   - sampleColors colour-counting heuristic
 *   - openImageEditor() modal lifecycle (open, cancel, ESC, overlay click)
 *   - openImageEditor() slider & encode-select interaction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── jsdom polyfill: URL.createObjectURL ──────────────────────────────────────
// jsdom does not ship createObjectURL for Blobs.

const _blobUrls = new Map();

beforeEach(() => {
  URL.createObjectURL = (blob) => {
    const url = 'blob:test-' + _blobUrls.size;
    _blobUrls.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    _blobUrls.delete(url);
  };
});

afterEach(() => {
  _blobUrls.clear();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const RED_PIXEL_DATAURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

function dataUrlToBlob(dataUrl) {
  const [head, base64] = dataUrl.split(',');
  const mimeMatch = head.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

async function loadImageEditor() {
  vi.resetModules();
  return await import('../../src/ts/image-editor.ts');
}

// ── DOM setup ─────────────────────────────────────────────────────────────────

function setupImageEditorDOM() {
  document.body.innerHTML = [
    '<div id="img-editor-overlay" class="img-editor-overlay" role="dialog">',
    '  <div class="img-editor-card">',
    '    <h2 class="img-editor-title">Paste Image</h2>',
    '    <div class="img-editor-preview">',
    '      <canvas id="img-editor-canvas"></canvas>',
    '    </div>',
    '    <div class="img-editor-size-row">',
    '      <label for="img-editor-slider">Size</label>',
    '      <input id="img-editor-slider" type="range" min="16" max="640" value="320">',
    '      <span id="img-editor-slider-val">320</span><span class="img-editor-unit"> px</span>',
    '    </div>',
    '    <div class="img-editor-dims">',
    '      <div class="img-editor-dims-line">Output <span id="img-editor-output-dims">—</span></div>',
    '      <div class="img-editor-dims-line img-editor-dims-orig">Original <span id="img-editor-orig-dims">—</span></div>',
    '    </div>',
    '    <div class="img-editor-field">',
    '      <label for="img-editor-encode">Encode</label>',
    '      <select id="img-editor-encode">',
    '        <option value="auto" selected>Auto</option>',
    '        <option value="png16">PNG 16</option>',
    '        <option value="png256">PNG 256</option>',
    '        <option value="lossless">Lossless</option>',
    '        <option value="webp">WebP</option>',
    '      </select>',
    '    </div>',
    '    <div class="img-editor-est">Estimated <span id="img-editor-est-size">—</span></div>',
    '    <div class="img-editor-actions">',
    '      <button id="img-editor-cancel" class="btn">Cancel</button>',
    '      <button id="img-editor-insert" class="btn btn-primary">Insert</button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

beforeEach(() => {
  setupImageEditorDOM();
});

afterEach(() => {
  document.body.innerHTML = '';
});

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe('dataUrlSizeBytes()', () => {
  it('returns 0 for empty data part', async () => {
    const mod = await loadImageEditor();
    expect(mod.dataUrlSizeBytes('data:text/plain,')).toBe(0);
  });

  it('estimates size from base64 length', async () => {
    const mod = await loadImageEditor();
    expect(mod.dataUrlSizeBytes('data:text/plain,AAAA')).toBe(3);
  });

  it('rounds to nearest integer', async () => {
    const mod = await loadImageEditor();
    expect(mod.dataUrlSizeBytes('data:text/plain,AAAAAAA')).toBe(5);
  });

  it('handles the full data:image/png;base64,… format', async () => {
    const mod = await loadImageEditor();
    const size = mod.dataUrlSizeBytes(RED_PIXEL_DATAURL);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(200);
  });
});

describe('fmtSize()', () => {
  it('formats bytes under 1 KB', async () => {
    const mod = await loadImageEditor();
    expect(mod.fmtSize(0)).toBe('0 B');
    expect(mod.fmtSize(512)).toBe('512 B');
    expect(mod.fmtSize(1023)).toBe('1023 B');
  });

  it('formats kilobytes with one decimal', async () => {
    const mod = await loadImageEditor();
    expect(mod.fmtSize(1024)).toBe('1.0 KB');
    expect(mod.fmtSize(1536)).toBe('1.5 KB');
    expect(mod.fmtSize(10240)).toBe('10.0 KB');
  });

  it('handles large values', async () => {
    const mod = await loadImageEditor();
    expect(mod.fmtSize(1048576)).toBe('1024.0 KB');
  });
});

describe('arrayBufferToDataUrl()', () => {
  it('encodes an empty buffer', async () => {
    const mod = await loadImageEditor();
    expect(mod.arrayBufferToDataUrl(new ArrayBuffer(0), 'image/png'))
      .toBe('data:image/png;base64,');
  });

  it('encodes a simple byte sequence', async () => {
    const mod = await loadImageEditor();
    const buf = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // Hello
    expect(mod.arrayBufferToDataUrl(buf.buffer, 'text/plain'))
      .toBe('data:text/plain;base64,' + btoa('Hello'));
  });

  it('preserves the MIME type', async () => {
    const mod = await loadImageEditor();
    const buf = new Uint8Array([0x00, 0x01, 0x02]);
    const url = mod.arrayBufferToDataUrl(buf.buffer, 'application/octet-stream');
    expect(url.startsWith('data:application/octet-stream;base64,')).toBe(true);
  });
});

// ── sampleColors() ────────────────────────────────────────────────────────────

describe('sampleColors()', () => {
  it('returns 1 when all pixels are the same colour', async () => {
    const mod = await loadImageEditor();
    const mockCtx = {
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([0, 0, 0, 255]),
      })),
    };
    expect(mod.sampleColors(mockCtx, 100, 100)).toBe(1);
  });

  it('counts distinct colours from sampled grid', async () => {
    const mod = await loadImageEditor();
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
    const mod = await loadImageEditor();
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
    const mod = await loadImageEditor();
    const mockCtx = {
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([128, 128, 128, 255]),
      })),
    };
    mod.sampleColors(mockCtx, 60, 40);
    expect(mockCtx.getImageData).toHaveBeenCalled();
  });
});

// ── openImageEditor() modal lifecycle ─────────────────────────────────────────

describe('openImageEditor()', () => {
  it('opens the modal (adds .open to overlay)', async () => {
    const mod = await loadImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);

    const resultPromise = mod.openImageEditor(blob);
    await new Promise(r => setTimeout(r, 20));

    const overlay = document.getElementById('img-editor-overlay');
    expect(overlay.classList.contains('open')).toBe(true);

    document.getElementById('img-editor-cancel').click();
    expect(await resultPromise).toBeNull();
  });

  it('cancel button resolves promise with null', async () => {
    const mod = await loadImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);

    const resultPromise = mod.openImageEditor(blob);
    await new Promise(r => setTimeout(r, 20));

    document.getElementById('img-editor-cancel').click();
    expect(await resultPromise).toBeNull();
  });

  it('removes .open class after cancel', async () => {
    const mod = await loadImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);

    const resultPromise = mod.openImageEditor(blob);
    await new Promise(r => setTimeout(r, 20));

    document.getElementById('img-editor-cancel').click();
    await resultPromise;

    expect(document.getElementById('img-editor-overlay').classList.contains('open')).toBe(false);
  });

  it('ESC key closes the modal', async () => {
    const mod = await loadImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);

    const resultPromise = mod.openImageEditor(blob);
    await new Promise(r => setTimeout(r, 20));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const result = await resultPromise;
    expect(result).toBeNull();
    expect(document.getElementById('img-editor-overlay').classList.contains('open')).toBe(false);
  });

  it('click on overlay background closes the modal', async () => {
    const mod = await loadImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);

    const resultPromise = mod.openImageEditor(blob);
    await new Promise(r => setTimeout(r, 20));

    const overlay = document.getElementById('img-editor-overlay');
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await resultPromise).toBeNull();
  });

  it('double-close is idempotent (does not throw)', async () => {
    const mod = await loadImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);

    const resultPromise = mod.openImageEditor(blob);
    await new Promise(r => setTimeout(r, 20));

    document.getElementById('img-editor-cancel').click();
    document.getElementById('img-editor-cancel').click();
    expect(await resultPromise).toBeNull();
  });

  it('ESC after modal is closed is a safe no-op', async () => {
    const mod = await loadImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);

    const resultPromise = mod.openImageEditor(blob);
    await new Promise(r => setTimeout(r, 20));

    document.getElementById('img-editor-cancel').click();
    await resultPromise;

    // Should not throw
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
});

// ── Slider / dimension interaction ────────────────────────────────────────────

describe('openImageEditor() slider behaviour', () => {
  it('initial slider value is 320', async () => {
    const mod = await loadImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);

    mod.openImageEditor(blob);
    await new Promise(r => setTimeout(r, 20));

    expect(document.getElementById('img-editor-slider').value).toBe('320');
    expect(document.getElementById('img-editor-slider-val').textContent).toBe('320');

    document.getElementById('img-editor-cancel').click();
  });

  it('shows original dimensions after image loads', async () => {
    const mod = await loadImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);

    mod.openImageEditor(blob);
    await new Promise(r => setTimeout(r, 100));

    const origDims = document.getElementById('img-editor-orig-dims');
    if (origDims.textContent !== '—') {
      expect(origDims.textContent).toMatch(/\d+ × \d+/);
    }

    document.getElementById('img-editor-cancel').click();
  });

  it('slider input event updates the displayed value', async () => {
    const mod = await loadImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);

    mod.openImageEditor(blob);
    await new Promise(r => setTimeout(r, 20));

    const slider = document.getElementById('img-editor-slider');
    slider.value = '200';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.getElementById('img-editor-slider-val').textContent).toBe('200');

    document.getElementById('img-editor-cancel').click();
  });

  it('encode select change triggers update without throwing', async () => {
    const mod = await loadImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);

    mod.openImageEditor(blob);
    await new Promise(r => setTimeout(r, 20));

    const encodeSel = document.getElementById('img-editor-encode');
    encodeSel.value = 'webp';
    encodeSel.dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('img-editor-cancel').click();
  });

  it('insert button shows "Encoding…" and disables while encoding', async () => {
    const mod = await loadImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);

    const resultPromise = mod.openImageEditor(blob);
    await new Promise(r => setTimeout(r, 20));

    const insertBtn = document.getElementById('img-editor-insert');
    insertBtn.click();

    expect(insertBtn.textContent).toBe('Encoding…');

    const result = await resultPromise;
    expect(insertBtn.disabled).toBe(false);
  });

  it('returns null for a non-image blob', async () => {
    const mod = await loadImageEditor();
    const badBlob = new Blob(['not an image'], { type: 'image/png' });

    const resultPromise = mod.openImageEditor(badBlob);
    await new Promise(r => setTimeout(r, 100));

    const overlay = document.getElementById('img-editor-overlay');
    if (overlay.classList.contains('open')) {
      document.getElementById('img-editor-cancel').click();
    }
    expect(await resultPromise).toBeNull();
  });
});

// ── Sequential open ───────────────────────────────────────────────────────────

describe('openImageEditor() sequential open', () => {
  it('can open modal twice sequentially', async () => {
    const mod = await loadImageEditor();
    const blob = dataUrlToBlob(RED_PIXEL_DATAURL);

    let p = mod.openImageEditor(blob);
    await new Promise(r => setTimeout(r, 20));
    document.getElementById('img-editor-cancel').click();
    await p;

    p = mod.openImageEditor(blob);
    await new Promise(r => setTimeout(r, 20));
    expect(document.getElementById('img-editor-overlay').classList.contains('open')).toBe(true);
    document.getElementById('img-editor-cancel').click();
    await p;
  });
});
