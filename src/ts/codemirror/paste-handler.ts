/**
 * paste-handler.ts — CodeMirror paste interceptor
 *
 * ViewPlugin that intercepts paste events on the CodeMirror editor:
 *   1. Image content → opens image-editor modal → inserts Markdown image
 *   2. HTML content  → converted to Markdown via turndown (lazy-loaded)
 *   3. Plain text    → let CM default handler take over
 */

import { ViewPlugin, EditorView } from '@codemirror/view';
import type { ImageEditorResult } from '../components/ImageEditor.js';

/**
 * Bridge to the React ImageEditor component.
 *
 * Uses window.__imgEditorCalls + CustomEvent to avoid module-level state
 * which Vite HMR preserves across fast-refresh (causing stale dialogs).
 * Each call gets a UUID; the React component resolves via that key.
 */
export function openImageEditor(blob: Blob): Promise<ImageEditorResult | null> {
  return new Promise(resolve => {
    const id = crypto.randomUUID();
    const reg = ((window as any).__imgEditorCalls =
      (window as any).__imgEditorCalls || {});
    reg[id] = resolve;
    window.dispatchEvent(
      new CustomEvent('leaf:open-image-editor', { detail: { id, blob } }),
    );
  });
}

// ── HTML ↦ Markdown ──────────────────────────────────────────────────────

let _turndownService: any = null;
let _turndownLoading: Promise<any> | null = null;

export function ensureTurndown(): Promise<any> | null {
  if (_turndownService) return Promise.resolve(_turndownService);
  if (_turndownLoading) return _turndownLoading;
  _turndownLoading = import('turndown')
    .then(mod => {
      const T = mod.default;
      _turndownService = new T({
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
      });
      return _turndownService;
    })
    .catch(() => {
      _turndownLoading = null;
      return null;
    });
  return _turndownLoading;
}

export function htmlToMarkdown(html: string): string | null {
  if (!_turndownService) return null;
  try { return _turndownService.turndown(html); }
  catch { return null; }
}

// ── Image extraction ─────────────────────────────────────────────────────

export function extractImages(items: DataTransferItemList): { blob: Blob }[] {
  const images: { blob: Blob }[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const blob = item.getAsFile();
      if (blob) images.push({ blob });
    }
  }
  return images;
}

// ── ViewPlugin ───────────────────────────────────────────────────────────

class PastePlugin {
  constructor(readonly view: EditorView) {}

  handlePaste(event: ClipboardEvent, view: EditorView): boolean {
    const cd = event.clipboardData;
    if (!cd) return false;

    // ── Image paste (check first — screenshots supply both image + html) ──
    if (cd.items && cd.items.length > 0) {
      const images = extractImages(cd.items);
      if (images.length > 0) {
        event.preventDefault();
        this._pasteImages(images, view);
        return true;
      }
    }

    // ── HTML paste ──────────────────────────────────────────────────────
    const html = cd.getData('text/html');
    if (html) {
      event.preventDefault();
      this._pasteHtml(html, view);
      return true;
    }

    // ── Plain text — let CM handle it ───────────────────────────────────
    return false;
  }

  // ── Private ───────────────────────────────────────────────────────────

  private async _pasteImages(
    images: { blob: Blob }[],
    view: EditorView,
  ): Promise<void> {
    let cursor = view.state.selection.main.from;

    for (const img of images) {
      try {
        const result = await openImageEditor(img.blob);
        if (!result) {
          console.log('[paste-handler] Image editor cancelled or failed');
          continue;
        }
        console.log('[paste-handler] Inserting image, dataUrl len:', result.dataUrl.length);
        const md = `![image](${result.dataUrl})`;
        view.dispatch({
          changes: { from: cursor, insert: md + '\n' },
          selection: { anchor: cursor + md.length + 1 },
        });
        cursor = view.state.selection.main.from;
      } catch (err) {
        console.error('[paste-handler] Image paste error:', err);
      }
    }

    // Restore focus — the image editor modal steals it while open.
    view.focus();
  }

  private async _pasteHtml(html: string, view: EditorView): Promise<void> {
    const td = await ensureTurndown();
    if (!td) {
      // turndown unavailable — insert raw text as fallback
      const div = document.createElement('div');
      div.innerHTML = html;
      const text = div.textContent || '';
      if (text) {
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
      }
      return;
    }

    const md = htmlToMarkdown(html);
    if (md == null) return;

    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: md },
      selection: { anchor: from + md.length },
    });
  }
}

/**
 * Plugin spec assigned before any paste event can fire.
 * Split from `export const pasteHandler = ...` to avoid a circular
 * inference chain in TypeScript (the event handler callback closes over
 * the plugin reference, which is the initializer of the const).
 */
let _pastePlugin: ViewPlugin<PastePlugin>;

_pastePlugin = ViewPlugin.fromClass(PastePlugin, {
  eventHandlers: {
    paste(event, view) {
      const plugin = view.plugin(_pastePlugin);
      if (plugin) return plugin.handlePaste(event as ClipboardEvent, view);
      return false;
    },
  },
});

export const pasteHandler = _pastePlugin;
