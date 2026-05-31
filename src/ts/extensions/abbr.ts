/**
 * abbr.ts — Abbreviation plugin via markdown-it-abbr
 *
 * Adds abbreviation support: define *[abbr]: expansion anywhere in the
 * document, and every occurrence of "abbr" in plain text is wrapped in
 * an <abbr title="expansion"> tag.
 *
 * Plugin contract: default-export a function `(md, options?) => void`.
 */

import type MarkdownIt from 'markdown-it';
import abbrPlugin from 'markdown-it-abbr';
import { registerSystemNote } from '../system-notes/registry.js';
import abbrDocs from './abbr-docs.md';

registerSystemNote({
  id: '@help:markdown:abbr',
  label: 'Abbreviations',
  content: () => abbrDocs,
});

const plugin: (md: MarkdownIt, _options?: void) => void = (md) => {
  md.use(abbrPlugin);
};

export default plugin;
