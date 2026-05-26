/**
 * config.ts — per-instance runtime configuration
 *
 * Derives an installation namespace from the URL path so that multiple
 * instances of the SPA can coexist on the same origin without colliding
 * on origin-scoped storage (IndexedDB, localStorage, BroadcastChannel,
 * Cache API, cookies).
 *
 * Derivation rules:
 *   /                  → ""             (root — backward compatible)
 *   /app1/spa/         → "app1-spa"
 *   /notes/work/       → "notes-work"
 *
 * All modules that use origin-scoped identifiers (db.ts, sync.ts,
 * cross-tab.ts, sw.js) import the namespace from here and suffix their
 * keys with it.
 *
 * This module also replaces the hardcoded '../api/' URL prefix in
 * auth.ts and sync.ts, computing the API base relative to the install
 * path.
 */

// ── Namespace derivation ────────────────────────────────────────────────────

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
 */
export function getNamespace(): string {
  const trimmed = _installPath.replace(/^\/|\/$/g, '');
  return trimmed ? trimmed.replace(/\//g, '-') : '';
}

// ── API URL helpers ─────────────────────────────────────────────────────────

const _apiBaseUrl = _installPath + '../api/';

/** The API base URL, e.g. "/app1/spa/../api/" → resolves to "/app1/api/". */
export function getApiBaseUrl(): string {
  return _apiBaseUrl;
}

/** Build a full API URL, e.g. apiUrl("auth.php") → "/app1/spa/../api/auth.php". */
export function apiUrl(endpoint: string): string {
  return _apiBaseUrl + endpoint;
}

// ── Boot ────────────────────────────────────────────────────────────────────

/**
 * Log the derived configuration.  Call once at app boot (before any
 * storage access) so the values are visible in the console.
 */
export function loadConfig(): void {
  const ns = getNamespace();
  console.log(
    '[config] install=%s  namespace=%s  api=%s',
    _installPath,
    ns || '(root)',
    _apiBaseUrl,
  );
}
