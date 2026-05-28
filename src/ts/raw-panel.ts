/**
 * raw-panel.ts — raw (textarea) tab panel
 *
 * Owns all textarea DOM and dispatches `note-changed` on programmatic writes.
 */

/** Handlers for raw-panel events. */
export interface RawEventHandlers {
  onInput: () => void;  // textarea input → dispatch note-changed
}

// ── DOM refs ──────────────────────────────────────────────────────────────

let _noteArea: HTMLTextAreaElement | null = null;

// ── Init ──────────────────────────────────────────────────────────────────

/** One-time setup: cache DOM refs. */
export function initRawPanel(): void {
  _noteArea = document.getElementById('note-area') as HTMLTextAreaElement | null;
}

// ── Internal helper ──────────────────────────────────────────────────────

/** Get the textarea element, falling back to DOM lookup if not yet cached. */
function getTextArea(): HTMLTextAreaElement | null {
  return _noteArea ?? document.getElementById('note-area') as HTMLTextAreaElement | null;
}

// ── Panel lifecycle ───────────────────────────────────────────────────────

/** Show the raw panel and fill with content. */
export function showRawPanel(content: string): void {
  const el = getTextArea();
  if (!el) return;
  el.value = content;
  // Clear any stale inline display that hideEditor() or old code may have set
  el.style.display = '';
}

/** Hide the raw panel. */
export function hideRawPanel(): void {
  // The panel itself is hidden via CSS class — nothing to do here.
  // The textarea keeps its value in case the user switches back to Raw tab.
}

/** Get the current textarea value (plain read, no side-effects). */
export function getRawContent(): string {
  return getTextArea()?.value ?? '';
}

/**
 * Programmatic write + dispatch note-changed.
 * Use this instead of setting noteArea.value directly so the store stays in sync.
 */
export function setRawContent(content: string): void {
  const el = getTextArea();
  if (!el) return;
  el.value = content;
  el.dispatchEvent(new CustomEvent('note-changed', { bubbles: true }));
}

/** Focus the textarea. */
export function focusRawPanel(): void {
  getTextArea()?.focus();
}

// ── Event binding ─────────────────────────────────────────────────────────

/** Wire textarea input → onInput handler. */
export function bindRawEvents(handlers: RawEventHandlers): void {
  const el = getTextArea();
  if (!el) return;
  el.addEventListener('input', () => {
    handlers.onInput();
  });
}
