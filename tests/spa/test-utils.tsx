/**
 * test-utils.tsx — Shared React test helpers.
 *
 * Import this in every React component test instead of @testing-library/react
 * directly.  It provides:
 *   - renderWithProviders() — wraps the component in <AppProvider>
 *   - Re-exports: render, screen, fireEvent, waitFor, act, cleanup, within
 *   - userEvent (renamed for clarity: user)
 *
 * Usage:
 *   import { renderWithProviders, screen, user } from '../test-utils.js';
 */

import React from 'react';
import {
  render,
  type RenderOptions,
} from '@testing-library/react';
import { type ReactElement } from 'react';
import { AppProvider } from '../../src/ts/state/AppContext.js';

// ── Provider wrapper ─────────────────────────────────────────────────────

function AllProviders({ children }: { children: React.ReactNode }) {
  return <AppProvider>{children}</AppProvider>;
}

/**
 * Render a React element wrapped in AppProvider (and any future shared
 * providers).  Accepts the same options as @testing-library/react's render().
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

// ── Re-exports ───────────────────────────────────────────────────────────

export { screen, fireEvent, waitFor, act, cleanup, within } from '@testing-library/react';
export { default as user } from '@testing-library/user-event';
