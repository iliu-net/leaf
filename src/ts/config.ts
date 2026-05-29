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

/** Build a full API URL, e.g. apiUrl("auth") → "/app1/spa/../api/index.php/auth". */
export function apiUrl(endpoint: string): string {
  return _apiBaseUrl + 'index.php/' + endpoint;
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

// ── SPA config (server-provided) ────────────────────────────────────────────

/** A plugin entry: either a plain name or a tuple of [name, ...options]. */
export type PluginEntry = string | [string, ...any[]];

export interface SpaConfig {
  markdown: {
    html: boolean;
    /** Plugin entries to activate.  Plain string for no options, tuple
     *  [name, ...options] for plugins that need per-instance config. */
    plugins?: PluginEntry[];
  };
  /** Days before deleted notes are purged client-side. */
  deleted_notes_ttl_days: number;
  /** Timestamp format string (e.g. 'YYYY-MM-DD HH:mm'), or null for client default. */
  timestamp_format: string | null;
  /** Spellcheck configuration (client-side only — not written to server). */
  spellcheck?: {
    /** Default BCP 47 language tag (e.g. 'en-US'). Falls back to <html lang> → 'en-US'. */
    default_lang?: string;
    /** Languages to show in the meta-tab language picker. */
    preferred_langs?: string[];
  };
}

/** Hardcoded safe defaults used when no config has been fetched yet. */
const DEFAULT_SPA_CONFIG: SpaConfig = {
  markdown: { html: false, plugins: [] },
  deleted_notes_ttl_days: 7,
  timestamp_format: null,
  spellcheck: {
    default_lang: 'en-US',
    preferred_langs: ['en-US', 'en-GB', 'es', 'fr', 'de', 'it', 'pt', 'nl'],
  },
};

let _spaConfig: SpaConfig = { ...DEFAULT_SPA_CONFIG };

function cacheKey(): string {
  const ns = getNamespace();
  return (ns || 'root') + ':spa-config';
}

/**
 * Fetch the SPA config from the server and cache it in localStorage.
 * Fire-and-forget: catches all errors internally and never throws.
 * On failure, falls back to localStorage, then hardcoded defaults.
 */
export async function fetchSpaConfig(): Promise<void> {
  try {
    const resp = await fetch(apiUrl('spa-config'));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json: SpaConfig = await resp.json();
    _spaConfig = json;
    try {
      localStorage.setItem(cacheKey(), JSON.stringify(json));
    } catch { /* localStorage unavailable (private browsing, quota) */ }
  } catch {
    // Server unreachable — try localStorage cache
    try {
      const cached = localStorage.getItem(cacheKey());
      if (cached) _spaConfig = JSON.parse(cached) as SpaConfig;
    } catch { /* corrupted cache or localStorage unavailable — keep defaults */ }
  }
}

/**
 * Return the in-memory SPA config synchronously.
 * Populated by fetchSpaConfig() at boot, otherwise returns hardcoded safe defaults.
 */
export function getSpaConfig(): SpaConfig {
  return _spaConfig;
}

/**
 * Spellcheck config with defaults filled in (never undefined).
 * Safe to call before fetchSpaConfig() completes.
 */
export function getSpellcheckConfig(): Required<NonNullable<SpaConfig['spellcheck']>> {
  const sc = _spaConfig.spellcheck ?? DEFAULT_SPA_CONFIG.spellcheck!;
  return {
    default_lang: sc.default_lang || DEFAULT_SPA_CONFIG.spellcheck!.default_lang!,
    preferred_langs: sc.preferred_langs?.length
      ? sc.preferred_langs
      : DEFAULT_SPA_CONFIG.spellcheck!.preferred_langs!,
  };
}
