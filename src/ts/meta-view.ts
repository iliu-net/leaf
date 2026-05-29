/**
 * meta-view.ts — structured metadata editor tab
 *
 * Owns all meta-tab DOM and pending form state.
 * Implements TabPanel so editor-ctrl.ts treats it uniformly.
 */

import type { NoteData } from './notes.js';
import type { PendingMeta } from './frontmatter.js';
import type { TabPanel, TabPanelContext } from './tab-panel.js';
import { DOM, $maybe } from './dom-ids.js';
import {
  parseFrontmatter,
  initPendingMeta,
  pendingMetaToUpdates,
  updateFrontmatter,
} from './frontmatter.js';
import { computeStats, formatTimestamp } from './utils.js';
import { getSpellcheckConfig } from './config.js';

// ── Known custom-field keys with value placeholder hints ─────────────────────

/** Common frontmatter keys inspired by Word document properties. */
const KNOWN_KEYS: Record<string, string> = {
  category: 'e.g. report, invoice, quote',
  comments: 'e.g. review notes, follow-up needed',
  company:  'e.g. Acme Corp, Widgets Inc',
  manager:  'e.g. John Smith',
  status:   'e.g. draft, final, withdrawn',
};

/** Handlers for meta-view events. */
export interface MetaEventHandlers {
  onDirty: () => void;
}

// ── State ──────────────────────────────────────────────────────────────

/** Pending form state — not yet flushed to the textarea. */
let _pendingMeta: PendingMeta = { title: '', summary: '', tags: [], custom: {} };
let _pendingMetaDirty = false;

// ── DOM refs ────────────────────────────────────────────────────────────

let _metaTitle:   HTMLInputElement | null = null;
let _metaSummary: HTMLTextAreaElement | null = null;
let _metaTags:    HTMLInputElement | null = null;
let _customRows:  HTMLElement | null = null;
let _metaStats:   HTMLElement | null = null;

// Language — button + datalist only (row lives inside _customRows)
let _btnAddLang:   HTMLButtonElement | null = null;
let _langListData: HTMLDataListElement | null = null;

let _sysCurrent:  HTMLElement | null = null;
let _sysCreated:  HTMLElement | null = null;
let _sysUpdated:  HTMLElement | null = null;

// ── Init (TabPanel) ────────────────────────────────────────────────────

/** One-time setup: cache DOM refs, populate language datalist. */
export function init(): void {
  _metaTitle   = $maybe(DOM.META_TITLE)     as HTMLInputElement | null;
  _metaSummary = $maybe(DOM.META_SUMMARY)   as HTMLTextAreaElement | null;
  _metaTags    = $maybe(DOM.META_TAGS)      as HTMLInputElement | null;
  _customRows  = $maybe(DOM.META_CUSTOM_ROWS);
  _metaStats   = $maybe(DOM.META_STATS);

  // Language
  _btnAddLang   = $maybe(DOM.BTN_ADD_LANG)  as HTMLButtonElement | null;
  _langListData = $maybe(DOM.LANG_LIST)     as HTMLDataListElement | null;

  // Populate language datalist from SpaConfig
  _populateLangDatalist();

  _sysCurrent   = $maybe(DOM.META_SYS_CURRENT);
  _sysCreated   = $maybe(DOM.META_SYS_CREATED);
  _sysUpdated   = $maybe(DOM.META_SYS_UPDATED);
}

// ── TabPanel lifecycle ─────────────────────────────────────────────────

/** Show the meta panel: parse frontmatter from raw content, render form. */
export function show(ctx: TabPanelContext): void {
  const fm = parseFrontmatter(ctx.content);
  _pendingMeta = initPendingMeta(fm.meta);
  _pendingMetaDirty = false;

  _renderForm(_pendingMeta);

  // Stats (body only, frontmatter stripped)
  const stats = computeStats(fm.body);
  if (_metaStats) {
    _metaStats.textContent = stats
      ? `${stats.chars.toLocaleString()} chars · ${stats.words.toLocaleString()} words · ${stats.lines} lines`
      : '';
  }

  // Refresh language datalist in case SpaConfig was fetched after init()
  _populateLangDatalist();

  _populateSystemFields(ctx.noteData);
}

/** Clear the meta panel. */
export function hide(): void {
  if (_metaTitle)   _metaTitle.value   = '';
  if (_metaSummary) _metaSummary.value = '';
  if (_metaTags)    _metaTags.value    = '';
  if (_customRows)  _customRows.innerHTML = '';
  if (_metaStats)   _metaStats.textContent = '';
  // Restore the [+ Language] button (row was cleared with _customRows above)
  if (_btnAddLang) _btnAddLang.style.display = '';

  if (_sysCurrent) _sysCurrent.textContent = '';
  if (_sysCreated) _sysCreated.textContent = '';
  if (_sysUpdated) _sysUpdated.textContent = '';
}

// ── Pending meta ────────────────────────────────────────────────────────

/** Whether the form has unflushed changes. */
export function hasPendingChanges(): boolean {
  return _pendingMetaDirty;
}

