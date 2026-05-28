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

  return _md;
}

// ── Plugin registry ─────────────────────────────────────────────────────────

/** Maps plugin names (from server config) to lazy-loaded plugin functions. */
const _pluginRegistry: Record<string, () => Promise<(md: MarkdownIt) => void>> = {
  emoji: () => import('./extensions/emoji.js').then(m => m.default),
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
 * The callback receives (tokens, idx, options, env, self) and must return
 * an HTML string.  Languages not matched fall through to default rendering.
 */
export function registerFenceRenderer(
  languages: string[],
  fn: (tokens: any[], idx: number, options: any, env: any, self: any) => string,
): void {
  const md = getMd();
  const langSet = new Set(languages);

  const defaultFence = md.renderer.rules.fence!.bind(md.renderer.rules);
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const info = tokens[idx].info.trim().split(/\s+/)[0];
    if (langSet.has(info)) {
      return fn(tokens, idx, options, env, self);
    }
    return defaultFence(tokens, idx, options, env, self);
  };
}

/**
 * Activate plugins by name using the built-in registry.
 *
 * Each name is resolved through the internal registry, the plugin module is
 * lazily imported, and then registered via `use()`.  Unknown names are
 * silently skipped with a console warning so the server config can be
 * forwards-compatible.
 *
 * Typically called after `fetchSpaConfig()` with the server-provided list
 * in `markdown.plugins`.
 */
export async function loadPlugins(names: string[]): Promise<void> {
  for (const name of names) {
    const loader = _pluginRegistry[name];
    if (!loader) {
      console.warn(`[markdown] unknown plugin: "${name}"`);
      continue;
    }
    try {
      const plugin = await loader();
      use(plugin);
    } catch (err) {
      console.warn(`[markdown] failed to load plugin "${name}":`, err);
    }
  }
}
