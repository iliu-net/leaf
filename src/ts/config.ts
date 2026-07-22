/**
 * config.ts — per-instance runtime configuration
 *
 * Fetches and caches server-side SPA configuration (markdown plugins,
 * language, auto-save, etc.).  For install-path awareness, imports
 * getInstallPath / getNamespace from local-store.ts.
 */

import { getInstallPath, getNamespace, spaConfig } from './local-store.js';

// ── API URL helpers ─────────────────────────────────────────────────────────

/**
 * Derive the API base URL.  Order of precedence:
 *   1. window.LEAF_CONFIG.apiBase  (per-instance, set in index.html)
 *   2. install-path heuristic      (current dir + '../api/')
 */
function deriveApiBase(): string {
  if (typeof window !== 'undefined' && window.LEAF_CONFIG?.apiBase) {
    return window.LEAF_CONFIG.apiBase;
  }
  return getInstallPath() + '../api/';
}

const _apiBaseUrl = deriveApiBase();

/** The API base URL, e.g. "/api/" (absolute) or "../api/" (relative). */
export function getApiBaseUrl(): string {
  return _apiBaseUrl;
}

/** Build a full API URL, e.g. apiUrl("auth") → "/api/index.php/auth". */
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
  const src = (typeof window !== 'undefined' && window.LEAF_CONFIG?.apiBase)
    ? 'index.html' : 'install-path';
  console.log(
    '[config] install=%s  namespace=%s  api=%s  (source: %s)',
    getInstallPath(),
    ns || '(root)',
    _apiBaseUrl,
    src,
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
  /** Language configuration (client-side only — not written to server). */
  language?: {
    /** Default BCP 47 language tag (e.g. 'en-US'). Falls back to <html lang> → 'en-US'. */
    default_lang?: string;
    /** Languages to show in the meta-tab language picker. */
    preferred_langs?: string[];
  };
  /** Auto-save configuration. */
  autosave?: {
    /** Debounce delay in milliseconds before auto-save fires. Default 2000. */
    delay_ms?: number;
    /** Set to false to disable auto-save entirely. Default true. */
    enabled?: boolean;
  };
  /** Edit-time tracking configuration. */
  edit_time?: {
    /** Seconds of inactivity before the edit timer pauses. Default 300 (5 min). */
    inactivity_sec?: number;
  };
  /** Authentication configuration. */
  auth?: {
    /** Set to false to disable authentication entirely. Default true. */
    enabled?: boolean;
  };
  /** Server-reported version info (only present when online). */
  _server?: {
    version: string;
    php: string;
  };
}

/**
 * Hardcoded safe defaults used only when the server has never been
 * reached AND nothing is cached in localStorage (first-ever offline
 * load).  The server config is cached on every successful
 * fetchSpaConfig() and restored from localStorage on subsequent
 * offline loads — these defaults are a last-resort fallback.
 */
const DEFAULT_SPA_CONFIG: SpaConfig = {
  markdown: {
    html: false,
    plugins: [
      'wikilinks',              // [[note]] links — essential navigation
      'tasklists',              // - [ ] / - [x] checkboxes
      ['highlight', ['common']], // syntax highlighting — basic set
      'inline-extras',          // ++ins++, ^^sup^^, ,,sub,,
      'toc',                    // table of contents
    ],
  },
  deleted_notes_ttl_days: 7,
  timestamp_format: null,
  language: {
    default_lang: 'en-US',
    preferred_langs: ['en-US', 'en-GB', 'es', 'fr', 'de', 'it', 'pt', 'nl'],
  },
  autosave: {
    delay_ms: 2000,
    enabled: true,
  },
  edit_time: {
    inactivity_sec: 300,
  },
  auth: {
    enabled: true,
  },
};

let _spaConfig: SpaConfig = { ...DEFAULT_SPA_CONFIG };

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
    // Guard against invalid responses (e.g. SW offline fallback or
    // truncated cached values) that lack the required shape.
    if (!json || typeof json.markdown !== 'object') {
      throw new Error('Invalid spa-config response shape');
    }
    _spaConfig = json;
    spaConfig.set(JSON.stringify(json));
  } catch {
    // Server unreachable — try localStorage cache
    const cached = spaConfig.get();
    if (cached) {
      try { _spaConfig = JSON.parse(cached) as SpaConfig; } catch { /* corrupt */ }
    }
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
 * Language config with defaults filled in (never undefined).
 * Safe to call before fetchSpaConfig() completes.
 */
export function getLanguageConfig(): Required<NonNullable<SpaConfig['language']>> {
  const sc = _spaConfig.language ?? DEFAULT_SPA_CONFIG.language!;
  return {
    default_lang: sc.default_lang || DEFAULT_SPA_CONFIG.language!.default_lang!,
    preferred_langs: sc.preferred_langs?.length
      ? sc.preferred_langs
      : DEFAULT_SPA_CONFIG.language!.preferred_langs!,
  };
}

/**
 * Auto-save config with defaults filled in.
 * Safe to call before fetchSpaConfig() completes.
 */
export function getAutosaveConfig(): Required<NonNullable<SpaConfig['autosave']>> {
  const ac = _spaConfig.autosave ?? DEFAULT_SPA_CONFIG.autosave!;
  return {
    delay_ms: ac.delay_ms ?? DEFAULT_SPA_CONFIG.autosave!.delay_ms!,
    enabled: ac.enabled ?? DEFAULT_SPA_CONFIG.autosave!.enabled!,
  };
}

/**
 * Edit-time config with defaults filled in.
 * Safe to call before fetchSpaConfig() completes.
 */
export function getEditTimeConfig(): Required<NonNullable<SpaConfig['edit_time']>> {
  const et = _spaConfig.edit_time ?? DEFAULT_SPA_CONFIG.edit_time!;
  return {
    inactivity_sec: et.inactivity_sec ?? DEFAULT_SPA_CONFIG.edit_time!.inactivity_sec!,
  };
}

/**
 * Auth config with defaults filled in.
 * Safe to call before fetchSpaConfig() completes.
 */
export function getAuthConfig(): Required<NonNullable<SpaConfig['auth']>> {
  const ac = _spaConfig.auth ?? DEFAULT_SPA_CONFIG.auth!;
  return {
    enabled: ac.enabled ?? DEFAULT_SPA_CONFIG.auth!.enabled!,
  };
}

/**
 * Returns true if authentication is enabled on this instance.
 * Defaults to true when config hasn't been fetched yet.
 */
export function isAuthEnabled(): boolean {
  return getAuthConfig().enabled;
}
