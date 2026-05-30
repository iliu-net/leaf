/**
 * local-store.ts — localStorage persistence layer
 *
 * All leaf:* keys live *here*.  Every other module imports its key from
 * this file instead of defining private constants or calling localStorage
 * directly.  This gives us:
 *
 *   1. A single place to audit every persisted value.
 *   2. Safe wrappers on every call — no bare localStorage access anywhere.
 *   3. Explicit scoping: namespaced (isolated per install path) vs shared
 *      (same across all Leaf instances on this origin).
 *
 * Also owns install-path namespace derivation (moved here from config.ts
 * to break a circular dependency).
 */

// ── Install-path namespace derivation ─────────────────────────────────────
//
// Reads `location.pathname` once at module-load time.  Multiple Leaf
// installs on the same origin (e.g. /personal/ and /work/) get distinct
// namespace slugs so their localStorage keys don't collide.

/** Clean directory path of the SPA, e.g. "/app1/spa/" or "/" for root. */
function deriveInstallPath(): string {
  let p = location.pathname;

  // Strip filename if present (e.g. /app1/spa/index.html → /app1/spa/)
  p = p.replace(/\/index\.html$/, '/');

  // Ensure trailing slash
  if (!p.endsWith('/')) p += '/';

  return p;
}

const _installPath = deriveInstallPath();

/** The SPA's install directory, always ending with "/". */
export function getInstallPath(): string {
  return _installPath;
}

/**
 * A filesystem-safe slug derived from the install path.
 * Empty string for root deployments (backward compatible).
 *
 *   /              → ""
 *   /app1/spa/     → "app1-spa"
 *   /notes/work/   → "notes-work"
 */
export function getNamespace(): string {
  const trimmed = _installPath.replace(/^\/|\/$/g, '');
  return trimmed ? trimmed.replace(/\//g, '-') : '';
}

// ── Safe wrappers ──────────────────────────────────────────────────────────

function get(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function set(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* quota / private browsing */ }
}

function remove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// ── Namespace resolution ───────────────────────────────────────────────────
//
// Multiple Leaf installs on the same origin (e.g. /personal/ and /work/)
// need isolated storage.  These helpers suffix keys with the install-path
// slug so each instance gets its own slot.

const _ns = getNamespace();

/** Key suffix pattern: {base} for root, {base}:{ns} for named installs. */
function ns(base: string): string {
  return _ns ? `${base}:${_ns}` : base;
}

/** Key suffix pattern: {nsOrFallback}:{base} (used by spaConfig). */
function nsOr(base: string, fallback: string): string {
  return `${_ns || fallback}:${base}`;
}

// ── Namespace-scoped keys (isolated per install path) ──────────────────────

/** Last opened note ID — restored on boot. */
export const lastNote = {
  get:    (): string | null => get(ns('leaf:last-note')),
  set:    (id: string): void => set(ns('leaf:last-note'), id),
  remove: (): void => remove(ns('leaf:last-note')),
};

/** Server SPA config — cached for offline startup. */
export const spaConfig = {
  get:    (): string | null => get(nsOr('spa-config', 'root')),
  set:    (json: string): void => set(nsOr('spa-config', 'root'), json),
};

/** Sync revision watermark — resume point after interruption. */
export const revision = {
  get:    (): string | null => get(ns('notes_sync_revision')),
  set:    (rev: number): void => set(ns('notes_sync_revision'), String(rev)),
  remove: (): void => remove(ns('notes_sync_revision')),
};

// ── Shared keys (same across all installs on this origin) ─────────────────

/** UI theme preference. */
export const theme = {
  get: (): string | null => get('leaf:theme'),
  set: (t: string): void => set('leaf:theme', t),
};

/** Sidebar drag-resize width in pixels. */
export const sidebarWidth = {
  get: (): string | null => get('leaf:sidebar-width'),
  set: (w: number): void => set('leaf:sidebar-width', String(Math.round(w))),
};

/** Convenience: clear all leaf:* keys (useful for DB reset / testing). */
export function clearAll(): void {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('leaf:')) keys.push(k);
    }
  } catch { /* ignore */ }
  for (const k of keys) remove(k);
}
