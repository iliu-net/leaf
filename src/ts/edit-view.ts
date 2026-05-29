/**
 * edit-view.ts — raw (textarea) editor tab
 *
 * Owns all textarea DOM.  Source of truth for note content.
 * Implements TabPanel so editor-ctrl.ts treats it uniformly.
 */

import type { TabPanel, TabPanelContext } from './tab-panel.js';
import { DOM, $maybe } from './dom-ids.js';

/** Handlers for edit-view events. */
export interface EditEventHandlers {
  onInput: () => void;  // textarea input → dispatch note-changed
}

// ── DOM refs ──────────────────────────────────────────────────────────────

let _noteArea: HTMLTextAreaElement | null = null;

// ── Init (TabPanel) ───────────────────────────────────────────────────────

/** One-time setup: cache DOM refs. */
export function init(): void {
  _noteArea = $maybe(DOM.NOTE_AREA) as HTMLTextAreaElement | null;
}

// ── TabPanel lifecycle ────────────────────────────────────────────────────

/** Show the raw panel and fill with content. */
export function show(ctx: TabPanelContext): void {
  const el = getTextArea();
  if (!el) return;
  el.value = ctx.content;
  el.style.display = '';
}

/** Hide the raw panel.  Textarea keeps its value for tab switches. */
export function hide(): void {
  // Panel visibility managed via CSS — nothing to do here.
}

// ── Content access ────────────────────────────────────────────────────────

/** Get the current textarea value (plain read, no side-effects). */
export function getContent(): string {
  return getTextArea()?.value ?? '';
}

/**
 * Programmatic write + dispatch note-changed.
 * Use this instead of setting noteArea.value directly so the store stays in sync.
 */
export function setContent(content: string): void {
  const el = getTextArea();
  if (!el) return;
  el.value = content;
  el.dispatchEvent(new CustomEvent('note-changed', { bubbles: true }));
}

/** Focus the textarea. */
export function focus(): void {
  getTextArea()?.focus();
}

// ── Event binding ─────────────────────────────────────────────────────────

/** Wire textarea input → onInput handler. */
export function bindEvents(handlers: EditEventHandlers): void {
  const el = getTextArea();
  if (!el) return;
  el.addEventListener('input', () => handlers.onInput());
}

// ── Internal ──────────────────────────────────────────────────────────────

function getTextArea(): HTMLTextAreaElement | null {
  return _noteArea ?? $maybe(DOM.NOTE_AREA) as HTMLTextAreaElement | null;
}

/** TabPanel contract — typed lens for editor-ctrl.ts registration. */
export const tabPanel: TabPanel = { init, show, hide };
