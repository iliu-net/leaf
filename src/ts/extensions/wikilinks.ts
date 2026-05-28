/**
 * wikilinks.ts — custom markdown-it inline rule for WikiLinks
 *
 * Syntax:
 *   [[page]]         → link to note `page`, text = page
 *   [[page|label]]   → link to note `page`, text = label
 *   [[page|]]        → link to note `page`, text resolved from target note
 *                       title at render time (data-resolve-title flag)
 *
 * All wikilinks rendered as:
 *   <a href="?note=page" class="wikilink" data-note="page">text</a>
 *
 * Uses the same plugin contract as emoji.ts: default-export a function
 * `(md: MarkdownIt) => void` so it slots into the markdown.ts plugin registry.
 */

import type MarkdownIt from 'markdown-it';

// ── Regex ──────────────────────────────────────────────────────────────────

/**
 * Captures [[target]], [[target|label]], and [[target|]].
 * Group 1 = page name (allowed: word chars, :, -, _, ., spaces).
 * Group 2 = label (absent, present-but-empty, or non-empty).
 */
const WIKILINK_RE = /^\[\[([^\]|#]+?)(?:\|([^\]|#]*?))?\]\]/;

// ── Inline rule ────────────────────────────────────────────────────────────

function wikilinkRule(state: any, silent: boolean): boolean {
  const match = state.src.slice(state.pos).match(WIKILINK_RE);
  if (!match) return false;

  const page = match[1].trim();
  // match[2] is undefined for [[page]], '' for [[page|]], 'label' for [[page|label]]
  const hasLabel = match[2] !== undefined;
  const label = (hasLabel && match[2].trim()) || page;
  const resolveTitle = hasLabel && match[2].trim() === '';

  if (!silent) {
    const token = state.push('link_open', 'a', 1);
    token.attrSet('href', `?note=${encodeURIComponent(page)}`);
    token.attrSet('class', 'wikilink');
    token.attrSet('data-note', page);
    if (resolveTitle) {
      token.attrSet('data-resolve-title', 'true');
    }

    const textToken = state.push('text', '', 0);
    textToken.content = label;

    state.push('link_close', 'a', -1);
  }

  state.pos += match[0].length;
  return true;
}

// ── Plugin entry point ─────────────────────────────────────────────────────

const plugin: (md: MarkdownIt) => void = (md) => {
  md.inline.ruler.before('link', 'wikilink', wikilinkRule);
};

export default plugin;
