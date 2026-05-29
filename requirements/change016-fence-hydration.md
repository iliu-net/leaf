# Phase 2 — Lazy Fence Renderers (Fenced Code Block Hydration)

## Problem

markdown-it's `render()` is **synchronous**.  Diagram renderers (mermaid,
viz.js, svgbob-wasm) weigh hundreds of KB and must be loaded **asynchronously**.
They cannot run inside `parse()`.

Syntax highlighting (highlight.js / Prism) has the same constraint — the library
is too heavy for the initial bundle and should only load when a note actually
contains fenced code blocks.

### When no fence renderers are enabled

This is the common case — a deployment with only standard plugins like
`"emoji"`.  markdown-it's built-in fence rule handles all code blocks,
producing standard HTML:

```html
<pre><code class="language-javascript">console.log("hello");
</code></pre>
```

No `data-lang` or `data-source` attributes.  The hydration step finds zero
`[data-lang]` elements and returns immediately — zero overhead, zero imports.
This is the same behaviour as before the plugin system existed.

## Solution: Two-Pass Rendering

```
Markdown source
    │
    ▼  pass 1 (synchronous)
markdown-it render()  →  parse() in markdown.ts
    │
    ▼
HTML with <pre><code data-lang="mermaid" data-source="..."> placeholders
    │
    ▼  pass 2 (asynchronous)
DOM tree walk → hydrate() in markdown-view.ts
    │
    ▼
Dynamic import() of renderer → swap placeholder content with rendered SVG/HTML
```

---

## Pass 1 — Synchronous Parse (Placeholders)

`registerFenceRenderer()` is called for each special language.  The renderer does
**not** render the diagram — it emits a standard `<pre><code>` block with extra
attributes:

```html
<pre><code class="language-mermaid" data-lang="mermaid" data-source="Z3JhcGggVEQKICBBIC0tPiBC">
graph TD
  A --> B
</code></pre>
```

- **`data-lang`** — identifies which renderer to load during hydration
- **`data-source`** — base64-encoded original source text (avoids escaping issues with HTML entities)
- **`<code>` inner text** — still shows the raw source; acts as a **loading state** and **graceful fallback** if hydration fails or JS is disabled

### Fence Renderer Registration

```typescript
// In the plugin wrapper module (e.g. extensions/mermaid.ts)
import { registerFenceRenderer } from '../markdown.js';

registerFenceRenderer(['mermaid'], (tokens, idx) => {
  const source = tokens[idx].content;
  const encoded = btoa(unescape(encodeURIComponent(source)));
  const lang = 'mermaid';
  const escaped = tokens[idx].content;  // markdown-it already escapes HTML entities
  return (
    `<pre><code class="language-${lang}" data-lang="${lang}" data-source="${encoded}">`
    + escaped +
    `</code></pre>`
  );
});
```

### Syntax Highlighting (catch-all)

A catch-all fence renderer wraps every non-special code block the same way.
Languages without a diagram renderer fall through to syntax highlighting during
hydration.

---

## Pass 2 — Asynchronous Hydration

After `innerHTML` is set (in `markdown-view.ts`), a `hydrate(root)` function runs:

```typescript
// markdown-view.ts (or a separate extensions/fence-hydrate.ts)
export async function hydrate(root: Element): Promise<void> {
  const placeholders = root.querySelectorAll<HTMLElement>('[data-lang]');
  if (placeholders.length === 0) return;

  // Group by language so we only load each renderer once
  const byLang = new Map<string, HTMLElement[]>();
  for (const el of placeholders) {
    const lang = el.dataset.lang!;
    if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang)!.push(el);
  }

  for (const [lang, els] of byLang) {
    const hydrator = _hydrators[lang];
    if (!hydrator) continue;  // unknown language → leave as plain code block

    try {
      const renderFn = await hydrator();  // lazy import() — once per language group
      for (const el of els) {
        try {
          const source = decodeURIComponent(escape(atob(el.dataset.source!)));
          const output = await renderFn(source);
          el.innerHTML = output;  // swap rendered output into the <code> element
          el.classList.add('fence-rendered');
        } catch (err) {
          // Per-block failure — leave as plain code block
          console.warn(`[hydrate] failed to render ${lang} block:`, err);
        }
      }
    } catch (err) {
      // Renderer failed to load — leave all blocks as plain code
      console.warn(`[hydrate] failed to load renderer for "${lang}":`, err);
    }
  }
}
```

