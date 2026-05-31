/**
 * inline-extras.ts — Custom inline markup plugin
 *
 * Syntax:
 *   ++inserted++  → <ins>inserted</ins>
 *   ^^superscript^^ → <sup>superscript</sup>
 *   ,,subscript,,   → <sub>subscript</sub>
 *   ==keyboard==    → <kbd>keyboard</kbd>
 *   ??highlight??   → <mark>highlight</mark>
 *
 * All markers are balanced (same two characters open and close).
 * Opening delimiter must not be preceded by a word character,
 * and closing delimiter must not be followed by a word character
 * (avoids accidental matches like C++ or trailing ?? in questions).
 *
 * Inner content is parsed for nested markdown (e.g. **bold** inside
 * ^^superscript^^ works).
 *
 * Plugin contract: default-export a function `(md: MarkdownIt) => void`.
 */

import type MarkdownIt from 'markdown-it';
import { registerSystemNote } from '../system-notes/registry.js';
import inlineExtrasDocs from './inline-extras-docs.md';

registerSystemNote({
  id: '@help:markdown:inline-extras',
  label: 'Inline Extras',
  content: () => inlineExtrasDocs,
});

// ── Marker map ──────────────────────────────────────────────────────────────

const MARKER_MAP: Record<string, string> = {
  '++': 'ins',
  '^^': 'sup',
  ',,': 'sub',
  '==': 'kbd',
  '??': 'mark',
};

const MARKERS = Object.keys(MARKER_MAP);

// ── Custom text rule ──────────────────────────────────────────────────────

/**
 * Extended terminator list.  The stock markdown-it text rule does not treat
 * `,` (0x2C) or `?` (0x3F) as terminators, so it consumes them as plain text
 * without giving other inline rules a chance.  We replace the text rule with
 * a copy that adds these two characters so our `,,`-subscript and `??`-mark
 * syntaxes work anywhere in a paragraph, not just at position 0.
 */
function isTerminatorChar(ch: number): boolean {
  switch (ch) {
    case 0x0A: /* \n */
    case 0x21: /* ! */
    case 0x23: /* # */
    case 0x24: /* $ */
    case 0x25: /* % */
    case 0x26: /* & */
    case 0x2A: /* * */
    case 0x2B: /* + */
    case 0x2C: /* , — added for ,,subscript,, */
    case 0x2D: /* - */
    case 0x3A: /* : */
    case 0x3C: /* < */
    case 0x3D: /* = */
    case 0x3E: /* > */
    case 0x3F: /* ? — added for ??mark?? */
    case 0x40: /* @ */
    case 0x5B: /* [ */
    case 0x5C: /* \ */
    case 0x5D: /* ] */
    case 0x5E: /* ^ */
    case 0x5F: /* _ */
    case 0x60: /* ` */
    case 0x7B: /* { */
    case 0x7D: /* } */
    case 0x7E: /* ~ */
      return true;
    default:
      return false;
  }
}

function customTextRule(state: any, silent: boolean): boolean {
  let pos = state.pos;
  while (pos < state.posMax && !isTerminatorChar(state.src.charCodeAt(pos))) {
    pos++;
  }
  if (pos === state.pos) return false;
  if (!silent) { state.pending += state.src.slice(state.pos, pos); }
  state.pos = pos;
  return true;
}

// ── Inline extras rule ─────────────────────────────────────────────────────

function inlineExtrasRule(state: any, silent: boolean): boolean {
  const src = state.src;
  const pos = state.pos;

  // Word-boundary guard: opening delimiter must not be preceded by a word
  // character.  Prevents C++ from matching, trailing ?? in "what??", etc.
  if (pos > 0 && /\w/.test(src[pos - 1])) return false;

  for (const marker of MARKERS) {
    if (!src.startsWith(marker, pos)) continue;
    // Found an opening marker — scan for the matching close.
    const closePos = src.indexOf(marker, pos + marker.length);
    if (closePos === -1) continue;

    // Word-boundary guard at close: must be followed by non-word or end.
    if (closePos + marker.length < src.length &&
        /\w/.test(src[closePos + marker.length])) {
      continue;
    }

    // Don't match empty content (e.g. "++++" is literal).
    if (closePos === pos + marker.length) continue;

    const content = src.slice(pos + marker.length, closePos);
    const tag = MARKER_MAP[marker];

    if (!silent) {
      // Parse inner content for nested markdown.
      const md: MarkdownIt = state.md;
      const rendered = md.renderInline(content);
      const token = state.push('html_inline', '', 0);
      token.content = `<${tag}>${rendered}</${tag}>`;
    }

    state.pos = closePos + marker.length;
    return true;
  }

  return false;
}

// ── Plugin entry point ─────────────────────────────────────────────────────

const plugin: (md: MarkdownIt) => void = (md) => {
  // Replace the built-in text rule with a copy that also treats , and ?
  // as terminator characters.  The stock rule skips past them, which
  // prevents our `,,` and `??` syntaxes from working mid-paragraph.
  md.inline.ruler.at('text', customTextRule);

  // Insert our rule before the (now-replaced) text rule so it gets first
  // look at every terminator character.
  md.inline.ruler.before('text', 'inline_extras', inlineExtrasRule);
};

export default plugin;
