/**
 * image-editor.ts — Paste image resize / encode modal
 *
 * Receives a Blob from the clipboard, shows a preview canvas with a
 * single slider controlling the longest edge (aspect ratio locked
 * to the original), and returns a data: URL on confirm.
 *
 * Dependencies: upng-js (lazy-loaded for palette PNG encoding)
 */

import { DOM, $ } from './dom-ids.js';

// ── Types ─────────────────────────────────────────────────────────────────

export type EncodeMode = 'auto' | 'png16' | 'png256' | 'lossless' | 'webp';

export interface ImageEditorResult {
  dataUrl: string;
  sizeBytes: number;
}

// ── Constants ─────────────────────────────────────────────────────────────

const MAX_DIM = 640;
const MIN_DIM = 16;

// ── Public API ────────────────────────────────────────────────────────────

export function openImageEditor(blob: Blob): Promise<ImageEditorResult | null> {
  return new Promise(resolve => {
    const overlay   = $(DOM.IMG_EDITOR_OVERLAY);
    const canvas    = $(DOM.IMG_EDITOR_CANVAS) as HTMLCanvasElement;
    const slider    = $(DOM.IMG_EDITOR_SLIDER) as HTMLInputElement;
    const sliderVal = $(DOM.IMG_EDITOR_SLIDER_VAL);
    const outDims   = $(DOM.IMG_EDITOR_OUTPUT_DIMS);
    const origDims  = $(DOM.IMG_EDITOR_ORIG_DIMS);
    const encodeSel = $(DOM.IMG_EDITOR_ENCODE) as HTMLSelectElement;
    const estSizeEl = $(DOM.IMG_EDITOR_EST_SIZE);
    const insertBtn = $(DOM.IMG_EDITOR_INSERT_BTN) as HTMLButtonElement;
    const cancelBtn = $(DOM.IMG_EDITOR_CANCEL_BTN) as HTMLButtonElement;

    // ── State ──────────────────────────────────────────────────────────
    let image: HTMLImageElement | null = null;
    let originalW = 0;
    let originalH = 0;
    let _closed = false;

    function close(result: ImageEditorResult | null): void {
      if (_closed) return;
      _closed = true;
      overlay.classList.remove('open');
      resolve(result);
    }

    // ── Compute output dimensions from slider value ────────────────────
    function computeDims(sliderMax: number): [number, number] {
      if (!image) return [sliderMax, sliderMax];
      const ratio = originalW / originalH;
      // sliderMax is the longest-edge target.
      // Scale so the longer side equals sliderMax, shorter side follows.
      let w: number, h: number;
      if (ratio >= 1) {
        w = sliderMax;
        h = Math.max(1, Math.round(sliderMax / ratio));
      } else {
        h = sliderMax;
        w = Math.max(1, Math.round(sliderMax * ratio));
      }
      return [w, h];
    }

    // ── Load image ─────────────────────────────────────────────────────
    async function loadImage(): Promise<void> {
      const url = URL.createObjectURL(blob);
      image = new Image();
      image.onload = async () => {
        URL.revokeObjectURL(url);
        originalW = image!.naturalWidth;
        originalH = image!.naturalHeight;

        // Cap slider max to the original's longest edge (but at least MIN_DIM)
        const longest = Math.max(originalW, originalH);
        slider.max = String(Math.min(longest, MAX_DIM));
        // Default: fit within 320, but never exceed MAX_DIM or original
        const def = Math.min(320, Math.min(longest, MAX_DIM));
        slider.value = String(def);
        sliderVal.textContent = String(def);

        origDims.textContent = `${originalW} × ${originalH}`;
        onSliderChange();
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        close(null);
      };
      image.src = url;
    }

    // ── Preview ────────────────────────────────────────────────────────
    function renderPreview(w: number, h: number): void {
      if (!image) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(image, 0, 0, w, h);
    }

    // ── Encoding ───────────────────────────────────────────────────────
    function getEncodeMode(): EncodeMode {
      return encodeSel.value as EncodeMode;
    }

    async function encodeImage(w: number, h: number): Promise<string> {
      if (!image) throw new Error('No image loaded');
      const mode = getEncodeMode();

      const offCanvas = document.createElement('canvas');
      offCanvas.width = w;
      offCanvas.height = h;
      const ctx = offCanvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0, w, h);

      if (mode === 'webp') {
        return offCanvas.toDataURL('image/webp', 0.80);
      }
      if (mode === 'lossless') {
        const imgData = ctx.getImageData(0, 0, w, h);
        return encodeUPNG(imgData.data.buffer, w, h, 0);
      }
      if (mode === 'png16') {
        const imgData = ctx.getImageData(0, 0, w, h);
        return encodeUPNG(imgData.data.buffer, w, h, 16);
      }
      if (mode === 'png256') {
        const imgData = ctx.getImageData(0, 0, w, h);
        return encodeUPNG(imgData.data.buffer, w, h, 256);
      }

      // Auto
      const uniqueColors = sampleColors(ctx, w, h);
      if (uniqueColors > 200) {
        return offCanvas.toDataURL('image/webp', 0.80);
      } else {
        const imgData = ctx.getImageData(0, 0, w, h);
        return encodeUPNG(imgData.data.buffer, w, h, 16);
      }
    }

    // ── Slider change → update everything ─────────────────────────────
    async function onSliderChange(): Promise<void> {
      const maxDim = parseInt(slider.value, 10) || 320;
      sliderVal.textContent = String(maxDim);

      const [w, h] = computeDims(maxDim);
      outDims.textContent = `${w} × ${h}`;
      renderPreview(w, h);
      updateEstimate(w, h);
    }

    async function updateEstimate(w: number, h: number): Promise<void> {
      try {
        const url = await encodeImage(w, h);
        estSizeEl.textContent = fmtSize(dataUrlSizeBytes(url));
      } catch {
        estSizeEl.textContent = '—';
      }
    }

    // ── Event wiring ──────────────────────────────────────────────────
    slider.addEventListener('input', onSliderChange);
    encodeSel.addEventListener('change', () => onSliderChange());

    insertBtn.addEventListener('click', async () => {
      insertBtn.disabled = true;
      insertBtn.textContent = 'Encoding…';
      try {
        const maxDim = parseInt(slider.value, 10) || 320;
        const [w, h] = computeDims(maxDim);
        const dataUrl = await encodeImage(w, h);
        close({ dataUrl, sizeBytes: dataUrlSizeBytes(dataUrl) });
      } catch (err) {
        console.error('[image-editor] Insert failed:', err);
        close(null);
      }
    });

    cancelBtn.addEventListener('click', () => close(null));

    function onEsc(e: KeyboardEvent): void {
      if (e.key === 'Escape' && overlay.classList.contains('open')) close(null);
    }
    document.addEventListener('keydown', onEsc);

    overlay.addEventListener('click', e => {
      if (e.target === overlay) close(null);
    });

    // Clean up on close
    const origResolve = resolve;
    resolve = (result) => {
      document.removeEventListener('keydown', onEsc);
      insertBtn.disabled = false;
      insertBtn.textContent = 'Insert';
      origResolve(result);
    };

    // ── Open ───────────────────────────────────────────────────────────
    overlay.classList.add('open');
    loadImage();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

export async function encodeUPNG(
  buffer: ArrayBuffer,
  w: number,
  h: number,
  cnum: number,
): Promise<string> {
  const UPNG = (await import('upng-js')).default;
  const rgba = new Uint8Array(buffer);
  const pngBuf: ArrayBuffer = UPNG.encode([rgba], w, h, cnum);
  return arrayBufferToDataUrl(pngBuf, 'image/png');
}

export function sampleColors(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): number {
  const stepX = Math.max(1, Math.floor(w / 20));
  const stepY = Math.max(1, Math.floor(h / 20));
  const seen = new Set<number>();
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      seen.add((r << 16) | (g << 8) | b);
      if (seen.size > 250) return seen.size;
    }
  }
  return seen.size;
}

export function dataUrlSizeBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.round(base64.length * 0.75);
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function arrayBufferToDataUrl(buf: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
