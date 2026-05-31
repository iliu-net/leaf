/**
 * markdown.ts — markdown-it wrapper with extension hooks
 *
 * Lazy-initialises the markdown-it instance on first use.  Exposes:
 *   parse()                 — render markdown to HTML
 *   use()                   — register a markdown-it plugin (mirrors md.use)
 *   registerFenceRenderer() — override fence (code block) rendering
 *   loadPlugins()           — activate plugins by name from the built-in registry
 */

import MarkdownIt from 'markdown-it';
import { getSpaConfig } from './config.js';

// ── State ───────────────────────────────────────────────────────────────────

let _md: MarkdownIt | null = null;
const _pending: Array<{ plugin: (md: MarkdownIt, options?: any) => void; options?: any }> = [];

// ── Init ────────────────────────────────────────────────────────────────────

function getMd(): MarkdownIt {
  if (_md) return _md;

  const cfg = getSpaConfig();

  _md = new (MarkdownIt)({
    html: cfg.markdown?.html ?? false,
    linkify: true,
    typographer: true,
    breaks: false,
  });

  // Apply any plugins that were registered before the instance existed
  for (const p of _pending) {
    p.plugin(_md, p.options);
  }
  _pending.length = 0;

  // Force external links (http://, https://) to open in a new tab so they
  // don't destroy the running SPA.  markdown-it v14 has no default
  // link_open rule — the generic renderToken() handles it.  We wrap
  // whatever is there (or renderToken itself if absent).
  const existingLinkOpen = _md.renderer.rules.link_open;
  _md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = tokens[idx].attrGet('href');
    if (href && /^https?:\/\//.test(href)) {
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer');
      // Merge class attribute — preserve any existing classes from the token
      const existingClass = tokens[idx].attrGet('class');
      tokens[idx].attrSet('class', existingClass
        ? `${existingClass} external-link`
        : 'external-link');
    }
    if (existingLinkOpen) {
      return existingLinkOpen(tokens, idx, options, env, self);
    }
    // Default behaviour — render the tag from token.tag + token.attrs
    return self.renderToken(tokens, idx, options);
  };

  return _md;
}

// ── Plugin registry ─────────────────────────────────────────────────────────

/** Maps plugin names (from server config) to lazy-loaded plugin functions. */
const _pluginRegistry: Record<string, () => Promise<(md: MarkdownIt, ...args: any[]) => void>> = {
  deflist:   () => import('./extensions/deflist.js').then(m => m.default),
  emoji:     () => import('./extensions/emoji.js').then(m => m.default),
  footnote:  () => import('./extensions/footnote.js').then(m => m.default),
  highlight: () => import('./extensions/highlight.js').then(m => m.default),
  multimdtable: () => import('./extensions/multimd-table.js').then(m => m.default),
  svgbob:    () => import('./extensions/svgbob.js').then(m => m.default),
  tasklists: () => import('./extensions/task-lists.js').then(m => m.default),
  toc:       () => import('./extensions/toc.js').then(m => m.default),
  wikilinks: () => import('./extensions/wikilinks.js').then(m => m.default),
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Render a markdown string to HTML.
 */
export function parse(body: string): string {
  if (!body) return '';
  return getMd().render(body);
}

/**
 * Register a markdown-it plugin.  Mirrors markdown-it's own `md.use()`.
 *
 * Can be called before the first `parse()` — plugins are queued and applied
 * when the instance is created.  Plugins registered later are applied
 * immediately to the existing instance.
 */
export function use(
  plugin: (md: MarkdownIt, options?: any) => void,
  options?: any,
): void {
  if (_md) {
    plugin(_md, options);
  } else {
    _pending.push({ plugin, options });
  }
}

/**
 * Register a renderer for fenced code blocks matching a set of languages.
 *
 * If `languages` is non-empty, the renderer is called only for blocks whose
 * info string matches one of the listed languages.  If `languages` is empty,
 * the renderer acts as a catch-all fallback — it is called for every fenced
 * code block that no other renderer has handled.
 *
 * The callback receives (tokens, idx, options, env, self) and must return
 * an HTML string.
 */
export function registerFenceRenderer(
  languages: string[],
  fn: (tokens: any[], idx: number, options: any, env: any, self: any) => string,
): void {
  const md = getMd();
  const langSet = languages.length ? new Set(languages) : null;

  const defaultFence = md.renderer.rules.fence!.bind(md.renderer.rules);
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const info = tokens[idx].info.trim().split(/\s+/)[0];
    if (langSet === null || langSet.has(info)) {
      return fn(tokens, idx, options, env, self);
    }
    return defaultFence(tokens, idx, options, env, self);
  };
}

/**
 * Activate plugins by name using the built-in registry.
 *
 * Each entry in `entries` is either a plain string (plugin loaded with no
 * options) or a tuple of `[name, ...options]` for plugins that need
 * per-instance configuration (e.g. highlight languages).
 *
 * Unknown names produce a console warning and are skipped so the server
 * config can be forwards-compatible.
 *
 * Typically called after `fetchSpaConfig()` with the server-provided list
 * in `markdown.plugins`.
 */
export async function loadPlugins(
  entries: (string | [string, ...any[]])[],
): Promise<void> {
  for (const entry of entries) {
    const [name, ...rest] = Array.isArray(entry) ? entry : [entry];
    const options = rest.length ? rest : undefined;

    const loader = _pluginRegistry[name];
    if (!loader) {
      console.warn(`[markdown] unknown plugin: "${name}"`);
      continue;
    }
    try {
      const plugin = await loader();
      if (options) {
        use((md) => plugin(md, ...options));
      } else {
        use((md) => plugin(md));
      }
    } catch (err) {
      console.warn(`[markdown] failed to load plugin "${name}":`, err);
    }
  }
}
