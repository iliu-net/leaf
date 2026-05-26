/**
 * frontmatter.ts — pure frontmatter parsing & serialization
 *
 * No DOM dependencies.  Fully unit-testable without a browser.
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface FrontmatterResult {
  meta: Record<string, string | string[]>;
  body: string;
}

export interface PendingMeta {
  title: string;
  summary: string;
  tags: string[];
  custom: Record<string, string>;   // key → value
}

export interface ContentStats {
  chars: number;
  words: number;
  lines: number;
}

// ── Constants ────────────────────────────────────────────────────────────

/** Regex that a valid frontmatter key must match. Keep in sync with parser. */
const VALID_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

/** Keys that are handled by dedicated fields (not custom). */
const RESERVED_KEYS = new Set([
  'title',
  'summary',
  'user-tags',
  'auto-tags',
]);

// ── Parser ───────────────────────────────────────────────────────────────

/**
 * Parse YAML-lite frontmatter from note content.
 *
 *   ---
 *   title: My note
 *   user-tags: [work, meetings]
 *   ---
 *   Body text...
 *
 * If no frontmatter block is present, returns { meta: {}, body: rawContent }.
 */
export function parseFrontmatter(raw: string | null | undefined): FrontmatterResult {
  if (typeof raw !== 'string') return { meta: {}, body: '' };

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta: Record<string, string | string[]> = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    const trimmed = val.trim();
    // Parse inline arrays:  [one, two, three]
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      meta[key] = trimmed
        .slice(1, -1)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    } else {
      meta[key] = trimmed;
    }
  }

  return { meta, body: match[2] };
}

// ── Serialization ────────────────────────────────────────────────────────

/**
 * Merge fields into a note's frontmatter.
 *
 * If no frontmatter block exists, create one.
 * Preserves existing frontmatter fields not in `updates`.
 *
 * @param content  Raw note content (may or may not have frontmatter)
 * @param updates  Key-value pairs to set/delete in the frontmatter.
 *                 `undefined` deletes the key.
 *                 `string[]` serializes as `[a, b]` (bare bracket notation).
 */
export function updateFrontmatter(
  content: string,
  updates: Record<string, string | string[] | undefined>,
): string {
  const { meta, body } = parseFrontmatter(content);

  // Merge updates
  for (const [key, val] of Object.entries(updates)) {
    if (val === undefined) {
      delete meta[key];
    } else if (Array.isArray(val)) {
      meta[key] = `[${val.join(', ')}]`;
    } else {
      meta[key] = val;
    }
  }

  // Rebuild frontmatter
  const keys = Object.keys(meta);
  if (keys.length === 0) {
    // No frontmatter at all — just return the body
    return body;
  }

  const fmLines = keys.map(k => `${k}: ${meta[k]}`);
  const fm = `---\n${fmLines.join('\n')}\n---\n`;

  return fm + body;
}

// ── PendingMeta helpers ─────────────────────────────────────────────────

/**
 * Build initial pending state from parsed frontmatter.
 */
export function initPendingMeta(fm: FrontmatterResult['meta']): PendingMeta {
  const rawTags = Array.isArray(fm['user-tags']) ? fm['user-tags'] : [];
  return {
    title:   (typeof fm['title'] === 'string' ? fm['title'] : ''),
    summary: (typeof fm['summary'] === 'string' ? fm['summary'] : ''),
    tags:    sanitizeTags(rawTags),
    custom:  extractCustom(fm),
  };
}

/**
 * Convert pending meta into an update map suitable for `updateFrontmatter()`.
 */
export function pendingMetaToUpdates(pm: PendingMeta): Record<string, string | string[] | undefined> {
  const tags = sanitizeTags(pm.tags);

  const updates: Record<string, string | string[] | undefined> = {
    title:      pm.title || undefined,
    summary:    pm.summary || undefined,
    'user-tags': tags.length > 0 ? tags : undefined,
  };

  // Merge custom fields (only valid keys survive)
  for (const [key, val] of Object.entries(sanitizeCustom(pm.custom))) {
    updates[key] = val || undefined;
  }

  return updates;
}

/**
 * Dirty comparison of two PendingMeta objects.
 */
export function pendingMetaEqual(a: PendingMeta, b: PendingMeta): boolean {
  if (a.title !== b.title) return false;
  if (a.summary !== b.summary) return false;
  if (a.tags.length !== b.tags.length) return false;
  for (let i = 0; i < a.tags.length; i++) {
    if (a.tags[i] !== b.tags[i]) return false;
  }
  const aKeys = Object.keys(a.custom);
  const bKeys = Object.keys(b.custom);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a.custom[k] !== b.custom[k]) return false;
  }
  return true;
}

/**
 * Compute content statistics from the body portion (frontmatter stripped).
 */
export function computeStats(body: string): ContentStats {
  if (!body) return { chars: 0, words: 0, lines: 0 };
  const chars = body.length;
  const words = body.trim() === '' ? 0 : body.trim().split(/\s+/).length;
  const lines = body === '' ? 0 : body.split('\n').length;
  return { chars, words, lines };
}

// ── Sanitization ──────────────────────────────────────────────────────────

/**
 * Return the key if it is a valid frontmatter identifier, else ''.
 */
export function sanitizeKey(key: string): string {
  return VALID_KEY_RE.test(key) ? key : '';
}

/**
 * Deduplicate and natural-sort an array of tags.
 */
export function sanitizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const t of tags) {
    const trimmed = t.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      deduped.push(trimmed);
    }
  }
  deduped.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return deduped;
}

/**
 * Remove entries with invalid keys from a custom-fields record.
 */
export function sanitizeCustom(custom: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(custom)) {
    if (VALID_KEY_RE.test(key)) {
      out[key] = val;
    }
  }
  return out;
}

// ── Internal helpers ─────────────────────────────────────────────────────

/**
 * Extract custom (non-reserved) key/value pairs from frontmatter meta.
 */
function extractCustom(meta: Record<string, string | string[]>): Record<string, string> {
  const custom: Record<string, string> = {};
  for (const [key, val] of Object.entries(meta)) {
    if (!RESERVED_KEYS.has(key)) {
      custom[key] = typeof val === 'string' ? val : val.join(', ');
    }
  }
  return sanitizeCustom(custom);
}