/**
 * Flush pending meta changes into raw content.
 * @returns Merged content with pending meta applied.
 */
export function flushPending(rawContent: string): string {
  const updates = pendingMetaToUpdates(_pendingMeta);
  const merged = updateFrontmatter(rawContent, updates);
  _pendingMetaDirty = false;
  return merged;
}

// ── Event binding ───────────────────────────────────────────────────────

/**
 * Wire meta panel events to the onDirty callback.
 */
export function bindEvents(handlers: MetaEventHandlers): void {
  // Standard fields
  for (const id of [DOM.META_TITLE, DOM.META_SUMMARY, DOM.META_TAGS]) {
    const el = $maybe(id);
    if (el) el.addEventListener('input', () => _onFieldChange(handlers.onDirty));
  }

  // Language — add a lang row to the custom-rows container
  if (_btnAddLang) {
    _btnAddLang.addEventListener('click', () => {
      _addLangRow();
      _onFieldChange(handlers.onDirty);
    });
  }

  // Add custom field button
  const btnAdd = $maybe(DOM.BTN_ADD_CUSTOM);
  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      _addEmptyRow();
      _onFieldChange(handlers.onDirty);
    });
  }

  // Remove buttons (delegated) — handles both custom and lang rows
  if (_customRows) {
    _customRows.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const removeBtn = target.closest('.btn-remove-custom');
      if (!removeBtn) return;

      const row = removeBtn.closest('.custom-row') as HTMLElement | null;
      if (!row) return;

      // Lang row — just remove it and show the [+ Language] button
      if (row.classList.contains('custom-row-lang')) {
        row.remove();
        if (_btnAddLang) _btnAddLang.style.display = '';
        _pendingMeta.lang = undefined;
        _pendingMetaDirty = true;
        handlers.onDirty();
        return;
      }

      // Regular custom row
      const keyInput = row.querySelector('.custom-key') as HTMLInputElement | null;
      const key = keyInput?.value ?? '';
      delete _pendingMeta.custom[key];
      _renderCustomRows(_pendingMeta.custom, _readLangRow());
      _pendingMetaDirty = true;
      handlers.onDirty();
    });

    // Custom field input changes (dirty tracking + key→placeholder hints)
    _customRows.addEventListener('input', (e: Event) => {
      _onFieldChange(handlers.onDirty);
      // Update value placeholder when key changes (lang rows are read-only, skip)
      const target = e.target as HTMLElement;
      if (target.classList.contains('custom-key') && !(target as HTMLInputElement).readOnly) {
        _updateValuePlaceholder(target);
      }
    });
  }
}

// ── Custom field management ─────────────────────────────────────────────

export function renderCustomRows(custom: Record<string, string>, lang?: string): void {
  _renderCustomRows(custom, lang);
}

// ── Internal ────────────────────────────────────────────────────────────

function _onFieldChange(onDirty: () => void): void {
  _pendingMeta = _readFormValues();
  _pendingMetaDirty = true;
  onDirty();
}

function _renderForm(pm: PendingMeta): void {
  if (_metaTitle)   _metaTitle.value   = pm.title;
  if (_metaSummary) _metaSummary.value = pm.summary;
  if (_metaTags)    _metaTags.value    = pm.tags.join(', ');
  _renderCustomRows(pm.custom, pm.lang);
}

function _renderCustomRows(custom: Record<string, string>, lang?: string): void {
  if (!_customRows) return;
  _customRows.innerHTML = '';
  for (const [key, val] of Object.entries(custom)) {
    _customRows.appendChild(_createCustomRow(key, val));
  }
  // Append language row at the bottom if set
  if (lang) {
    _customRows.appendChild(_createLangRow(lang));
    if (_btnAddLang) _btnAddLang.style.display = 'none';
  } else {
    if (_btnAddLang) _btnAddLang.style.display = '';
  }
}

function _addEmptyRow(): void {
  if (!_customRows) return;
  _customRows.appendChild(_createCustomRow('', ''));
}

/**
 * Add a language row to the custom-rows container.
 * The key is read-only "lang"; the value uses the language datalist.
 */
function _addLangRow(): void {
  if (!_customRows) return;
  // Remove any existing lang row first (shouldn't happen, but be safe)
  const existing = _customRows.querySelector('.custom-row-lang');
  if (existing) existing.remove();
  _customRows.appendChild(_createLangRow(''));
  if (_btnAddLang) _btnAddLang.style.display = 'none';
  // Focus the value input
  const valInput = _customRows.querySelector('.custom-row-lang .custom-val') as HTMLInputElement | null;
  valInput?.focus();
}

function _readFormValues(): PendingMeta {
  const title   = _metaTitle?.value   ?? '';
  const summary = _metaSummary?.value ?? '';
  const tagsRaw = _metaTags?.value    ?? '';
  const tags    = tagsRaw.split(',').map(s => s.trim()).filter(Boolean);
  const custom  = _readCustomRows();   // excludes the lang row
  const lang    = _readLangRow();      // reads the lang row separately

  return { title, summary, tags, custom, lang };
}

