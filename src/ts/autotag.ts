/**
 * autotag.ts — automatic tagging engine
 *
 * Scans note content against word→tag rules defined in the _tagcloud note.
 * Rules are cached and invalidated when _tagcloud changes.
 *
 * _tagcloud note format:
 *   Frontmatter custom keys are tag names, bracket-array values are trigger
 *   words (case-insensitive word-boundary match).
 *
 *   Example:
 *     ---
 *     title: Tag Cloud
 *     finance: [invoice, receipt, budget, tax]
 *     work: [meeting, presentation, deadline]
 *     development: [bug, feature, refactor, deploy]
 *     ---
 *
 * Auto-tagging is disabled per-note by adding !* to user-tags.
 * Individual auto-tags are suppressed by adding !tagname to user-tags.
 *   e.g. user-tags: [important, !work]  → keeps "important", drops "work"
 */

import { parseFrontmatter } from './frontmatter.js';
import { updateFrontmatter } from './frontmatter.js';
import { dbGetNote } from './db.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface Rule {
  pattern: RegExp;
  tag: string;
}

// ── Rule cache ───────────────────────────────────────────────────────────

let _rulesCache: Rule[] | null = null;
let _cacheKey: string | null = null;  // `${updated_at}:${current}` of _tagcloud

// ── Reserved keys (same as frontmatter.ts RESERVED_KEYS) ─────────────────

const RESERVED = new Set([
  'title', 'summary', 'user-tags', 'auto-tags', 'tags', 'lang', 'edit-time',
]);

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Load word→tag rules from the _tagcloud note.
 * Returns an empty array if _tagcloud doesn't exist or has no rules.
 * Results are cached until _tagcloud changes.
 */
export async function loadRules(): Promise<Rule[]> {
  const note = await dbGetNote('_tagcloud');
  if (!note || !note.content) {
    _rulesCache = null;
    _cacheKey = null;
    return [];
  }

  const key = `${note.updated_at}:${note.current}`;
  if (_cacheKey === key && _rulesCache) {
    return _rulesCache;
  }

  const { meta } = parseFrontmatter(note.content);
  const rules: Rule[] = [];

  for (const [tag, rawWords] of Object.entries(meta)) {
    if (RESERVED.has(tag)) continue;
    const words: string[] = Array.isArray(rawWords)
      ? rawWords
      : rawWords.split(',').map(s => s.trim()).filter(Boolean);
    for (const word of words) {
      if (!word) continue;
      // Escape regex-special characters, build word-boundary pattern
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      rules.push({ pattern: new RegExp(`\\b${escaped}\\b`, 'gi'), tag });
    }
  }

  _rulesCache = rules;
  _cacheKey = key;
  return rules;
}

/**
 * Scan body text against rules, returning deduplicated, sorted tag names.
 * Only the body (below frontmatter) is scanned — frontmatter values are
 * excluded to avoid false matches on metadata.
 */
export function scanContent(body: string, rules: Rule[]): string[] {
  if (!body || rules.length === 0) return [];
  const tags = new Set<string>();
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(body)) {
      tags.add(rule.tag);
    }
  }
  return [...tags].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

/**
 * Check whether user-tags contain !* (disable all auto-tagging).
 */
export function isAutotagDisabled(userTags: string[]): boolean {
  return userTags.includes('!*');
}

/**
 * Merge user-tags and auto-tags into the final tag set for display.
 *
 * Rules:
 *  - !* in user-tags → discard all auto-tags, keep only non-negated user-tags
 *  - !tagname in user-tags → suppress that auto-tag (silent no-op if absent)
 *  - Non-negated user-tags are added to the final set
 *  - Result is deduplicated and natural-sorted
 */
export function mergeTags(userTags: string[], autoTags: string[]): string[] {
  const result = new Set<string>();

  if (userTags.includes('!*')) {
    for (const t of userTags) {
      if (!t.startsWith('!')) result.add(t);
    }
    return [...result].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    );
  }

  // Start with all auto-tags
  for (const t of autoTags) result.add(t);

  // Collect suppressed tags
  const suppressed = new Set<string>();
  for (const t of userTags) {
    if (t.startsWith('!')) {
      suppressed.add(t.slice(1));
    }
  }

  // Remove suppressed (silent no-op if tag not in set)
  for (const s of suppressed) result.delete(s);

  // Add non-negated user-tags
  for (const t of userTags) {
    if (!t.startsWith('!')) result.add(t);
  }

  return [...result].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

/**
 * Apply auto-tagging to note content before save.
 *
 * - Skips the _tagcloud note itself
 * - If user-tags contain !*, removes any existing auto-tags and returns
 * - Otherwise scans body against _tagcloud rules and updates auto-tags
 * - Only touches the frontmatter if auto-tags actually changed
 *
 * @returns Content with auto-tags frontmatter key updated (or unchanged)
 */
export async function applyAutotags(id: string, content: string): Promise<string> {
  if (id === '_tagcloud') return content;

  const { meta, body } = parseFrontmatter(content);
  const userTags: string[] = Array.isArray(meta['user-tags'])
    ? meta['user-tags']
    : [];

  if (isAutotagDisabled(userTags)) {
    // Remove any existing auto-tags
    if ('auto-tags' in meta) {
      return updateFrontmatter(content, { 'auto-tags': undefined });
    }
    return content;
  }

  const rules = await loadRules();
  if (rules.length === 0) {
    // No rules defined — clean up stale auto-tags
    if ('auto-tags' in meta) {
      return updateFrontmatter(content, { 'auto-tags': undefined });
    }
    return content;
  }

  const autoTags = scanContent(body, rules);
  const existingAuto: string[] = Array.isArray(meta['auto-tags'])
    ? meta['auto-tags']
    : (typeof meta['auto-tags'] === 'string' ? [meta['auto-tags']] : []);

  // Avoid frontmatter churn when nothing changed
  if (_tagsEqual(existingAuto, autoTags)) return content;

  return updateFrontmatter(content, {
    'auto-tags': autoTags.length > 0 ? autoTags : undefined,
  });
}

/** Clear the rule cache (useful for testing or forced refresh). */
export function clearRulesCache(): void {
  _rulesCache = null;
  _cacheKey = null;
}

// ── Internal helpers ─────────────────────────────────────────────────────

function _tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
