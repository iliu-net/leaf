/**
 * deflist.ts — Definition list plugin via markdown-it-deflist
 *
 * Adds Pandoc-style definition lists:
 *   Term
 *   : Definition
 *
 * Terms and definitions can span multiple lines.  Markdown formatting
 * inside definitions is fully supported.
 *
 * Plugin contract: default-export a function `(md, options?) => void`.
 */

import type MarkdownIt from 'markdown-it';
import deflistPlugin from 'markdown-it-deflist';
import { registerSystemNote } from '../system-notes/registry.js';
import deflistDocs from './deflist-docs.md';

registerSystemNote({
  id: '@help:markdown:deflist',
  label: 'Definition Lists',
  content: () => deflistDocs,
});

const plugin: (md: MarkdownIt, _options?: void) => void = (md) => {
  md.use(deflistPlugin);
};

export default plugin;