### Hydrator Registry

```typescript
const _hydrators: Record<string, () => Promise<(source: string) => Promise<string>>> = {
  mermaid: async () => {
    const mermaid = await import('mermaid');
    let idCounter = 0;
    mermaid.default.initialize({ startOnLoad: false, theme: 'neutral' });
    return async (source: string) => {
      const { svg } = await mermaid.default.render(`mermaid-${idCounter++}`, source);
      return svg;
    };
  },

  'viz-dot': async () => {
    const { Graphviz } = await import('@hpcc-js/wasm/graphviz');
    const gv = await Graphviz.load();
    return async (source: string) => gv.dot(source, 'svg');
  },

  svgbob: async () => {
    // svgbob-wasm — renders ASCII diagrams to SVG
    const svgbob = await import('svgbob-wasm');
    await svgbob.default();  // init WASM
    return async (source: string) => svgbob.convert_string(source);
  },
};
```

### Integration in markdown-view.ts

```typescript
export async function show(ctx: TabPanelContext): Promise<void> {
  if (!_viewHeader || !_viewContent) return;

  const html = await renderView(ctx.content, ctx.noteData);

  const m = html.match(/^(<h1[^>]*>.*?<\/h1>)/);
  _viewHeader.innerHTML = m ? m[1] : '';
  _viewContent.innerHTML = m ? html.slice(m[1].length) : html;

  // ← new: hydrate fence blocks after DOM is set
  import('./extensions/fence-hydrate.js')
    .then(m => m.hydrate(_viewContent!))
    .catch(err => console.warn('[markdown-view] hydrate failed:', err));

  // Ditto for renderView() — both call sites need it
}
```

---

## Error Handling & Edge Cases

| Scenario | Behaviour |
|---|---|
| **No fenced blocks on page** | `hydrate()` finds zero `[data-lang]` elements → returns immediately, no imports triggered |
| **Renderer fails to load** (offline, 404) | All blocks of that language stay as plain `<pre><code>` with source visible |
| **Single block fails to render** (malformed diagram) | That block stays as source; other blocks of same language rendered normally |
| **JS disabled** | `<pre><code>` with source text displayed — fully readable fallback |
| **Multiple blocks same language** | Renderer loaded once via `import()`, reused for all blocks |
| **Nested HTML in source** | `data-source` uses base64 → no escaping needed |
| **XSS** | `data-source` decoded and passed to renderer; renderer output (SVG) is trusted. markdown-it already escapes HTML entities in `<code>` content during parse. |

---

## Bundle Size Strategy

| Module | When loaded | Approx. size |
|---|---|---|
| mermaid | First `mermaid` block | ~800 KB |
| @hpcc-js/wasm (viz.js) | First `viz-dot` block | ~1 MB |
| svgbob-wasm | First `svgbob` block | ~200 KB |
| highlight.js | First non-special code block | ~40 KB core + ~5 KB per language |

None of these enter the initial bundle.  esbuild code-splitting extracts each
into its own chunk via the dynamic `import()` calls.

---

## Trigger via Server Config

