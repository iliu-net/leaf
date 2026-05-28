# Markdown Plugin Architecture

## Motivation

`markdown-it` is advertised as extensible.  The wrapper in `src/ts/markdown.ts`
already had hooks for custom inline/block rules and fence renderers, but:

- No `md.use()`-style API for third-party plugins from the ecosystem
- The `registerInlinePlugin` / `registerBlockPlugin` distinction was misleading — both just passed `(md) => void`
- Zero consumers of those functions existed
- Heavy plugins (syntax highlighting, diagram renderers) needed a lazy-loading strategy to stay out of the initial bundle

Server-driven activation (`SpaConfig.markdown.plugins`) was chosen so the
backend can control which plugins are active per instance without a redeploy.

## New files

| File | Purpose |
|---|---|
| `src/ts/extensions/emoji.ts` | Thin wrapper around `markdown-it-emoji` — exports a default function `(md) => md.use(emojiPlugin)` |

## Modified files

| File | Change |
|---|---|
| `src/ts/markdown.ts` | Replaced `registerInlinePlugin` / `registerBlockPlugin` with `use()` and `loadPlugins()`. Added private plugin registry mapping names → lazy `import()` loaders. |
| `src/ts/config.ts` | `SpaConfig.markdown` gains `plugins?: string[]` |
| `src/ts/app.ts` | After `fetchSpaConfig()`, calls `loadPlugins(cfg.markdown.plugins)` |
| `package.json` | `+ "markdown-it-emoji": "^3.0.0"` |
| `api/config.php` | `'plugins' => ['emoji']` |
| `api/config.php-sample` | `'plugins' => []  // e.g. ['emoji'] to enable :smile: style emoji shortcuts` |
| `demo/cookbook/api/config.php` | `'plugins' => ['emoji']` |
| `demo/cookbook/api/config.php-sample` | `'plugins' => []  // e.g. ['emoji'] to enable :smile: style emoji shortcuts` |

## New API (`src/ts/markdown.ts`)

```typescript
/** Render markdown to HTML.  (unchanged) */
export function parse(body: string): string;

/** Register a markdown-it plugin.  Mirrors `md.use()`. */
export function use(plugin: (md: MarkdownIt, options?: any) => void, options?: any): void;

/** Register a fence renderer for specific code-block languages.  (unchanged) */
export function registerFenceRenderer(languages: string[], fn: FenceFn): void;

/** Activate plugins by name from the built-in registry. */
export async function loadPlugins(names: string[]): Promise<void>;
```

### Plugin registry (private, inside `markdown.ts`)

```typescript
const _pluginRegistry: Record<string, () => Promise<(md: MarkdownIt) => void>> = {
  emoji: () => import('./extensions/emoji.js').then(m => m.default),
};
```

Each entry is a lazy `import()` — the plugin module and its npm dependencies
stay out of the main bundle until the server config activates them by name.

### `use()` — queue or apply

Plugins can be registered before the markdown-it instance exists (before first
`parse()` call).  They are queued in `_pending` and applied when the instance is
created.  Plugins registered after the instance exists are applied immediately.

This means `loadPlugins()` can be called at any point — before or after the
first note is opened — and plugins will always be correctly applied.

### `loadPlugins()` — error handling

Unknown plugin names produce a `console.warn` and are skipped — the server
config can be forwards-compatible (list a plugin that doesn't exist yet in
the client build).  Failed `import()` calls are caught and logged the same way.

## Plugin wrapper pattern (`src/ts/extensions/emoji.ts`)

```typescript
import type MarkdownIt from 'markdown-it';
import { full as emojiPlugin } from 'markdown-it-emoji';

const plugin: (md: MarkdownIt) => void = (md) => md.use(emojiPlugin);
export default plugin;
```

Future plugins follow the exact same pattern:
- `import { default as somePlugin } from 'markdown-it-something'` for standard plugins
- Custom inline/block rules directly manipulate `md.inline.ruler` / `md.block.ruler`
- Add an entry to `_pluginRegistry` in `markdown.ts`

## Server config

### `config.php-sample` (safe default — no plugins)

```php
$spa_config = [
    'markdown' => [
        'html'    => false,
        'plugins' => [],  // e.g. ['emoji'] to enable :smile: style emoji shortcuts
    ],
    // ...
];
```

### `config.php` (active instance — emoji enabled)

```php
$spa_config = [
    'markdown' => [
        'html'    => false,
        'plugins' => ['emoji'],
    ],
    // ...
];
```

## Client boot flow (revised)

```
boot():
  loadConfig()              // sync  — derives namespace, installPath, apiBaseUrl
  wireUiEvents()            // sync
  showShell()               // async — app shell visible, local notes loaded
  fetchSpaConfig()          // async — await (was fire-and-forget before)
  loadPlugins(cfg.markdown.plugins)  // async — fire-and-forget, non-blocking
  tryRestoreSession()       // async
```

`loadPlugins()` is called with a `.catch()` — it is intentionally non-blocking.
If it fails (network error, missing module), the app continues with no plugins
and logs a warning.  The first note render will have whatever plugins were
loaded by that point.

## Code splitting

esbuild's `--splitting` flag automatically extracts the emoji plugin and
`markdown-it-emoji` into a separate chunk:

```
spa/emoji-C6N4F36G.js   58.1kb   ← loaded only when server config activates it
spa/app.js             172.8kb   ← main bundle, unchanged weight
```

The 58KB chunk is only fetched when `loadPlugins(['emoji'])` triggers the
dynamic `import('./extensions/emoji.js')`.  If the server config lists no
plugins, no extra bytes are downloaded.

## Future extensions

The same pattern supports all planned plugins from the wishlist:

| Plugin | Registry key | Source |
|---|---|---|
| `markdown-it-task-lists` | `task-lists` | npm package + thin wrapper |
| `markdown-it-toc-done-right` | `toc` | npm package + thin wrapper |
| WikiLinks (`[[...]]`) | `wikilinks` | Custom inline rule, no npm dep |
| `~~strikethrough~~`, `++insert++`, etc. | `extra-inlines` | Custom inline rules |
| `#++` / `#--` headown | `headown` | Custom block rule |

Fenced code block renderers (mermaid, viz.js, svgbob) use a different
mechanism — `registerFenceRenderer()` + async DOM hydration — but will be
triggered through the same `markdown.plugins` server config key.
