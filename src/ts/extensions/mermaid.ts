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

// ── Map application theme to Mermaid theme ─────────────────────────────────

function getMermaidTheme(): string {
  const appTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  switch (appTheme) {
    case 'dark':
    case 'paired-12':
      return 'dark';
    case 'light':
    case 'magenta':
    default:
      return 'neutral';
  }
}

registerHydrator('mermaid', async () => {
  const mermaid = await import('mermaid');

  // Apply current theme on initial load
  mermaid.default.initialize({
    startOnLoad: false,
    theme: getMermaidTheme() as any,
  });

  let idCounter = 0;

  const renderDiagram = async (source: string) => {
    const id = `mermaid-${idCounter++}`;
    const { svg } = await mermaid.default.render(id, source);
    return `<div class="mermaid-diagram">${svg}</div>`;
  };

  // ── Re-render all existing mermaid diagrams when theme changes ────────

  const rehydrateAll = () => {
    const blocks = document.querySelectorAll<HTMLElement>(
      'code[data-lang="mermaid"].hljs',
    );
    for (const el of blocks) {
      const raw = el.dataset.source;
      if (!raw) continue;
      const source = decodeURIComponent(escape(atob(raw)));
      // Use a temporary counter that won't collide — mermaid IDs must be
      // unique DOM-wide, so we suffix with a per-element random string.
      const rid = `mermaid-r-${Math.random().toString(36).slice(2, 8)}`;
      mermaid.default.render(rid, source).then(({ svg }) => {
        el.innerHTML = `<div class="mermaid-diagram">${svg}</div>`;
      }).catch((err: unknown) => {
        console.warn('[mermaid] re-render failed:', err);
      });
    }
  };

  // Watch for data-theme attribute changes on <html>
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'data-theme') {
        mermaid.default.initialize({
          startOnLoad: false,
          theme: getMermaidTheme() as any,
        });
        rehydrateAll();
        break;
      }
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  return renderDiagram;
});