function _populateSystemFields(noteData: NoteData): void {
  if (_sysCurrent) _sysCurrent.textContent = noteData.current ?? '';

  // Merge timestamp + author into single field (same pattern as render-fm.ts)
  if (_sysCreated && (noteData.created_at || noteData.created_by)) {
    const parts: string[] = [];
    if (noteData.created_at) parts.push(formatTimestamp(noteData.created_at));
    if (noteData.created_by) parts.push(`by ${noteData.created_by}`);
    _sysCreated.textContent = parts.join(' ');
  } else if (_sysCreated) {
    _sysCreated.textContent = '';
  }

  if (_sysUpdated && (noteData.updated_at || noteData.updated_by)) {
    const parts: string[] = [];
    if (noteData.updated_at) parts.push(formatTimestamp(noteData.updated_at));
    if (noteData.updated_by) parts.push(`by ${noteData.updated_by}`);
    _sysUpdated.textContent = parts.join(' ');
  } else if (_sysUpdated) {
    _sysUpdated.textContent = '';
  }
}

function _createCustomRow(key: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'custom-row';

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.className = 'meta-input custom-key';
  keyInput.placeholder = 'key';
  keyInput.value = key;
  keyInput.setAttribute('list', 'known-keys');
  keyInput.setAttribute('autocomplete', 'off');
  keyInput.setAttribute('spellcheck', 'false');

  const valInput = document.createElement('input');
  valInput.type = 'text';
  valInput.className = 'meta-input custom-val';
  valInput.placeholder = KNOWN_KEYS[key] || 'value';
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

/** Create a language row with read-only "lang" key. */
function _createLangRow(lang: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'custom-row custom-row-lang';

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.className = 'meta-input custom-key';
  keyInput.value = 'lang';
  keyInput.readOnly = true;
  keyInput.setAttribute('tabindex', '-1');
  keyInput.setAttribute('autocomplete', 'off');
  keyInput.setAttribute('spellcheck', 'false');

  const valInput = document.createElement('input');
  valInput.type = 'text';
  valInput.className = 'meta-input custom-val';
  valInput.setAttribute('list', 'lang-list');
  valInput.setAttribute('autocomplete', 'off');
  valInput.setAttribute('spellcheck', 'false');
  valInput.placeholder = getSpellcheckConfig().default_lang;
  valInput.value = lang;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-remove-custom';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove language';

  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(removeBtn);

  return row;
}

function _readCustomRows(): Record<string, string> {
  const custom: Record<string, string> = {};
  if (!_customRows) return custom;

  // Skip the language row — it's handled separately by _readLangRow
  const rows = _customRows.querySelectorAll('.custom-row:not(.custom-row-lang)');
  for (const row of rows) {
    const keyInput = row.querySelector('.custom-key') as HTMLInputElement | null;
    const valInput = row.querySelector('.custom-val') as HTMLInputElement | null;
    const key = keyInput?.value.trim() ?? '';
    const val = valInput?.value ?? '';
    if (key) custom[key] = val;
  }

  return custom;
}

/** Read the language value from the dedicated lang row, if present. */
function _readLangRow(): string | undefined {
  if (!_customRows) return undefined;
  const langRow = _customRows.querySelector('.custom-row-lang');
  if (!langRow) return undefined;
  const valInput = langRow.querySelector('.custom-val') as HTMLInputElement | null;
  const val = valInput?.value.trim();
  return val || undefined;
}

// ── Language row helpers ─────────────────────────────────────────────────

/** Populate the lang-list datalist from SpaConfig.spellcheck.preferred_langs. */
function _populateLangDatalist(): void {
  if (!_langListData) return;
  const cfg = getSpellcheckConfig();
  const langs = cfg.preferred_langs;
  _langListData.innerHTML = langs
    .map(l => `<option value="${l}">${l} — ${_langDisplayName(l)}</option>`)
    .join('');
}

/** Show a human-readable label for a BCP 47 tag (uses Intl if available). */
function _langDisplayName(tag: string): string {
  try {
    const dn = new Intl.DisplayNames([tag], { type: 'language' });
    return dn.of(tag) ?? tag;
  } catch {
    return tag;
  }
}

// ── Custom-field key hints ──────────────────────────────────────────────

/**
 * When the user types or selects a known key, update the adjacent
 * value input's placeholder with a contextual hint.
 */
function _updateValuePlaceholder(keyInput: HTMLElement): void {
  const row = keyInput.closest('.custom-row');
  if (!row) return;
  const valInput = row.querySelector('.custom-val') as HTMLInputElement | null;
  if (!valInput) return;
  const key = (keyInput as HTMLInputElement).value.trim().toLowerCase();
  valInput.placeholder = KNOWN_KEYS[key] || 'value';
}

/** TabPanel contract — typed lens for editor-ctrl.ts registration. */
export const tabPanel: TabPanel = { init, show, hide };

