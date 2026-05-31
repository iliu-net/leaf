/**
 * toc.ts — Table of Contents plugin via markdown-it-toc-done-right
 *
 * Replaces a [TOC] placeholder in markdown with an auto-generated
 * table of contents based on the document's headings.
 *
 * The default placeholder regex already matches [TOC] and many
 * other spellings ([[toc]], ${toc}, etc.) case-insensitively.
 *
 * Plugin contract: default-export a function `(md, options?) => void`.
 */

import type MarkdownIt from 'markdown-it';
import tocPlugin from 'markdown-it-toc-done-right';
import anchorPlugin from 'markdown-it-anchor';
import { registerSystemNote } from '../system-notes/registry.js';
import tocDocs from './toc-docs.md';

registerSystemNote({
  id: '@help:markdown:toc',
  label: 'Table of Contents',
  content: () => tocDocs,
});

const plugin: (md: MarkdownIt, options?: any) => void = (md, opts) => {
  const merged = {
    containerClass: 'table-of-contents',
    level: [1, 2, 3],
    ...opts,
  };

  // Add id attributes to headings so TOC links have targets to scroll to.
  // Both libraries use the same default slugify function, so href and id
  // values match without any custom configuration.
  md.use(anchorPlugin, {
    level: merged.level,
    permalink: false,
  });

  md.use(tocPlugin, merged);
};

export default plugin;
