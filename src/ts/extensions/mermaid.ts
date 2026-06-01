/**
 * mermaid.ts — Mermaid diagram rendering via the fence hydration pipeline
 *
 * Plugin contract: default-export a function `(md, options?) => void`.
 *
 * On load:
 *   1. Registers a fence renderer for "mermaid" language tag
 *      that wraps matching blocks with data-lang="mermaid" and
 *      base64-encoded source
 *   2. Registers a "mermaid" hydrator that lazy-loads mermaid.js
 *      and renders diagram definitions to inline SVG
 */

import type MarkdownIt from 'markdown-it';
import { registerFenceRenderer } from '../markdown.js';
import { registerHydrator } from '../fence-hydrate.js';
import { registerSystemNote } from '../system-notes/registry.js';
import mermaidDocs from './mermaid-docs.md';

registerSystemNote({
  id: '@help:markdown:mermaid',
  label: 'Mermaid Diagrams',
  content: () => mermaidDocs,
});

// ── Plugin entry point ─────────────────────────────────────────────────────

const plugin: (md: MarkdownIt, options?: any) => void = (_md, _opts) => {
  // No per-instance configuration needed — mermaid has its own config API
};

export default plugin;

// ── Fence renderer (mermaid) ───────────────────────────────────────────────
// Wraps fenced code blocks tagged "mermaid" with data-lang and
// data-source so the hydrator can pick them up later.
// Registered on module load so the fence chain is set up before any
// markdown parsing happens.

registerFenceRenderer(['mermaid'], (tokens, idx) => {
  const source = tokens[idx].content;
  const encoded = btoa(unescape(encodeURIComponent(source)));
  const escaped = tokens[idx].content; // already HTML-escaped by markdown-it
  return (
    `<pre><code class="language-mermaid"`
    + ` data-lang="mermaid" data-source="${encoded}">`
    + escaped
    + `</code></pre>`
  );
});

// ── Hydrator registration ──────────────────────────────────────────────────
//
// mermaid.js is a large library (~800 KB).  It is dynamically imported
// only when at least one mermaid code block exists on the page.  The
// render function calls mermaid.render() with unique IDs to avoid
// DOM conflicts.

registerHydrator('mermaid', async () => {
  const mermaid = await import('mermaid');
  mermaid.default.initialize({
    startOnLoad: false,
    theme: 'neutral',
  });
  let idCounter = 0;
  return async (source: string) => {
    const id = `mermaid-${idCounter++}`;
    const { svg } = await mermaid.default.render(id, source);
    return `<div class="mermaid-diagram">${svg}</div>`;
  };
});