Fence renderers are activated through the same `markdown.plugins` mechanism
from Phase 1.  Plugins that need options (like highlight's language list)
use a **tuple** format: `[name, ...options]` instead of a plain string.

```php
// api/config.php
$spa_config = [
    'markdown' => [
        'html'    => false,
        'plugins' => [
            'emoji',
            'mermaid',
            'viz-dot',
            'svgbob',
            ['highlight', ['javascript', 'python', 'css', 'bash', 'json', 'markdown']],
        ],
    ],
];
```

`loadPlugins()` handles both forms:

```typescript
// Plain string → use(plugin)
// Tuple        → use(plugin, ...options)
for (const entry of entries) {
  const [name, ...options] = Array.isArray(entry) ? entry : [entry];
  const plugin = await loadFromRegistry(name);
  use(plugin, options.length ? options : undefined);
}
```

Each plugin name resolves through the registry in `markdown.ts`:

```typescript
const _pluginRegistry = {
  // Phase 1
  emoji:      () => import('./extensions/emoji.js').then(m => m.default),

  // Phase 2 (future)
  mermaid:    () => import('./extensions/mermaid.js').then(m => m.default),
  'viz-dot':  () => import('./extensions/viz-dot.js').then(m => m.default),
  svgbob:     () => import('./extensions/svgbob.js').then(m => m.default),
  highlight:  () => import('./extensions/highlight.js').then(m => m.default),
};
```

Each wrapper module calls `registerFenceRenderer()` on load to wire up its
placeholder → hydration chain.  The `hydrate()` function in
`markdown-view.ts` handles all languages uniformly — adding a new renderer
just means adding a hydrator entry and registering the fence renderer.

---

## Highlight.js — Language List via Options

highlight.js is the first fence renderer that needs per-plugin configuration.
The language list comes from the server config tuple and controls which
grammar modules are dynamically imported.

### Wrapper module (`src/ts/extensions/highlight.ts`)

```typescript
import type MarkdownIt from 'markdown-it';

let _langs: string[] = [];

const plugin: (md: MarkdownIt, options?: any) => void = (_md, langs) => {
  if (Array.isArray(langs)) _langs = langs;
};
export default plugin;
export function getHighlightLanguages(): string[] { return _langs; }
```

The wrapper stores the language list — no markdown-it registration needed
(the hydrator does the actual work).  `registerFenceRenderer` is not called
for highlight because it works as a catch-all fallback: any code block whose
language doesn't match a diagram renderer gets highlighted during hydration.

### Hydrator entry (in `fence-hydrate.ts`)

```typescript
const _hydrators = {
  // ... mermaid, viz-dot, svgbob ...

  highlight: async () => {
    const hljs = await import('highlight.js/lib/core');
    const { getHighlightLanguages } = await import('./extensions/highlight.js');
    const langs = getHighlightLanguages();

    // Map of language IDs to their dynamic import() modules
    const langModules: Record<string, () => Promise<any>> = {
      javascript: () => import('highlight.js/lib/languages/javascript'),
      python:     () => import('highlight.js/lib/languages/python'),
      css:        () => import('highlight.js/lib/languages/css'),
      bash:       () => import('highlight.js/lib/languages/bash'),
      json:       () => import('highlight.js/lib/languages/json'),
      markdown:   () => import('highlight.js/lib/languages/markdown'),
      typescript: () => import('highlight.js/lib/languages/typescript'),
      html:       () => import('highlight.js/lib/languages/xml'),
      yaml:       () => import('highlight.js/lib/languages/yaml'),
      sql:        () => import('highlight.js/lib/languages/sql'),
      // Add new languages here as needed
    };

    // Load only the configured languages — each is its own code-split chunk
    for (const lang of langs) {
      const loader = langModules[lang];
      if (loader) {
        const mod = await loader();
        hljs.default.registerLanguage(lang, mod.default);
      }
    }

    return async (source: string) => {
      const result = hljs.default.highlightAuto(source, langs);
      return result.value;
    };
  },
};
```

### Key points

- **Core** (~40 KB) loads once when any code block is encountered
- **Language grammars** (~5 KB each) are dynamically imported — only the
  languages listed in the server config are loaded
- **Server controls the list** — add `"typescript"` to the config array,
  no client redeploy needed
- **Unknown languages** — the `langModules` map silently skips them
- **Graceful fallback** — if highlight.js fails to load, code blocks stay
  as plain `<pre><code>` with source visible

---

## Implementation Order

1. **Syntax highlighting** (highlight.js) — smallest, most visible impact
2. **Mermaid** — most requested diagram type
3. **svgbob** — lightweight ASCII diagrams
4. **viz.js** — Graphviz family, heaviest dependency
