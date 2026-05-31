/**
 * multimd-table.ts — MultiMarkdown table plugin via markdown-it-multimd-table
 *
 * Extends the standard pipe-table syntax with MultiMarkdown 6 features:
 *   - colspan (|| at end of cell)
 *   - rowspan (^^ in cell) — optional
 *   - multiple table headers
 *   - table captions ([caption text] line after table)
 *   - multiple tbody sections (blank line between rows)
 *   - headerless tables (|---|---| separator without a header row above)
 *   - multiline cells (backslash at end of line) — optional
 *
 * Plugin contract: default-export a function `(md, options?) => void`.
 */

import type MarkdownIt from 'markdown-it';
import multimdTablePlugin from 'markdown-it-multimd-table';
import { registerSystemNote } from '../system-notes/registry.js';
import multimdTableDocs from './multimd-table-docs.md';

registerSystemNote({
  id: '@help:markdown:multimd-table',
  label: 'MultiMarkdown Tables',
  content: () => multimdTableDocs,
});

export interface MultimdTableOptions {
  multiline?: boolean;
  rowspan?: boolean;
  headerless?: boolean;
  multibody?: boolean;
  autolabel?: boolean;
}

const plugin: (md: MarkdownIt, options?: MultimdTableOptions) => void = (md, opts) => {
  md.use(multimdTablePlugin, {
    multiline:  opts?.multiline  ?? false,
    rowspan:    opts?.rowspan    ?? false,
    headerless: opts?.headerless ?? true,
    multibody:  opts?.multibody  ?? true,
    autolabel:  opts?.autolabel  ?? true,
  });
};

export default plugin;
