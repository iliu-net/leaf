/**
 * meta-panel.ts — meta (structured metadata) tab panel
 *
 * Owns all meta-tab DOM: form fields, custom-field rows, system info,
 * and body-content statistics.
 */

import type { NoteData } from './notes.js';
import type { PendingMeta, ContentStats } from './frontmatter.js';
import type { MetaEventHandlers } from './view.js';
import { formatTimestamp } from './utils.js';

// ── DOM refs ──────────────────────────────────────────────────────────────

let _metaTitle:   HTMLInputElement | null = null;
let _metaSummary: HTMLTextAreaElement | null = null;
let _metaTags:    HTMLInputElement | null = null;
let _customRows:  HTMLElement | null = null;
let _metaStats:   HTMLElement | null = null;

let _sysCurrent:    HTMLElement | null = null;
let _sysCreated:    HTMLElement | null = null;
let _sysUpdated:    HTMLElement | null = null;
let _sysCreatedBy:  HTMLElement | null = null;
let _sysUpdatedBy:  HTMLElement | null = null;

// ── Init ──────────────────────────────────────────────────────────────────

/** One-time setup: cache DOM refs. */
export function initMetaPanel(): void {
  _metaTitle   = document.getElementById('meta-title')     as HTMLInputElement | null;
  _metaSummary = document.getElementById('meta-summary')   as HTMLTextAreaElement | null;
  _metaTags    = document.getElementById('meta-tags')      as HTMLInputElement | null;
  _customRows  = document.getElementById('meta-custom-rows');
  _metaStats   = document.getElementById('meta-stats');

  _sysCurrent   = document.getElementById('meta-sys-current');
  _sysCreated   = document.getElementById('meta-sys-created');
  _sysUpdated   = document.getElementById('meta-sys-updated');
  _sysCreatedBy = document.getElementById('meta-sys-created-by');
  _sysUpdatedBy = document.getElementById('meta-sys-updated-by');
}

// ── Panel lifecycle ───────────────────────────────────────────────────────

/**
 * Render the meta panel form fields and stats from pending meta data.
 */
export function renderMetaPanel(pm: PendingMeta, stats: ContentStats): void {
  if (_metaTitle)   _metaTitle.value   = pm.title;
  if (_metaSummary) _metaSummary.value = pm.summary;
  if (_metaTags)    _metaTags.value    = pm.tags.join(', ');

  // Custom fields
  renderCustomRows(pm.custom);

  // Stats
  if (_metaStats) {
    _metaStats.textContent = stats
      ? `${stats.chars.toLocaleString()} chars · ${stats.words.toLocaleString()} words · ${stats.lines} lines`
      : '';
  }
}

/**
 * Read current form values from the meta panel DOM.
 */
export function getMetaFormValues(): PendingMeta {
  const title   = _metaTitle?.value   ?? '';
  const summary = _metaSummary?.value ?? '';
  const tagsRaw = _metaTags?.value    ?? '';
  const tags    = tagsRaw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const custom = readCustomRows();

  return { title, summary, tags, custom };
}

/**
 * Clear the meta panel (called when editor is hidden).
 */
export function resetMetaPanel(): void {
  if (_metaTitle)   _metaTitle.value   = '';
  if (_metaSummary) _metaSummary.value = '';
  if (_metaTags)    _metaTags.value    = '';
  if (_customRows)  _customRows.innerHTML = '';
  if (_metaStats)   _metaStats.textContent = '';

  if (_sysCurrent)   _sysCurrent.textContent   = '';
  if (_sysCreated)   _sysCreated.textContent   = '';
  if (_sysUpdated)   _sysUpdated.textContent   = '';
  if (_sysCreatedBy) _sysCreatedBy.textContent = '';
  if (_sysUpdatedBy) _sysUpdatedBy.textContent = '';
}

/**
 * Populate system info fields from NoteData (IndexedDB record fields).
 */
export function populateSystemFields(noteData: NoteData): void {
  if (_sysCurrent)   _sysCurrent.textContent   = noteData.current ?? '';
  if (_sysCreated)   _sysCreated.textContent   = formatTimestamp(noteData.created_at);
  if (_sysUpdated)   _sysUpdated.textContent   = formatTimestamp(noteData.updated_at);
  if (_sysCreatedBy) _sysCreatedBy.textContent = noteData.created_by;
  if (_sysUpdatedBy) _sysUpdatedBy.textContent = noteData.updated_by;
}

// ── Event binding ─────────────────────────────────────────────────────────

/**
 * Wire meta panel events to handlers.
 * @param handlers  Callbacks for meta field changes
 */
export function bindMetaEvents(handlers: MetaEventHandlers): void {
  // Input/change events on dedicated fields
  const fieldIds = ['meta-title', 'meta-summary', 'meta-tags'];
  for (const id of fieldIds) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => handlers.onFieldChange());
    }
  }

  // Add custom field button
  const btnAdd = document.getElementById('btn-add-custom');
  if (btnAdd) {
    btnAdd.addEventListener('click', () => handlers.onAddCustomField());
  }

  // Remove custom field buttons are delegated via the custom rows container
  if (_customRows) {
    _customRows.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const removeBtn = target.closest('.btn-remove-custom');
      if (removeBtn) {
        const row = removeBtn.closest('.custom-row') as HTMLElement | null;
        if (row) {
          const keyInput = row.querySelector('.custom-key') as HTMLInputElement | null;
          const key = keyInput?.value ?? '';
          handlers.onRemoveCustomField(key);
        }
      }
    });

    // Also listen for input changes on custom fields
    _customRows.addEventListener('input', () => handlers.onFieldChange());
  }
}

// ── Custom field management ───────────────────────────────────────────────

/**
 * Render custom field rows from a key/value record.
 */
export function renderCustomRows(custom: Record<string, string>): void {
  if (!_customRows) return;
  _customRows.innerHTML = '';
  for (const [key, val] of Object.entries(custom)) {
    _customRows.appendChild(createCustomRow(key, val));
  }
}

/**
 * Add an empty custom field row.
 */
export function addCustomRow(): void {
  if (!_customRows) return;
  _customRows.appendChild(createCustomRow('', ''));
}

// ── Internal helpers ──────────────────────────────────────────────────────

function createCustomRow(key: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'custom-row';

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.className = 'meta-input custom-key';
  keyInput.placeholder = 'key';
  keyInput.value = key;

  const valInput = document.createElement('input');
  valInput.type = 'text';
  valInput.className = 'meta-input custom-val';
  valInput.placeholder = 'value';
  valInput.value = value;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-remove-custom';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove custom field';

  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(removeBtn);

  return row;
}

function readCustomRows(): Record<string, string> {
  const custom: Record<string, string> = {};
  if (!_customRows) return custom;

  const rows = _customRows.querySelectorAll('.custom-row');
  for (const row of rows) {
    const keyInput = row.querySelector('.custom-key') as HTMLInputElement | null;
    const valInput = row.querySelector('.custom-val') as HTMLInputElement | null;
    const key = keyInput?.value.trim() ?? '';
    const val = valInput?.value ?? '';
    if (key) {
      custom[key] = val;
    }
  }

  return custom;
}

