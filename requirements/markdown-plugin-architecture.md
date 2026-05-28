# Leaf — Markdown Plugin Architecture

This document describes the markdown-it plugin system: how plugins are
registered, lazily loaded, activated by the server, and how fenced code
block renderers fit into the architecture.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Module — `src/ts/markdown.ts`](#core-module)
   - [API Surface](#api-surface)
   - [Lazy Instance Creation](#lazy-instance-creation)
   - [Plugin Queue (pre-init)](#plugin-queue)
3. [Plugin Registry](#plugin-registry)
   - [Adding a New Plugin](#adding-a-new-plugin)
   - [Plugin Wrapper Pattern](#plugin-wrapper-pattern)
   - [Plugins with Options](#plugins-with-options)
4. [Server-Driven Activation](#server-driven-activation)
   - [SpaConfig Schema](#spaconfig-schema)
   - [Config File Convention](#config-file-convention)
   - [Per-Plugin Options Convention](#per-plugin-options-convention)
5. [Boot Flow](#boot-flow)
6. [Code Splitting](#code-splitting)
7. [Fenced Code Block Renderers (Phase 2)](#fenced-code-block-renderers)
   - [Two-Pass Architecture](#two-pass-architecture)
   - [Placeholder Format](#placeholder-format)
   - [Hydration Process](#hydration-process)
   - [Hydrator Registry](#hydrator-registry)
   - [Integration with Plugin System](#integration-with-plugin-system)
   - [Highlight.js Example](#highlightjs-example)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Server (PHP)                                                     │
│  config.php → $spa_config.markdown.plugins                        │
│             → GET /api/index.php/spa-config                      │
└───────────────────────┬──────────────────────────────────────────┘
                        │  JSON over HTTP
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  Client: app.ts                                                   │
│  fetchSpaConfig() → loadPlugins(["emoji",                         │
│                        ["highlight", ["js","py","css"]] ])        │
└───────────────────────┬──────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  src/ts/markdown.ts                                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  _pluginRegistry                                          │   │
│  │  "emoji"     → import('./extensions/emoji.js')           │   │
│  │  "highlight" → import('./extensions/highlight.js')        │   │
│  │  "mermaid"   → ...                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  loadPlugins(["emoji", ["highlight", ["js","py"]]])               │
│       │                                                           │
│       ├── "emoji"     → await import(...) → use(plugin)           │
│       └── "highlight" → await import(...) → use(plugin, ["js","py"]) │
│                                                                   │
│  parse(markdown) → getMd().render(body)                           │
└──────────────────────────────────────────────────────────────────┘
```

Three principles:

1. **Lazy loading** — plugins and their npm dependencies are only fetched when the server config activates them by name.
2. **Queue-safe** — plugins can be registered before the markdown-it instance exists (before the first `parse()` call). They are queued and applied at instance creation.
3. **Server-driven** — the server's `$spa_config` controls which plugins are active per deployment, and can pass per-plugin options, without a client redeploy.

---

## Core Module

**File:** `src/ts/markdown.ts`

The module wraps a single lazy-initialised `MarkdownIt` instance.  The instance
is created on the first call to either `parse()` or `use()` (if called after
init), not at module load time.

### API Surface

```typescript
/** Render markdown string to HTML. */
export function parse(body: string): string;

/** Register a markdown-it plugin.  Mirrors `md.use()`. */
export function use(plugin: (md: MarkdownIt, options?: any) => void, options?: any): void;

/** Register a fence renderer for specific code-block languages. */
export function registerFenceRenderer(
  languages: string[],
  fn: (tokens: any[], idx: number, options: any, env: any, self: any) => string,
): void;

/** Activate plugins by name from the built-in registry.
 *
 * Each entry is either a plain string (load with no options) or a
 * tuple of [name, ...options].  See "Plugins with Options" below. */
export async function loadPlugins(
  entries: (string | [string, ...any[]])[]
): Promise<void>;
```

### Lazy Instance Creation

```typescript
let _md: MarkdownIt | null = null;

function getMd(): MarkdownIt {
  if (_md) return _md;

  _md = new MarkdownIt({
    html: getSpaConfig().markdown?.html ?? false,
    linkify: true,
    typographer: true,
    breaks: false,
  });

  // Apply queued plugins
  for (const p of _pending) {
    p.plugin(_md, p.options);
  }
  _pending.length = 0;

  return _md;
}
```

The instance reads `SpaConfig` at creation time, so the server's `markdown.html`
setting is always honoured.  Because the instance is created lazily (on first
`parse()`), the config has typically already been fetched by the time a note is
opened.

### Plugin Queue (pre-init)

```typescript
const _pending: Array<{ plugin: (md: MarkdownIt, options?: any) => void; options?: any }> = [];

export function use(plugin: ..., options?: any): void {
  if (_md) {
    plugin(_md, options);        // apply immediately
  } else {
    _pending.push({ plugin, options });  // queue for later
  }
}
```

This ensures plugins registered before the first `parse()` call are not lost.
`loadPlugins()` uses `use()` internally, so it works regardless of timing.

---

## Plugin Registry

The registry lives inside `markdown.ts` as a private constant:

```typescript
const _pluginRegistry: Record<string, () => Promise<(md: MarkdownIt) => void>> = {
  emoji: () => import('./extensions/emoji.js').then(m => m.default),
};
```

Each value is a **lazy factory** — a function that returns a promise of a plugin
function.  The dynamic `import()` ensures the plugin module and its npm
dependencies stay out of the main bundle until explicitly loaded.

### Adding a New Plugin

Step 1 — Create a thin wrapper module in `src/ts/extensions/`:

```typescript
// src/ts/extensions/toc.ts
import type MarkdownIt from 'markdown-it';
import tocPlugin from 'markdown-it-toc-done-right';

const plugin: (md: MarkdownIt) => void = (md) => md.use(tocPlugin, { level: 2 });
export default plugin;
```

Step 2 — Add an entry to `_pluginRegistry` in `markdown.ts`:

```typescript
const _pluginRegistry = {
  emoji: () => import('./extensions/emoji.js').then(m => m.default),
  toc:   () => import('./extensions/toc.js').then(m => m.default),   // ← new
};
```

Step 3 — Add the plugin name to the server config:

```php
$spa_config['markdown']['plugins'] = ['emoji', 'toc'];
```

No other changes needed.  The plugin is automatically lazy-loaded, code-split,
and applied at boot.

### Plugin Wrapper Pattern

Every wrapper module follows the same shape:

```typescript
import type MarkdownIt from 'markdown-it';

// For third-party markdown-it plugins:
import { full as somePlugin } from 'markdown-it-something';
const plugin: (md: MarkdownIt) => void = (md) => md.use(somePlugin, options);
export default plugin;

// For custom rules (no npm dependency):
const plugin: (md: MarkdownIt) => void = (md) => {
  md.inline.ruler.push('my_rule', (state, silent) => { ... });
};
export default plugin;
```

The default export is always `(md: MarkdownIt) => void` — matching the
signature used by `use()` and `loadPlugins()`.

### Plugins with Options

Some plugins need configuration that can't be hardcoded — for example,
highlight.js needs a list of languages to load.  The server config uses a
**tuple format** for these:

```php
'plugins' => [
    'emoji',                                   // plain string — no options
    ['highlight', ['javascript', 'python']],    // tuple — name + options
]
```

`loadPlugins()` handles both forms:

```typescript
export async function loadPlugins(
  entries: (string | [string, ...any[]])[]
): Promise<void> {
  for (const entry of entries) {
    const [name, ...options] = Array.isArray(entry) ? entry : [entry];
    const loader = _pluginRegistry[name];
    if (!loader) { console.warn(`[markdown] unknown plugin: "${name}"`); continue; }
    try {
      const plugin = await loader();
      use(plugin, options.length ? options : undefined);
    } catch (err) {
      console.warn(`[markdown] failed to load plugin "${name}":`, err);
    }
  }
}
```

The plugin wrapper receives options as a second argument to its factory:

```typescript
// src/ts/extensions/highlight.ts
import type MarkdownIt from 'markdown-it';

const plugin: (md: MarkdownIt, options?: any) => void = (md, langs) => {
  // langs = ['javascript', 'python'] — from the server config tuple
  // Use these to dynamically import only the needed language grammars
};
export default plugin;
```

The registry entry gains a matching generic signature — the factory returns
a plugin function that accepts options:

```typescript
const _pluginRegistry: Record<string, () => Promise<(md: MarkdownIt, ...args: any[]) => void>> = {
  emoji:     () => import('./extensions/emoji.js').then(m => m.default),
  highlight: () => import('./extensions/highlight.js').then(m => m.default),
};
```

Plain strings stay backward compatible — `"emoji"` still works exactly as
before.  The tuple form only exists when a plugin needs options.

---

## Server-Driven Activation

### SpaConfig Schema

```typescript
// A plugin entry is either a plain name or a tuple of [name, ...options].
type PluginEntry = string | [string, ...any[]];

export interface SpaConfig {
  markdown: {
    html: boolean;
    /** Plugin names to activate.  Each entry is a string ("emoji") or a
     *  tuple (["highlight", ["js", "py"]]).  Tuple form passes the
     *  remaining elements to the plugin as options. */
    plugins?: PluginEntry[];
  };
  deleted_notes_ttl_days: number;
  timestamp_format: string | null;
}
```

`markdown.plugins` is optional — when absent or empty, no plugins are loaded.
The client resolves each name against the registry; unknown names produce a
`console.warn` and are skipped.  This allows the server config to be
forwards-compatible (list a plugin not yet in the client build).

### Config File Convention

**Sample config** (committed to version control, safe defaults):

```php
// api/config.php-sample
$spa_config = [
    'markdown' => [
        'html'    => false,
        'plugins' => [],     // e.g. ['emoji'] to enable :smile: style emoji shortcuts
    ],
];
```

**Active config** (per-instance, not committed):

```php
// api/config.php
$spa_config = [
    'markdown' => [
        'html'    => false,
        'plugins' => ['emoji'],
    ],
];
```

### Per-Plugin Options Convention

Plugins that need options use a tuple `[name, ...options]` instead of a plain
string.  The server passes the remaining elements as arguments to the plugin:

```php
// Syntax highlighting with an explicit language list
'plugins' => [
    'emoji',
    ['highlight', ['javascript', 'python', 'css', 'bash', 'json', 'markdown']],
];
```

The convention is:

- **No options needed** → `"emoji"` (plain string)
- **Options needed** → `["highlight", ["js", "py"]]` (tuple)

The `plugins` array is mixed-type at the PHP level (JSON serialises cleanly
to the TypeScript `(string | [string, ...any[]])[]` type).  Unknown names
are still skipped, and the tuple form is fully optional — a plugin that
receives `undefined` instead of options should use sensible defaults.

---

## Boot Flow

```
boot()
  │
  ├── loadConfig()                        sync  — derive namespace
  ├── wireUiEvents()                      sync  — DOM event listeners
  ├── showShell()                         async — app shell visible
  │
  ├── await fetchSpaConfig()              async — GET /api/index.php/spa-config
  │     └── populates in-memory SpaConfig
  │
  ├── loadPlugins(cfg.markdown.plugins)   async — fire-and-forget
  │     └── for each entry:
  │           parse name + optional options from tuple
  │           resolve name in _pluginRegistry
  │           await import('./extensions/X.js')
  │           use(plugin, ...options)
  │
  └── tryRestoreSession()                 async — auth
```

`loadPlugins()` is intentionally fire-and-forget (`.catch()` logged).  If it
fails (offline, network error), the app continues with no plugins.  The
markdown-it instance is created lazily on first `parse()`, so any plugins that
were successfully loaded before the first note is opened will be active.

---

## Code Splitting

esbuild's `--splitting` flag extracts each dynamically-imported plugin module
into its own chunk:

```
spa/app.js              172.8kb  ← main bundle
spa/emoji-C6N4F36G.js    58.1kb  ← loaded only when config activates "emoji"
spa/history-QNKYHEVL.js  12.7kb  ← existing lazy chunk
```

A deployment with `plugins: []` never downloads the emoji chunk.  Each new
plugin added to the registry becomes its own code-split chunk at build time,
loaded only when the server config requests it.

---

## Fenced Code Block Renderers

**Status: Phase 2 — planned (see `TODO/fence-hydration.md`)**

Diagram renderers (mermaid, viz.js, svgbob-wasm) and syntax highlighting
(highlight.js) are too heavy for the initial bundle and must load
asynchronously.  They use a different mechanism than inline plugins because
they need to access the DOM after HTML is inserted.

### Two-Pass Architecture

**Default behaviour (no fence renderers enabled):** When `markdown.plugins`
does not include any fence-rendering plugin (like `"mermaid"` or
`"highlight"`), markdown-it's built-in fence rule handles all code blocks.
The output is standard HTML with no extra attributes:

```html
<pre><code class="language-javascript">console.log("hello");
</code></pre>
```

The hydration step finds zero `[data-lang]` elements and returns immediately —
no imports, no overhead.  This is the same behaviour as before the plugin
system was added.

**When a fence renderer is active:** the renderer replaces the default output
with a placeholder that includes `data-lang` and `data-source` attributes,
and the hydration step picks it up.

```
Pass 1 (synchronous)               Pass 2 (asynchronous)
═══════════════════                ═════════════════════

parse("```mermaid                  innerHTML set
graph TD                            │
  A --> B                           ▼
```")                              hydrate(root)
  │                                  │
  ▼                                  ├── find all [data-lang]
registerFenceRenderer()              ├── group by language
produces:                            ├── import() renderer once
  <pre><code                         └── swap <code> content with
    data-lang="mermaid"                  rendered SVG/HTML
    data-source="...base64...">
  graph TD
    A --> B
  </code></pre>
```

### Placeholder Format

During synchronous parse, `registerFenceRenderer()` emits a standard
`<pre><code>` block with extra attributes:

```html
<pre><code class="language-mermaid"
           data-lang="mermaid"
           data-source="Z3JhcGggVEQKICBBIC0tPiBC">
graph TD
  A --> B
</code></pre>
```

- **`data-lang`** — identifies which hydrator to load
- **`data-source`** — base64-encoded original source (avoids HTML escaping)
- **`<code>` inner text** — raw source, acts as **loading state** and **graceful fallback** (if JS disabled or hydration fails)

### Hydration Process

```typescript
async function hydrate(root: Element): Promise<void> {
  const placeholders = root.querySelectorAll<HTMLElement>('[data-lang]');
  if (placeholders.length === 0) return;

  // Group by language — load each renderer only once
  const byLang = new Map<string, HTMLElement[]>();
  for (const el of placeholders) {
    const lang = el.dataset.lang!;
    if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang)!.push(el);
  }

  for (const [lang, els] of byLang) {
    const hydrator = _hydrators[lang];
    if (!hydrator) continue;

    try {
      const renderFn = await hydrator();  // dynamic import(), once per group
      for (const el of els) {
        const source = decodeURIComponent(escape(atob(el.dataset.source!)));
        el.innerHTML = await renderFn(source);
      }
    } catch (err) {
      // Blocks stay as plain <pre><code> — graceful degradation
      console.warn(`[hydrate] renderer "${lang}" failed:`, err);
    }
  }
}
```

Called from `markdown-view.ts` after every `innerHTML` assignment.

### Hydrator Registry

```typescript
const _hydrators: Record<string, () => Promise<(source: string) => Promise<string>>> = {
  mermaid: async () => {
    const mermaid = await import('mermaid');
    mermaid.default.initialize({ startOnLoad: false });
    let n = 0;
    return async (src: string) => {
      const { svg } = await mermaid.default.render(`m-${n++}`, src);
      return svg;
    };
  },

  'viz-dot': async () => {
    const { Graphviz } = await import('@hpcc-js/wasm/graphviz');
    const gv = await Graphviz.load();
    return async (src: string) => gv.dot(src, 'svg');
  },

  svgbob: async () => {
    const svgbob = await import('svgbob-wasm');
    await svgbob.default();
    return async (src: string) => svgbob.convert_string(src);
  },
};
```

### Integration with Plugin System

Fence renderers are activated through the same `markdown.plugins` server config.
Each name in the plugin registry loads a wrapper module that calls
`registerFenceRenderer()`:

```typescript
// src/ts/extensions/mermaid.ts
import { registerFenceRenderer } from '../markdown.js';

registerFenceRenderer(['mermaid'], (tokens, idx) => {
  const src = tokens[idx].content;
  const encoded = btoa(unescape(encodeURIComponent(src)));
  return `<pre><code class="language-mermaid" data-lang="mermaid" data-source="${encoded}">`
    + src + `</code></pre>`;
});

// Default export for loadPlugins() — registration already done above,
// but kept for consistency with the plugin contract
const plugin = () => {};  // no-op: registerFenceRenderer already called
export default plugin;
```

The renderer is lazy-loaded (via the registry), calls `registerFenceRenderer()`
on load to wire up the placeholder, and `hydrate()` in `markdown-view.ts`
handles the async rendering uniformly for all languages.

### Highlight.js Example

highlight.js combines both patterns — it is a fence renderer (needs DOM
hydration) *and* needs per-plugin options (the language list).  It uses the
tuple config form:

```php
// Server config
'plugins' => [
    ['highlight', ['javascript', 'python', 'css', 'bash', 'json']],
];
```

**Wrapper module** (`src/ts/extensions/highlight.ts`):

```typescript
import type MarkdownIt from 'markdown-it';
import { registerFenceRenderer } from '../markdown.js';

const plugin: (md: MarkdownIt, options?: any) => void = (_md, langs) => {
  // Store the language list — the hydrator will use it later
  setHighlightLanguages(langs ?? ['javascript', 'python', 'css', 'bash', 'json']);
};

export default plugin;

// ── Fence renderer (synchronous placeholder) ──────────────────────────

let _langs: string[] = [];

export function setHighlightLanguages(langs: string[]) {
  _langs = langs;
}

registerFenceRenderer([], (_tokens, _idx) => {
  // highlight is a catch-all — register for no specific language,
  // but markdown-it's default fence handler is called for all
  // non-special languages.  We wrap it differently: instead of
  // registerFenceRenderer, highlight works as a fallback in the
  // hydrate step for any [data-lang] that isn't mermaid/viz/svgbob.
  //
  // See hydrator registry below.
});
```

**Hydrator registry** (in `fence-hydrate.ts` or inlined):

```typescript
const _hydrators: Record<string, () => Promise<(source: string) => Promise<string>>> = {
  highlight: async () => {
    const hljs = await import('highlight.js/lib/core');

    // Dynamically import only the configured languages
    const langModules: Record<string, () => Promise<any>> = {
      javascript: () => import('highlight.js/lib/languages/javascript'),
      python:     () => import('highlight.js/lib/languages/python'),
      css:        () => import('highlight.js/lib/languages/css'),
      bash:       () => import('highlight.js/lib/languages/bash'),
      json:       () => import('highlight.js/lib/languages/json'),
      markdown:   () => import('highlight.js/lib/languages/markdown'),
      // ... more as needed
    };

    for (const lang of _langs) {
      const loader = langModules[lang];
      if (loader) {
        const mod = await loader();
        hljs.default.registerLanguage(lang, mod.default);
      }
    }

    return async (source: string) => {
      const result = hljs.default.highlightAuto(source, _langs);
      return result.value;
    };
  },
};
```

**Flow:**

1. Server sends `["highlight", ["javascript", "python", "css"]]`
2. `loadPlugins()` → `use(highlightPlugin, ["javascript", "python", "css"])`
3. highlight wrapper stores the language list
4. During markdown parse, all non-special code blocks keep their default `<pre><code>` rendering
5. `hydrate()` groups unhandled `[data-lang]` blocks → loads highlight.js core once → dynamically imports only the 3 requested language grammars → applies highlighting to each block

The result: an 800KB+ highlight.js library (with all 190+ languages) is never
loaded.  Instead, ~40KB of core + ~5KB per requested language grammar.  The
server config controls exactly which languages are available.

---

## Future Extension Guide

**To add a standard markdown-it plugin** (e.g. `markdown-it-task-lists`):

1. `pnpm add markdown-it-task-lists`
2. Create `src/ts/extensions/task-lists.ts` — default export calls `md.use(plugin)`
3. Add `task-lists: () => import('./extensions/task-lists.js').then(m => m.default)` to `_pluginRegistry`
4. Add `'task-lists'` to the server config's `markdown.plugins`

**To add a plugin with options** (e.g. highlight.js with a language list):

1. Create `src/ts/extensions/highlight.ts` — default export is `(md, options?) => void`
2. Add `highlight: () => import('./extensions/highlight.js').then(m => m.default)` to `_pluginRegistry`
3. Add `['highlight', ['javascript', 'python']]` to the server config (tuple form)

**To add a custom rule** (e.g. WikiLinks `[[...]]`):

1. Create `src/ts/extensions/wikilinks.ts` — default export manipulates `md.inline.ruler`
2. Add to `_pluginRegistry`
3. Add to server config

**To add a fence renderer** (e.g. mermaid):

1. Create `src/ts/extensions/mermaid.ts` — calls `registerFenceRenderer()` + default export
2. Add hydrator entry to the hydrator registry
3. Add to `_pluginRegistry`
4. Add to server config

The pattern is consistent across all cases — a wrapper module, a registry
entry, and a server config entry (string for no options, tuple for options).
