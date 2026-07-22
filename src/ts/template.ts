/**
 * template.ts — Eta-based template expansion for markdown notes
 *
 * Only active when a note's frontmatter contains `template: true`.
 * Fetches listed `template-deps` from IndexedDB before rendering so
 * other notes' frontmatter and body are available in the template.
 *
 * No recursion — referenced notes are fetched raw; their own
 * `template` flag is ignored.
 */

import { Eta } from 'eta/core';
import type { EtaConfig } from 'eta/core';
import type { SpaConfig } from './config.js';
import { getSpaConfig } from './config.js';
import { parseFrontmatter } from './frontmatter.js';
import type { FrontmatterResult } from './frontmatter.js';
import { dbGetNote } from './db.js';
import { registerSystemNote } from './system-notes/registry.js';
import templateDocs from './template-docs.md';

registerSystemNote({
  id: '@help:markdown:template',
  label: 'Template Expansion',
  content: () => templateDocs,
});

// ── Data shape ──────────────────────────────────────────────────────────────

/** Data passed to Eta templates. Accessible as `$` inside templates. */
export interface TemplateData {
  meta: FrontmatterResult['meta'];
  config: SpaConfig;
  notes: Record<string, { meta: FrontmatterResult['meta']; body: string }>;
  noteId: string;
}

// ── Eta instance ────────────────────────────────────────────────────────────

const _eta: Eta = new Eta({
  varName: '$',
  autoEscape: true,
  tags: ['<%', '%>'],
  parse: {
    exec: '',
    interpolate: '=',
    raw: '~',
  },
} satisfies Partial<EtaConfig>);

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Expand a note body through Eta if `template: true` is set in frontmatter.
 *
 * When active:
 *   1. Reads `template-deps` (string array of note IDs) from frontmatter
 *   2. Batch-fetches those notes from IndexedDB
 *   3. Parses each dep's frontmatter so both `.meta` and `.body` are available
 *   4. Renders the body through Eta with `$` bound to { meta, config, notes, noteId }
 *
 * When `template` is not `"true"`, returns the body unchanged.
 *
 * @param body   Raw note body (frontmatter already stripped).
 * @param meta   Parsed frontmatter of the current note.
 * @param noteId Current note ID.
 * @returns      Expanded markdown string (or original body if not a template).
 */
export async function expandTemplate(
  body: string,
  meta: FrontmatterResult['meta'],
  noteId: string,
): Promise<string> {
  // Gate: only process notes with template: true
  if (meta['template'] !== 'true') return body;

  const config = getSpaConfig();

  // Resolve template-deps → { meta, body } map.
  // Handles both the freshly-parsed array form ([a, b]) and the
  // comma-joined string form (a, b) that results from a META-tab roundtrip.
  const rawDeps = meta['template-deps'];
  let depIds: string[];
  if (Array.isArray(rawDeps)) {
    depIds = rawDeps;
  } else if (typeof rawDeps === 'string' && rawDeps.trim()) {
    depIds = rawDeps.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    depIds = [];
  }
  const notes: TemplateData['notes'] = {};

  if (depIds.length > 0) {
    const records = await Promise.all(depIds.map(id => dbGetNote(id)));
    for (let i = 0; i < depIds.length; i++) {
      const record = records[i];
      if (record) {
        const fm = parseFrontmatter(record.content);
        notes[depIds[i]] = { meta: fm.meta, body: fm.body };
      }
    }
  }

  const data: TemplateData = { meta, config, notes, noteId };

  try {
    return _eta.renderString(body, data);
  } catch (err) {
    console.warn('[template] Eta render failed:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return `> **⚠ Template Error:** ${msg}\n\n${body}`;
  }
}
