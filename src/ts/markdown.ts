/**
 * markdown.ts — markdown-it wrapper with extension hooks
 *
 * Lazy-initialises the markdown-it instance on first use.  Exposes:
 *   parse()                      — render markdown to HTML
 *   registerInlinePlugin()       — add custom inline rule
 *   registerFenceRenderer()      — override fence (code block) rendering
 *   registerBlockPlugin()        — add custom block rule
 */

import MarkdownIt from 'markdown-it';
import { getSpaConfig } from './config.js';

// ── State ───────────────────────────────────────────────────────────────────

let _md: MarkdownIt | null = null;

// ── Init ────────────────────────────────────────────────────────────────────

function getMd(): MarkdownIt {
  if (_md) return _md;

  const cfg = getSpaConfig();

  _md = new MarkdownIt({
    html: cfg.markdown?.html ?? false,
    linkify: true,
    typographer: true,
    breaks: false,
  });

  return _md;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Render a markdown string to HTML.
 */
export function parse(body: string): string {
  if (!body) return '';
  return getMd().render(body);
}

/**
 * Register a custom inline-rule plugin.
 *
 * Plugins are passed the markdown-it instance and should call
 * `md.inline.ruler.push('name', fn)` or similar.
 */
export function registerInlinePlugin(
  name: string,
  plugin: (md: MarkdownIt) => void,
): void {
  plugin(getMd());
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
 * Register a custom block-rule plugin.
 *
 * Plugins are passed the markdown-it instance and should call
 * `md.block.ruler.push('name', fn)` or similar.
 */
export function registerBlockPlugin(
  name: string,
  plugin: (md: MarkdownIt) => void,
): void {
  plugin(getMd());
}
