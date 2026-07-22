/**
 * image-utils.ts — Pure image processing helpers.
 *
 * Extracted from ImageEditor.tsx so they can be tested independently
 * of the React component.  Used by both the component and the test suite.
 */

/**
 * Estimate the byte size of a base64 data URL (excludes the header).
 * Each base64 character encodes 6 bits → 0.75 bytes per character.
 */
export function dataUrlSizeBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.round(base64.length * 0.75);
}

/**
 * Format a byte count as a human-readable size string.
 * Uses KB only — image outputs are small enough that MB is unnecessary.
 */
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Convert an ArrayBuffer to a base64 data URL with the given MIME type.
 */
export function arrayBufferToDataUrl(buf: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * Count the number of unique colours in a canvas image using a sparse
 * sampling grid.  Stops early if the count exceeds 250 (photographic image).
 *
 * @param ctx  Canvas 2D rendering context with the image already drawn.
 * @param w    Image width in pixels.
 * @param h    Image height in pixels.
 */
export function sampleColors(ctx: CanvasRenderingContext2D, w: number, h: number): number {
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
