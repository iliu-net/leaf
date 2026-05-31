/**
 * footnote.ts — Footnote plugin via markdown-it-footnote
 *
 * Adds Pandoc-style footnote support:
 *   - Normal footnotes:  [^label] … [^label]: definition
 *   - Inline footnotes:  ^[inline content]
 *
 * Footnotes are rendered as a numbered list at the end of the document
 * with bidirectional links (ref → footnote, footnote ↩ back to ref).
 *
 * Plugin contract: default-export a function `(md, options?) => void`.
 */

import type MarkdownIt from 'markdown-it';
import footnotePlugin from 'markdown-it-footnote';
import { registerSystemNote } from '../system-notes/registry.js';
import footnoteDocs from './footnote-docs.md';

registerSystemNote({
  id: '@help:markdown:footnote',
  label: 'Footnotes',
  content: () => footnoteDocs,
});

const plugin: (md: MarkdownIt, _options?: void) => void = (md) => {
  md.use(footnotePlugin);
};

export default plugin;
