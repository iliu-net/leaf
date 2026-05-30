/**
 * config.ts — per-instance runtime configuration
 *
 * Fetches and caches server-side SPA configuration (markdown plugins,
 * spellcheck, auto-save, etc.).  For install-path awareness, imports
 * getInstallPath / getNamespace from local-store.ts.
 */

import { getInstallPath, getNamespace, spaConfig } from './local-store.js';

// ── API URL helpers ─────────────────────────────────────────────────────────

const _apiBaseUrl = getInstallPath() + '../api/';

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
    getInstallPath(),
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
  autosave: {
    delay_ms: 2000,
    enabled: true,
  },
  edit_time: {
    inactivity_sec: 300,
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
