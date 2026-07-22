/**
 * useConfig.ts — Hook exposing SPA config values from the existing config.ts module.
 *
 * Since config.ts is a synchronous module with getters (it populates on
 * boot via loadConfig() / fetchSpaConfig()), this hook is a thin wrapper
 * that provides a convenient React-friendly API.
 *
 * Phase 2: hook exists, can be called manually.
 * Phase 5: used by boot sequence for language, autosave, edit-time config.
 */

import { useMemo } from 'react';
import {
  getSpaConfig,
  getLanguageConfig,
  getAutosaveConfig,
  getEditTimeConfig,
  getAuthConfig,
  isAuthEnabled,
  fetchSpaConfig,
  loadConfig,
} from '../config.js';
import type { SpaConfig } from '../config.js';

export function useConfig() {
  const spaConfig = useMemo(() => getSpaConfig(), []);
  const language = useMemo(() => getLanguageConfig(), []);
  const autosave = useMemo(() => getAutosaveConfig(), []);
  const editTime = useMemo(() => getEditTimeConfig(), []);

  const auth = useMemo(() => getAuthConfig(), []);
  const isAuthEnabledMemo = useMemo(() => isAuthEnabled(), []);

  return {
    /** The full SPA config object (from server or defaults). */
    spaConfig,
    /** Spellcheck / language config. */
    language,
    /** Auto-save config (enabled, delay_ms). */
    autosave,
    /** Edit-time tracking config. */
    editTime,
    /** Authentication config (enabled: boolean). */
    auth,
    /** True if authentication is enabled in the server SPA config. */
    isAuthEnabled: isAuthEnabledMemo,
    /** Load local config (called once on boot). */
    loadConfig,
    /** Fetch server config (called once on boot, after loadConfig). */
    fetchSpaConfig,
  };
}
