/**
 * mathjax.ts — TeX/LaTeX and AsciiMath rendering via KaTeX
 *
 * Plugin contract: default-export a function `(md, options?) => void`.
 *
 * Supports two families of language tags:
 *   tex / latex / math    → TeX/LaTeX input (rendered by KaTeX)
 *   asciimath / amath     → AsciiMath input (converted to LaTeX, then KaTeX)
 *
 * Uses KaTeX (~250 KB) instead of MathJax (~1.5 MB) for a much smaller
 * bundle.  AsciiMath is converted to LaTeX via the lightweight
 * `asciimath-to-latex` package, then rendered through the same KaTeX
 * pipeline.
 *
 * On load:
 *   1. Registers fence renderers for both families that wrap blocks
 *      with data-lang="mathjax-tex" or data-lang="mathjax-am" and
 *      base64-encoded source
 *   2. Registers hydrators for both families that share a single
 *      KaTeX bootstrap
 */

import type MarkdownIt from 'markdown-it';
import { registerFenceRenderer } from '../markdown.js';
import { registerHydrator } from '../fence-hydrate.js';
import { registerSystemNote } from '../system-notes/registry.js';
import mathjaxDocs from './mathjax-docs.md';

registerSystemNote({
  id: '@help:markdown:mathjax',
  label: 'Math Rendering (KaTeX)',
  content: () => mathjaxDocs,
});

// ── Plugin entry point ─────────────────────────────────────────────────────

const plugin: (md: MarkdownIt, options?: any) => void = (_md, _opts) => {
  // No per-instance configuration needed
};

export default plugin;

// ── Fence renderers ────────────────────────────────────────────────────────
// Registered on module load so the fence chain is set up before any
// markdown parsing happens.

function makeFenceRenderer(dataLang: string) {
  return (tokens: any[], idx: number): string => {
    const source = tokens[idx].content;
    const encoded = btoa(unescape(encodeURIComponent(source)));
    const escaped = tokens[idx].content; // already HTML-escaped by markdown-it
    const lang = tokens[idx].info.trim().split(/\s+/)[0];
    return (
      `<pre><code class="language-${lang}"`
      + ` data-lang="${dataLang}" data-source="${encoded}">`
      + escaped
      + `</code></pre>`
    );
  };
}

registerFenceRenderer(['tex', 'latex', 'math'], makeFenceRenderer('mathjax-tex'));
registerFenceRenderer(['asciimath', 'amath'], makeFenceRenderer('mathjax-am'));

// ── KaTeX bootstrap ────────────────────────────────────────────────────────
// KaTeX is a self-contained library that renders LaTeX to HTML with inline
// CSS.  No external fonts, DOM adaptor, or document model needed.

interface Renderer {
  /** Render a LaTeX formula to HTML. */
  renderTex(formula: string): string;
  /** Convert AsciiMath to LaTeX, then render to HTML.
   *  Loads the converter lazily on first call. */
  renderAm(formula: string): Promise<string>;
}

async function bootstrap(): Promise<Renderer> {
  const katex = await import('katex');

  const render = (formula: string, displayMode: boolean): string => {
    try {
      return katex.renderToString(formula, {
        displayMode,
        throwOnError: false,   // show source in red on parse failure
        strict: false,         // don't warn about non-standard LaTeX
        trust: true,           // allow \\href, \\includegraphics etc.
      });
    } catch {
      // Catastrophic parse failures still throw even with throwOnError: false
      return `<span class="katex-error">${formula}</span>`;
    }
  };

  // ── Lazy asciimath-to-latex converter ────────────────────────────────
  // Only loaded when the first AsciiMath block is rendered.

  type Am2LatexFn = (input: string) => string;
  let _am2latex: Am2LatexFn | null = null;

  return {
    renderTex(formula: string): string {
      return render(formula, true);
    },

    async renderAm(formula: string): Promise<string> {
      if (!_am2latex) {
        const am = await import('asciimath-to-latex');
        const raw = (am as any).default;
        _am2latex = (typeof raw === 'function' ? raw : raw?.default) as Am2LatexFn;
      }
      const latex = _am2latex(formula);
      return render(latex, true);
    },
  };
}

// ── Hydrator registrations ─────────────────────────────────────────────────
// Both hydrators share a single KaTeX bootstrap.  The first hydrator
// to load kicks off the bootstrap; the second reuses the cached result.

let _renderer: Promise<Renderer> | null = null;

function getRenderer(): Promise<Renderer> {
  if (!_renderer) {
    _renderer = bootstrap();
  }
  return _renderer;
}

registerHydrator('mathjax-tex', async () => {
  const r = await getRenderer();
  return async (source: string) => {
    return `<div class="mathjax-diagram">${r.renderTex(source.trim())}</div>`;
  };
});

registerHydrator('mathjax-am', async () => {
  const r = await getRenderer();
  return async (source: string) => {
    return `<div class="mathjax-diagram">${await r.renderAm(source.trim())}</div>`;
  };
});
