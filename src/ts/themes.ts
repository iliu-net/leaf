/**
 * themes.ts — UI theme switching
 *
 * Manages the <html data-theme> attribute, localStorage persistence,
 * theme-color meta tag, and the theme-option button group in the
 * app menu dropdown.  Extracted from ui.ts to keep the UI module
 * focused on general DOM wiring.
 */

import { theme } from './local-store.js';

// ── Theme colour map (for <meta name="theme-color">) ──────────────────────

const THEME_COLORS: Record<string, string> = {
  dark:         '#080808',
  light:        '#fafaf8',
  magenta:      '#ffffff',
  'paired-12':  '#0d1117',
};

/**
 * Apply a theme by name.  Callable from React — no DOM querying.
 * Updates data-theme attr, meta theme-color, localStorage, and CodeMirror.
 */
export function setTheme(themeName: string): void {
  document.documentElement.setAttribute('data-theme', themeName);
  theme.set(themeName);
  const mc = document.querySelector('meta[name="theme-color"]');
  if (mc) mc.setAttribute('content', THEME_COLORS[themeName] || '#080808');
  // Notify CodeMirror to swap syntax highlight style
  const setCM = (window as any).__leafSetCMTheme;
  if (setCM) setCM(themeName);
}

/** Get the current theme name. */
export function getTheme(): string {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Wire the theme-option buttons in the app menu dropdown.
 * Reads the current theme from <html data-theme>, syncs the active
 * indicator, and installs click handlers.
 *
 * Call once during boot (from ui.bindEvents).  Safe to call multiple
 * times — duplicate listeners are avoided via the .theme-option query.
 */
export function initThemeSwitcher(onSelect?: () => void): void {
  const themeOptions = document.querySelectorAll<HTMLButtonElement>('.theme-option');

  function applyTheme(themeName: string): void {
    document.documentElement.setAttribute('data-theme', themeName);
    theme.set(themeName);
    const mc = document.querySelector('meta[name="theme-color"]');
    if (mc) mc.setAttribute('content', THEME_COLORS[themeName] || '#080808');
    themeOptions.forEach(opt => {
      opt.classList.toggle('active', opt.dataset.themeVal === themeName);
    });
    // Notify CodeMirror to swap syntax highlight style (no-op if CM not loaded)
    const setCM = (window as any).__leafSetCMTheme;
    if (setCM) setCM(themeName);
    onSelect?.();
  }

  themeOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      const theme = opt.dataset.themeVal;
      if (theme) applyTheme(theme);
    });
  });

  // Sync initial active indicator with whatever the <head> script set
  const initialTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  themeOptions.forEach(opt => {
    opt.classList.toggle('active', opt.dataset.themeVal === initialTheme);
  });
}
