/// <reference types="vite/client" />

/**
 * Per-instance configuration set by the <script> block in index.html.
 * Each Leaf deployment copies index.html to its instance directory and
 * customises these values so the SPA knows where the API lives and how
 * to scope its localStorage / IndexedDB.
 *
 * All fields are optional — the SPA falls back to sensible defaults
 * derived from the install path (location.pathname) when omitted.
 */
interface LeafConfig {
  /**
   * Base URL of the Leaf API.  Must end with "/".
   *
   * Both absolute and relative URLs are supported:
   *   apiBase: '/api/'              // absolute
   *   apiBase: '../api/'            // relative (resolved by the browser)
   *   apiBase: '/app1/api/'         // absolute, subdirectory deployment
   *
   * Default: derived from install path + '../api/'
   */
  apiBase: string;
  /**
   * Optional namespace slug used to isolate localStorage keys and the
   * IndexedDB database name when multiple Leaf instances run on the same
   * origin.  Defaults to auto-derivation from the install path.
   */
  namespace?: string;
}

export {};

declare global {
  interface Window {
    /** Set by index.html — per-instance Leaf configuration. */
    LEAF_CONFIG?: LeafConfig;
  }

  /** Replaced by Vite at build time with `git describe --always --dirty=-M`. */
  const __APP_VERSION__: string;
}
