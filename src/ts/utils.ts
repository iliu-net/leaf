/**
 * utils.ts — shared utility functions
 *
 * Pure functions with no dependencies, safe to import anywhere
 * (including tests without a full browser environment).
 */

import { getSpaConfig } from './config.js';

// ── Observer helper ──────────────────────────────────────────────────────────

/**
 * Generic typed observer — creates a listener list with subscribe/notify.
 * Eliminates the push/splice boilerplate duplicated across change-bus,
 * sync-status, and auth-failure modules.
 *
 * Usage:
 *   const bus = createListenerList<(msg: string) => void>();
 *   const unsub = bus.subscribe(msg => console.log(msg));
 *   bus.notify('hello');
 */
export function createListenerList<T extends (...args: never[]) => void>() {
  const _listeners: T[] = [];
  return {
    /** Readonly access to the listener array — for custom iteration. */
    listeners: _listeners as readonly T[],
    /** Subscribe a listener. Returns an unsubscribe function. */
    subscribe(fn: T): () => void {
      _listeners.push(fn);
      return () => {
        const i = _listeners.indexOf(fn);
        if (i !== -1) _listeners.splice(i, 1);
      };
    },
    /** Notify all listeners with the given arguments. */
    notify(...args: Parameters<T>): void {
      for (const fn of _listeners) fn(...args);
    },
  };
}

// ── HTML tagged template ───────────────────────────────────────────────────

/**
 * Minimal tagged template literal for HTML strings.
 *
 * Returns a plain string — no DOM, no side-effects.
 * Safe for use anywhere a string is expected.
 *
 * Usage:
 *   html`<div class="foo">${esc(value)}</div>`
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let result = '';
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) result += String(values[i]);
  }
  return result;
}

// ── Content stats ──────────────────────────────────────────────────────────

/** Statistics computed from a plain-text body (no frontmatter). */
export interface ContentStats {
  chars: number;
  words: number;
  lines: number;
}

/**
 * Compute character, word, and line counts from a plain-text string.
 */
export function computeStats(body: string): ContentStats {
  if (!body) return { chars: 0, words: 0, lines: 0 };
  const chars = body.length;
  const words = body.trim() === '' ? 0 : body.trim().split(/\s+/).length;
  const lines = body === '' ? 0 : body.split('\n').length;
  return { chars, words, lines };
}

// ── HTML escaping ──────────────────────────────────────────────────────────

/** Minimal HTML entity escaping for display values. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Natural sort ───────────────────────────────────────────────────────────

/**
 * Compare strings with natural (human-friendly) ordering.
 * Splits on digit boundaries and compares numeric segments as numbers,
 * string segments via localeCompare.
 */
export function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const partsA: (string | number)[] = [];
  const partsB: (string | number)[] = [];

  let m: RegExpExecArray | null;
  while ((m = re.exec(a)) !== null) {
    partsA.push(m[1] !== undefined ? parseInt(m[1], 10) : m[2]);
  }
  while ((m = re.exec(b)) !== null) {
    partsB.push(m[1] !== undefined ? parseInt(m[1], 10) : m[2]);
  }

  const len = Math.min(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const ca = partsA[i];
    const cb = partsB[i];
    if (ca === cb) continue;
    if (typeof ca === 'number' && typeof cb === 'number') return ca - cb;
    if (typeof ca === 'string' && typeof cb === 'string') return ca.localeCompare(cb);
    return typeof ca === 'number' ? -1 : 1;
  }
  return partsA.length - partsB.length;
}

// ── Note name sanitization ─────────────────────────────────────────────────

/**
 * Sanitize a user-supplied note name into a safe filesystem-friendly identifier.
 *
 * Maps slashes to colons, replaces leading dots with underscore, strips
 * unsafe characters, and truncates to 80 characters.
 *
 * @param raw  Raw user input
 * @returns    Sanitized safe identifier
 */
export function safeName(raw: string): string {
  let name = raw.trim();
  name = name.replace(/\//g, ':');
  name = name.replace(/^\.+/, '_');
  name = name.replace(/[^a-zA-Z0-9_\-\.$%'@~!(){}^#&`: +,;=\[\] ]/g, '_');
  return name.slice(0, 80);
}

// ── Timestamp helpers ─────────────────────────────────────────────────────

/** Current unix timestamp in seconds (matching the server wire format). */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Format a unix timestamp (seconds) as a human-readable string.
 *
 * Uses the server-provided `timestamp_format` config (PHP `date()` tokens)
 * when set.  Falls back to `Date.toLocaleString()` when the config is null.
 *
 * Supported PHP tokens: Y y m n d j H G h g i s A a
 * Unrecognized characters pass through literally (dashes, colons, spaces).
 */
export function formatTimestamp(ts: number): string {
  if (!ts) return '';
  const fmt = getSpaConfig().timestamp_format;
  const d = new Date(ts * 1000);
  if (!fmt) return d.toLocaleString();

  // PHP date() token → Date getter + pad width
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  const tokens: Record<string, () => string> = {
    Y: () => pad(d.getFullYear(), 4),
    y: () => pad(d.getFullYear() % 100, 2),
    m: () => pad(d.getMonth() + 1, 2),
    n: () => String(d.getMonth() + 1),
    d: () => pad(d.getDate(), 2),
    j: () => String(d.getDate()),
    H: () => pad(d.getHours(), 2),
    G: () => String(d.getHours()),
    h: () => pad((d.getHours() % 12) || 12, 2),
    g: () => String((d.getHours() % 12) || 12),
    i: () => pad(d.getMinutes(), 2),
    s: () => pad(d.getSeconds(), 2),
    A: () => d.getHours() < 12 ? 'AM' : 'PM',
    a: () => d.getHours() < 12 ? 'am' : 'pm',
  };

  let result = '';
  let i = 0;
  while (i < fmt.length) {
    // Try two-char lookahead first (e.g. "Y-m-d" — 'Y' before '-')
    const one = fmt[i];
    const fn = tokens[one];
    if (fn) {
      result += fn();
      i++;
    } else {
      result += one;
      i++;
    }
  }
  return result;
}

/**
 * Relative time string from a unix timestamp (seconds).
 *
 * @param ts  Unix timestamp in seconds
 * @returns   e.g. "3 hours ago", "just now"
 */
export function relativeTime(ts: number): string {
  const diff = nowSec() - ts;
  if (diff < 60) return 'just now';
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months !== 1 ? 's' : ''} ago`;
}
