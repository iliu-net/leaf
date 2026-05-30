/**
 * highlight-themes.ts — CodeMirror syntax highlighting colour palettes
 *
 * Two HighlightStyle definitions (dark and light backgrounds) plus a
 * pure resolver function.  Extracted from setup.ts to keep that module
 * focused on the EditorView factory assembly.
 */

import { tags } from '@lezer/highlight';
import { HighlightStyle } from '@codemirror/language';

// ── Dark theme ────────────────────────────────────────────────────────────

/**
 * Bright, distinct colours optimised for readability on dark backgrounds.
 * Used by: dark, paired-12 themes.
 */
export const highlightDark = HighlightStyle.define([
  // ── Markdown structure ────────────────────────────────────────────────
  { tag: tags.heading1, color: '#ffa657', fontWeight: 'bold', fontSize: '1.5em' },
  { tag: tags.heading2, color: '#ffa657', fontWeight: 'bold', fontSize: '1.3em' },
  { tag: tags.heading3, color: '#ffa657', fontWeight: 'bold', fontSize: '1.15em' },
  { tag: tags.heading4, color: '#ffa657', fontWeight: 'bold' },
  { tag: tags.heading5, color: '#ffa657', fontWeight: 'bold' },
  { tag: tags.heading6, color: '#ffa657', fontWeight: 'bold' },
  { tag: tags.strong,      color: '#ff7b72', fontWeight: 'bold' },
  { tag: tags.emphasis,    color: '#d2a8ff', fontStyle: 'italic' },
  { tag: tags.strikethrough, color: '#8b949e', textDecoration: 'line-through' },
  { tag: tags.link,        color: '#58a6ff', textDecoration: 'underline' },
  { tag: tags.url,         color: '#7ee787', textDecoration: 'underline' },
  { tag: tags.monospace,   color: '#e6edf3', backgroundColor: '#ffffff15', borderRadius: '3px' },
  { tag: tags.quote,       color: '#8b949e', fontStyle: 'italic' },
  { tag: tags.list,        color: '#d4c4a0', fontWeight: 'bold' },
  { tag: tags.contentSeparator, color: '#b0a38b' },

  // ── Meta / hidden ─────────────────────────────────────────────────────
  { tag: tags.meta,                 color: '#6e7681' },
  { tag: tags.processingInstruction, color: '#6e7681', fontStyle: 'italic' },

  // ── Nested code blocks: keywords & literals ───────────────────────────
  { tag: tags.keyword,  color: '#79c0ff' },
  { tag: tags.atom,     color: '#79c0ff' },
  { tag: tags.bool,     color: '#79c0ff' },
  { tag: tags.self,     color: '#79c0ff' },
  { tag: tags.null,     color: '#79c0ff' },
  { tag: tags.string,   color: '#7ee787' },
  { tag: tags.character, color: '#7ee787' },
  { tag: tags.escape,   color: '#d2a8ff' },
  { tag: tags.number,   color: '#a5d6ff' },
  { tag: tags.regexp,   color: '#7ee787' },
  { tag: tags.color,    color: '#a5d6ff' },

  // ── Nested code blocks: names ─────────────────────────────────────────
  { tag: tags.typeName,       color: '#ffa657' },
  { tag: tags.className,      color: '#ffa657' },
  { tag: tags.tagName,        color: '#79c0ff' },
  { tag: tags.variableName,   color: '#e6edf3' },
  { tag: tags.propertyName,   color: '#79c0ff' },
  { tag: tags.attributeName,  color: '#d2a8ff' },
  { tag: tags.labelName,      color: '#79c0ff' },
  { tag: tags.namespace,      color: '#d2a8ff' },
  { tag: tags.macroName,      color: '#d2a8ff' },

  // ── Nested code blocks: operators & punctuation ───────────────────────
  { tag: tags.operator,   color: '#c9d1d9' },
  { tag: tags.punctuation,color: '#c9d1d9' },
  { tag: tags.separator,  color: '#c9d1d9' },
  { tag: tags.bracket,    color: '#c9d1d9' },

  // ── Nested code blocks: comments ──────────────────────────────────────
  { tag: tags.comment,     color: '#8b949e', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#8b949e', fontStyle: 'italic' },
  { tag: tags.blockComment,color: '#8b949e', fontStyle: 'italic' },
  { tag: tags.docComment,  color: '#8b949e', fontStyle: 'italic' },

  // ── Diff / change markers ─────────────────────────────────────────────
  { tag: tags.inserted, color: '#7ee787' },
  { tag: tags.deleted,  color: '#ff7b72' },
  { tag: tags.changed,  color: '#d2a8ff' },
  { tag: tags.invalid,  color: '#ff7b72', textDecoration: 'underline wavy' },
]);

// ── Light theme ───────────────────────────────────────────────────────────

/**
 * Distinct colours optimised for readability on light backgrounds.
 * Used by: light, magenta themes.
 */
export const highlightLight = HighlightStyle.define([
  // ── Markdown structure ────────────────────────────────────────────────
  { tag: tags.heading1, color: '#0550ae', fontWeight: 'bold', fontSize: '1.5em' },
  { tag: tags.heading2, color: '#0550ae', fontWeight: 'bold', fontSize: '1.3em' },
  { tag: tags.heading3, color: '#0550ae', fontWeight: 'bold', fontSize: '1.15em' },
  { tag: tags.heading4, color: '#0550ae', fontWeight: 'bold' },
  { tag: tags.heading5, color: '#0550ae', fontWeight: 'bold' },
  { tag: tags.heading6, color: '#0550ae', fontWeight: 'bold' },
  { tag: tags.strong,       color: '#cf222e', fontWeight: 'bold' },
  { tag: tags.emphasis,     color: '#8250df', fontStyle: 'italic' },
  { tag: tags.strikethrough,color: '#6e7781', textDecoration: 'line-through' },
  { tag: tags.link,         color: '#0550ae', textDecoration: 'underline' },
  { tag: tags.url,          color: '#116329', textDecoration: 'underline' },
  { tag: tags.monospace,    color: '#1a1a1a', backgroundColor: '#d0d7de52', borderRadius: '3px' },
  { tag: tags.quote,        color: '#6e7781', fontStyle: 'italic' },
  { tag: tags.list,         color: '#8250df', fontWeight: 'bold' },
  { tag: tags.contentSeparator, color: '#6e7781' },

  // ── Meta / hidden ─────────────────────────────────────────────────────
  { tag: tags.meta,                 color: '#6e7781' },
  { tag: tags.processingInstruction, color: '#6e7781', fontStyle: 'italic' },

  // ── Nested code blocks: keywords & literals ───────────────────────────
  { tag: tags.keyword,   color: '#cf222e' },
  { tag: tags.atom,      color: '#cf222e' },
  { tag: tags.bool,      color: '#cf222e' },
  { tag: tags.self,      color: '#cf222e' },
  { tag: tags.null,      color: '#cf222e' },
  { tag: tags.string,    color: '#0a3069' },
  { tag: tags.character, color: '#0a3069' },
  { tag: tags.escape,    color: '#8250df' },
  { tag: tags.number,    color: '#0550ae' },
  { tag: tags.regexp,    color: '#0a3069' },
  { tag: tags.color,     color: '#0550ae' },

  // ── Nested code blocks: names ─────────────────────────────────────────
  { tag: tags.typeName,      color: '#8250df' },
  { tag: tags.className,     color: '#8250df' },
  { tag: tags.tagName,       color: '#116329' },
  { tag: tags.variableName,  color: '#24292f' },
  { tag: tags.propertyName,  color: '#0550ae' },
  { tag: tags.attributeName, color: '#8250df' },
  { tag: tags.labelName,     color: '#0550ae' },
  { tag: tags.namespace,     color: '#8250df' },
  { tag: tags.macroName,     color: '#8250df' },

  // ── Nested code blocks: operators & punctuation ───────────────────────
  { tag: tags.operator,    color: '#24292f' },
  { tag: tags.punctuation, color: '#24292f' },
  { tag: tags.separator,   color: '#24292f' },
  { tag: tags.bracket,     color: '#24292f' },

  // ── Nested code blocks: comments ──────────────────────────────────────
  { tag: tags.comment,      color: '#6e7781', fontStyle: 'italic' },
  { tag: tags.lineComment,  color: '#6e7781', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#6e7781', fontStyle: 'italic' },
  { tag: tags.docComment,   color: '#6e7781', fontStyle: 'italic' },

  // ── Diff / change markers ─────────────────────────────────────────────
  { tag: tags.inserted, color: '#116329' },
  { tag: tags.deleted,  color: '#cf222e' },
  { tag: tags.changed,  color: '#8250df' },
  { tag: tags.invalid,  color: '#cf222e', textDecoration: 'underline wavy' },
]);

// ── Resolver ───────────────────────────────────────────────────────────────

/** Pick the right HighlightStyle for a theme name. */
export function resolveHighlight(theme: string) {
  return (theme === 'light' || theme === 'magenta') ? highlightLight : highlightDark;
}
