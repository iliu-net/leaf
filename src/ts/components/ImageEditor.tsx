/**
 * ImageEditor.tsx — Paste-image resize/encode modal.
 *
 * Full React port.  Receives paste events via a window CustomEvent bridge
 * dispatched by the CodeMirror paste-handler (paste-handler.ts).  All image
 * processing, encoding, and preview logic lives here.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  dataUrlSizeBytes,
  fmtSize,
  arrayBufferToDataUrl,
  sampleColors,
} from '../image-utils.js';

// ── Types ─────────────────────────────────────────────────────────────────

export type EncodeMode = 'auto' | 'png16' | 'png256' | 'lossless' | 'webp';

export interface ImageEditorResult {
  dataUrl: string;
  sizeBytes: number;
}

// ── Constants ─────────────────────────────────────────────────────────────

const MAX_DIM = 640;

// ── Component ─────────────────────────────────────────────────────────────

export default function ImageEditor() {
  // ── State ────────────────────────────────────────────────────────────
  const [editId, setEditId] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);

  const [sliderVal, setSliderVal] = useState(320);
  const [sliderMax, setSliderMax] = useState(MAX_DIM);
  const [outputDims, setOutputDims] = useState('—');
  const [origDims, setOrigDims] = useState('—');
  const [encodeMode, setEncodeMode] = useState<EncodeMode>('auto');
  const [estSize, setEstSize] = useState('—');
  const [encoding, setEncoding] = useState(false);

  // ── Refs (stable across renders; async helpers read .current) ────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const origWRef = useRef(0);
  const origHRef = useRef(0);
  const encodeModeRef = useRef<EncodeMode>('auto');
  const estimateGenRef = useRef(0);
  const editIdRef = useRef<string | null>(null);

  // Keep refs in sync so async functions always see the latest value.
  encodeModeRef.current = encodeMode;
  editIdRef.current = editId;

  // ── Window event → open the editor ───────────────────────────────────

  useEffect(() => {
    function handler(e: Event) {
      const { id, blob: b } = (e as CustomEvent).detail as {
        id: string;
        blob: Blob;
      };
      editIdRef.current = id;
      imageRef.current = null;
      setEditId(id);
      setBlob(b);
      setSliderVal(320);
      setSliderMax(MAX_DIM);
      setOutputDims('—');
      setOrigDims('—');
      setEncodeMode('auto');
      setEstSize('—');
      setEncoding(false);
    }
    window.addEventListener('leaf:open-image-editor', handler);
    return () => window.removeEventListener('leaf:open-image-editor', handler);
  }, []);

  // ── Close & resolve the paste-handler promise ────────────────────────

  const close = useCallback((result: ImageEditorResult | null) => {
    const id = editIdRef.current;
    if (id) {
      const reg = (window as any).__imgEditorCalls;
      if (reg?.[id]) {
        reg[id](result);
        delete reg[id];
      }
    }
    editIdRef.current = null;
    imageRef.current = null;
    setEditId(null);
    setBlob(null);
  }, []);

  // ── Image loading (runs when a new blob arrives) ─────────────────────

  useEffect(() => {
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const img = new Image();
    imageRef.current = img;

    img.onload = () => {
      URL.revokeObjectURL(url);
      origWRef.current = img.naturalWidth;
      origHRef.current = img.naturalHeight;

      const longest = Math.max(img.naturalWidth, img.naturalHeight);
      const max = Math.min(longest, MAX_DIM);
      const def = Math.min(320, max);

      setSliderMax(max);
      setSliderVal(def);
      setOrigDims(`${img.naturalWidth} × ${img.naturalHeight}`);

      renderPreview(img, def);
      computeAndShow(def);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      close(null);
    };

    img.src = url;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [blob, close]);

  // ── Dimension helpers ────────────────────────────────────────────────

  function computeDims(maxDim: number): [number, number] {
    if (!imageRef.current) return [maxDim, maxDim];
    const ratio = origWRef.current / origHRef.current;
    if (ratio >= 1) {
      return [maxDim, Math.max(1, Math.round(maxDim / ratio))];
    }
    return [Math.max(1, Math.round(maxDim * ratio)), maxDim];
  }

  function renderPreview(img: HTMLImageElement, maxDim: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const [w, h] = computeDims(maxDim);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
  }

  function computeAndShow(maxDim: number) {
    const [w, h] = computeDims(maxDim);
    setOutputDims(`${w} × ${h}`);
    updateEstimate(w, h);
  }

  // ── Slider change ────────────────────────────────────────────────────

  function onSliderChange(val: number) {
    setSliderVal(val);
    const img = imageRef.current;
    if (!img) return;
    renderPreview(img, val);
    computeAndShow(val);
  }

  // ── Encoding ─────────────────────────────────────────────────────────

  async function encodeImage(w: number, h: number): Promise<string> {
    const img = imageRef.current;
    if (!img) throw new Error('No image loaded');

    const offCanvas = document.createElement('canvas');
    offCanvas.width = w;
    offCanvas.height = h;
    const ctx = offCanvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);

    const mode = encodeModeRef.current;

    if (mode === 'webp') {
      return offCanvas.toDataURL('image/webp', 0.8);
    }
    if (mode === 'lossless') {
      const imgData = ctx.getImageData(0, 0, w, h);
      return encodeUPNG(imgData.data, w, h, 0);
    }
    if (mode === 'png16') {
      const imgData = ctx.getImageData(0, 0, w, h);
      return encodeUPNG(imgData.data, w, h, 16);
    }
    if (mode === 'png256') {
      const imgData = ctx.getImageData(0, 0, w, h);
      return encodeUPNG(imgData.data, w, h, 256);
    }

    // Auto
    const uniqueColors = sampleColors(ctx, w, h);
    if (uniqueColors > 200) {
      return offCanvas.toDataURL('image/webp', 0.8);
    }
    const imgData = ctx.getImageData(0, 0, w, h);
    return encodeUPNG(imgData.data, w, h, 16);
  }

  async function updateEstimate(w: number, h: number) {
    const gen = ++estimateGenRef.current;
    try {
      const url = await encodeImage(w, h);
      if (gen !== estimateGenRef.current) return; // stale — newer estimate in flight
      setEstSize(fmtSize(dataUrlSizeBytes(url)));
    } catch {
      if (gen !== estimateGenRef.current) return;
      setEstSize('—');
    }
  }

  // ── Insert handler ───────────────────────────────────────────────────

  async function handleInsert() {
    setEncoding(true);
    try {
      const [w, h] = computeDims(sliderVal);
      const dataUrl = await encodeImage(w, h);
      close({ dataUrl, sizeBytes: dataUrlSizeBytes(dataUrl) });
    } catch (err) {
      console.error('[image-editor] Insert failed:', err);
      close(null);
    }
  }

  // ── Escape key ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!blob) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close(null);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [blob, close]);

  // ── Render ───────────────────────────────────────────────────────────

  if (!blob) return null;

  return (
    <div
      className="img-editor-overlay open"
      role="dialog"
      aria-modal="true"
      aria-label="Edit image"
      onClick={e => {
        if (e.target === e.currentTarget) close(null);
      }}
    >
      <div className="img-editor-card">
        <h2 className="img-editor-title">Paste Image</h2>

        <div className="img-editor-preview">
          <canvas ref={canvasRef} />
        </div>

        <div className="img-editor-size-row">
          <label htmlFor="img-editor-slider">Size</label>
          <input
            id="img-editor-slider"
            type="range"
            min={16}
            max={sliderMax}
            value={sliderVal}
            onChange={e => onSliderChange(parseInt(e.target.value, 10) || 320)}
          />
          <span id="img-editor-slider-val">{sliderVal}</span>
          <span className="img-editor-unit"> px</span>
        </div>

        <div className="img-editor-dims">
          <div className="img-editor-dims-line">
            Output <span>{outputDims}</span>
          </div>
          <div className="img-editor-dims-line img-editor-dims-orig">
            Original <span>{origDims}</span>
          </div>
        </div>

        <div className="img-editor-field">
          <label htmlFor="img-editor-encode">Encode</label>
          <select
            id="img-editor-encode"
            value={encodeMode}
            onChange={e => {
              setEncodeMode(e.target.value as EncodeMode);
              onSliderChange(sliderVal);
            }}
          >
            <option value="auto">Auto</option>
            <option value="png16">PNG 16</option>
            <option value="png256">PNG 256</option>
            <option value="lossless">Lossless</option>
            <option value="webp">WebP</option>
          </select>
        </div>

        <div className="img-editor-est">
          Estimated <span>{estSize}</span>
        </div>

        <div className="img-editor-actions">
          <button className="btn" onClick={() => close(null)} disabled={encoding}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleInsert} disabled={encoding}>
            {encoding ? 'Encoding…' : 'Insert'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Pure encoding utilities ────────────────────────────────────────────────

/** Encode RGBA pixel data as an indexed PNG via upng-js, returned as a data URL. */
async function encodeUPNG(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  cnum: number,
): Promise<string> {
  const UPNG = (await import('upng-js')).default;
  // Create a clean copy of the pixel data.  This solves two problems:
  // 1. byteOffset: ImageData.data.buffer may start at a non-zero offset.
  // 2. Uint8Array vs ArrayBuffer: UPNG internally calls
  //    `new Uint32Array(bufs[j])`.  When bufs[j] is an ArrayBuffer this
  //    creates a VIEW (4 bytes → 1 pixel, correct).  When it's a
  //    TypedArray the spec says *convert element-by-element*, producing
  //    4× too many uint32s (each a single channel value).  Passing
  //    .buffer avoids that.
  const rgba = new Uint8Array(data);
  const bufs: any[] = [rgba.buffer];  // ArrayBuffer — avoids TS inferring Uint8Array
  const pngBuf = UPNG.encode(bufs, w, h, cnum) as ArrayBuffer;
  return arrayBufferToDataUrl(pngBuf, 'image/png');
}
