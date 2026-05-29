/**
 * icons.ts — Central registry of SVG icons used across the app.
 *
 * Every inline SVG <path> string lives here so icon markup is never
 * duplicated or scattered across view modules.
 */

// ── Icon path strings ──────────────────────────────────────────────────────────

/** Icon paths keyed by name.  Each value is the innerHTML for an SVG element. */
export const ICONS = {
  /** Document / note file icon (Feather file-text) */
  DOCUMENT:
    '<path d="M9 12h6m-6 4h6m2 4H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l5 5v11a2 2 0 0 1-2 2z"/>',

  /** Trash / delete icon (Feather trash-2) */
  TRASH:
    '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14"/>',
} as const;

export type IconName = keyof typeof ICONS;

// ── SVG attribute defaults ─────────────────────────────────────────────────────

/** Default SVG attributes shared across all inline icons. */
export const SVG_ATTRS = {
  xmlns: 'http://www.w3.org/2000/svg',
  width:  '13',
  height: '13',
  fill:   'none',
  stroke: 'currentColor',
  'stroke-width': '1.5',
  viewBox: '0 0 24 24',
  'aria-hidden': 'true',
} as const;

// ── Icon builder ───────────────────────────────────────────────────────────────

/**
 * Create an <svg> element with standard attributes and the given icon path.
 *
 * @param path     The SVG innerHTML path string (e.g. `ICONS.DOCUMENT`).
 * @param overrides Optional per-instance attr overrides (e.g. `{ width: '16' }`).
 */
export function createIcon(
  path: string,
  overrides: Partial<Record<string, string>> = {},
): SVGElement {
  const ns = SVG_ATTRS.xmlns;
  const el = document.createElementNS(ns, 'svg');

  // Apply default attributes
  el.setAttribute('width',         SVG_ATTRS.width);
  el.setAttribute('height',        SVG_ATTRS.height);
  el.setAttribute('fill',          SVG_ATTRS.fill);
  el.setAttribute('stroke',        SVG_ATTRS.stroke);
  el.setAttribute('stroke-width',  SVG_ATTRS['stroke-width']);
  el.setAttribute('viewBox',       SVG_ATTRS.viewBox);
  el.setAttribute('aria-hidden',   SVG_ATTRS['aria-hidden']);

  // Apply overrides
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) el.setAttribute(k, v);
  }

  el.innerHTML = path;
  return el;
}
