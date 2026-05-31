/**
 * registry.ts — System-note registry
 *
 * Fixed application-provided notes that ship with the app, similar in spirit
 * to browser `about:` pages.  Strictly read-only.
 *
 * All API is synchronous.
 */

export interface SystemNoteDef {
  id: string;              // e.g. "@help:shortcuts"
  label: string;           // display name in sidebar
  icon?: string;           // optional ICONS key
  content: () => string;   // synchronous — returns markdown
}

// ── Registry state ──────────────────────────────────────────────────────────

const _registry = new Map<string, SystemNoteDef>();

// ── Public API ──────────────────────────────────────────────────────────────

export function registerSystemNote(def: SystemNoteDef): void {
  if (_registry.has(def.id)) {
    console.warn(`[system-notes] Duplicate registration skipped: "${def.id}"`);
    return;
  }
  _registry.set(def.id, def);
}

export function getSystemNote(id: string): SystemNoteDef | undefined {
  return _registry.get(id);
}

export function listSystemNotes(): SystemNoteDef[] {
  return Array.from(_registry.values());
}

export function isSystemNote(id: string): boolean {
  return _registry.has(id);
}
