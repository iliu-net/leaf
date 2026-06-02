/**
 * highlight.ts — highlight.js syntax highlighting via the fence hydration pipeline
 *
 * Plugin contract: default-export a function `(md, options?) => void`.
 * The `options` parameter receives the language list from the server
 * config (e.g. ["javascript", "python", "css"]).
 *
 * On load:
 *   1. Stores the language list
 *   2. Registers a catch-all fence renderer (empty languages = match all)
 *      that wraps every code block with data-lang="highlight" and
 *      base64-encoded source
 *   3. Registers a "highlight" hydrator that lazy-loads highlight.js core
 *      and only the configured language grammars
 */

import type MarkdownIt from 'markdown-it';
import { registerFenceRenderer } from '../markdown.js';
import { registerHydrator } from '../fence-hydrate.js';
import { registerSystemNote } from '../system-notes/registry.js';
import highlightDocs from './highlight-docs.md';

registerSystemNote({
  id: '@help:markdown:highlight',
  label: 'Syntax Highlighting',
  content: () => highlightDocs,
});

// ── Presets ────────────────────────────────────────────────────────────────

/** Curated set of popular languages.  Use `['highlight', 'common']` in config. */
const COMMON_LANGS = [
  'bash', 'c', 'cpp', 'css', 'diff', 'go', 'html', 'java',
  'javascript', 'json', 'markdown', 'php', 'plaintext', 'python',
  'ruby', 'rust', 'sql', 'typescript', 'xml', 'yaml',
];

// ── State ──────────────────────────────────────────────────────────────────

let _langs: string[] = ['javascript', 'python', 'css', 'bash', 'json'];

// ── Plugin entry point ─────────────────────────────────────────────────────

const plugin: (md: MarkdownIt, options?: any) => void = (_md, langs) => {
  if (langs === 'common') {
    _langs = COMMON_LANGS;
  } else if (Array.isArray(langs) && langs.length > 0) {
    const hasCommon = langs.includes('common');
    const extras = langs.filter((l: string) => l !== 'common');
    _langs = hasCommon
      ? [...new Set([...COMMON_LANGS, ...extras])]
      : extras;
  }
};

export default plugin;

// ── Catch-all fence renderer ───────────────────────────────────────────────
// Wraps EVERY fenced code block (regardless of language tag) with
// data-lang and data-source so the hydrator can pick it up later.
// Called on module load (before or after instance creation — markdown.ts
// queues fence renderers).

registerFenceRenderer([], (tokens, idx) => {
  const source = tokens[idx].content;
  const encoded = btoa(unescape(encodeURIComponent(source)));
  const lang = tokens[idx].info.trim().split(/\s+/)[0] || '';
  const escaped = tokens[idx].content; // already HTML-escaped by markdown-it
  return (
    `<pre><code class="language-${lang}"`
    + ` data-lang="highlight" data-highlight-lang="${lang}" data-source="${encoded}">`
    + escaped
    + `</code></pre>`
  );
});

// ── Hydrator registration ──────────────────────────────────────────────────

registerHydrator('highlight', async () => {
  const hljs = await import('highlight.js/lib/core');

  // Each language is a separate code-split chunk — only loaded if configured
  const langModules: Record<string, () => Promise<any>> = {
    awk:         () => import('highlight.js/lib/languages/awk'),
    bash:        () => import('highlight.js/lib/languages/bash'),
    c:           () => import('highlight.js/lib/languages/c'),
    cpp:         () => import('highlight.js/lib/languages/cpp'),
    css:         () => import('highlight.js/lib/languages/css'),
    diff:        () => import('highlight.js/lib/languages/diff'),
    go:          () => import('highlight.js/lib/languages/go'),
    hcl:         () => import('./hcl-grammar.js'),
    html:        () => import('highlight.js/lib/languages/xml'),
    ini:         () => import('highlight.js/lib/languages/ini'),
    java:        () => import('highlight.js/lib/languages/java'),
    javascript:  () => import('highlight.js/lib/languages/javascript'),
    json:        () => import('highlight.js/lib/languages/json'),
    markdown:    () => import('highlight.js/lib/languages/markdown'),
    mkd:         () => import('highlight.js/lib/languages/markdown'),  // alias
    nginx:       () => import('highlight.js/lib/languages/nginx'),
    perl:        () => import('highlight.js/lib/languages/perl'),
    php:         () => import('highlight.js/lib/languages/php'),
    plaintext:   () => import('highlight.js/lib/languages/plaintext'),
    python:      () => import('highlight.js/lib/languages/python'),
    ruby:        () => import('highlight.js/lib/languages/ruby'),
    rust:        () => import('highlight.js/lib/languages/rust'),
    sh:          () => import('highlight.js/lib/languages/bash'),
    shell:       () => import('highlight.js/lib/languages/bash'),
    sql:         () => import('highlight.js/lib/languages/sql'),
    tcl:         () => import('highlight.js/lib/languages/tcl'),
    terraform:   () => import('./hcl-grammar.js'),
    text:        () => import('highlight.js/lib/languages/plaintext'),  // alias
    typescript:  () => import('highlight.js/lib/languages/typescript'),
    vbscript:    () => import('highlight.js/lib/languages/vbscript'),
    vbs:         () => import('highlight.js/lib/languages/vbscript'),  // alias
    xml:         () => import('highlight.js/lib/languages/xml'),
    yaml:        () => import('highlight.js/lib/languages/yaml'),
  };

  // Load only the configured languages — each language is its own chunk
  for (const lang of _langs) {
    const loader = langModules[lang];
    if (loader) {
      try {
        const mod = await loader();
        hljs.default.registerLanguage(lang, mod.default);
      } catch {
        console.warn(`[highlight] failed to load language: "${lang}"`);
      }
    }
  }

  // Alias map: fence language tag → highlight.js language name.
  // These cover common shorthands that differ from highlight.js's naming.
  const LANG_ALIAS: Record<string, string> = {
    sh:        'bash',
    shell:     'bash',
    mkd:       'markdown',
    text:      'plaintext',
    txt:       'plaintext',
    terraform: 'hcl',
    tf:        'hcl',
    vbs:       'vbscript',
    js:        'javascript',
    ts:        'typescript',
    py:        'python',
    rb:        'ruby',
    rs:        'rust',
    yml:       'yaml',
    svg:       'xml',   // highlight.js uses xml grammar for SVG
  };

  // Return the render function
  return async (source: string, el: HTMLElement) => {
    // Resolve the explicit language from the fence tag (e.g. ```python)
    const fenceLang = (el.dataset.highlightLang || '').trim();
    const resolved = LANG_ALIAS[fenceLang] || fenceLang;

    // If we have an explicit language that is registered (or can be
    // registered on-the-fly), use it directly — this avoids the
    // auto-detection mis-classifying code (e.g. python detected as
    // javascript because of // comments, or text detected as bash).
    if (resolved && !hljs.default.getLanguage(resolved)) {
      // Try to load the language on demand if we have a loader for it
      const loader = langModules[resolved];
      if (loader) {
        try {
          const mod = await loader();
          hljs.default.registerLanguage(resolved, mod.default);
        } catch {
          // ignore — fall through to auto-detect
        }
      }
    }

    if (resolved && hljs.default.getLanguage(resolved)) {
      const result = hljs.default.highlight(source, { language: resolved });
      return result.value;
    }

    // Fall back to auto-detection for untagged blocks or unknown languages
    const result = _langs.length > 0
      ? hljs.default.highlightAuto(source, _langs)
      : hljs.default.highlightAuto(source);
    return result.value;
  };
});
