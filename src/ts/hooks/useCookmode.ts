/**
 * useCookmode.ts — Hook for the Screen Wake Lock toggle.
 *
 * Wraps cookmode.ts's module-level state with React useState so the
 * StatusBar button stays in sync even when the OS releases the lock
 * (tab switch, screen timeout, etc.).
 */

import { useState, useCallback, useEffect } from 'react';
import { isActive, toggle as toggleCookmode, onCookmodeChange } from '../cookmode.js';

export function useCookmode() {
  const [active, setActive] = useState<boolean>(() => isActive());

  // Subscribe to async state changes (OS release, visibility re-acquire)
  useEffect(() => {
    onCookmodeChange(setActive);
    return () => onCookmodeChange(null);
  }, []);

  const toggle = useCallback(async () => {
    const result = await toggleCookmode();
    setActive(result);
  }, []);

  return { active, toggle };
}
