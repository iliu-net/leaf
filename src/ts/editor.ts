/**
 * editor.ts — editor / textarea / meta-panel lifecycle
 *
 * Extracted from ui.ts. Owns all editor state and tab/meta coordination.
 * Communicates outward only via exports — no imports of store.ts.
 */

import * as rawPanel  from './raw-panel.js';
import * as metaPanel from './meta-panel.js';
import {
  parseFrontmatter,
  updateFrontmatter,
  initPendingMeta,
  pendingMetaToUpdates,
  computeStats,
} from './frontmatter.js';
import type { PendingMeta } from './frontmatter.js';
import type { NoteData } from './notes.js';

// ── State ───────────────────────────────────────────────────────────────────

/** ID of the note currently open in the editor (not DOM-dependent). */
let _currentNoteId: string | null = null;

/** Currently active tab: 'raw' or 'meta'. */
let _activeTab: 'raw' | 'meta' = 'raw';

/** Pending meta state (form values before flush to textarea). */
let _pendingMeta: PendingMeta = { title: '', summary: '', tags: [], custom: {} };

/** True when meta edits have been made that haven't been flushed to textarea. */
let _pendingMetaDirty = false;

/**
 * Callback to mark the store as dirty.
 * Set by initPanels() — avoids circular import of store.ts.
 */
let _onDirty: (() => void) | null = null;

// ── DOM refs (local to this module) ─────────────────────────────────────────

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const emptyState  = $('empty-state');
const currentFile = $('current-file');
const dirtyDot    = $('dirty-dot');
const btnSave     = $('btn-save') as HTMLButtonElement;
const editorTabs  = $('editor-tabs');
const tabRaw      = $('tab-raw');
const tabMeta     = $('tab-meta');

// ── Init ────────────────────────────────────────────────────────────────────

/**
 * One-time panel initialisation.
 * @param onDirty  Callback to mark store dirty (called when meta changes occur)
 */
export function initPanels(onDirty: () => void): void {
  _onDirty = onDirty;
  rawPanel.initRawPanel();
  metaPanel.initMetaPanel();

  // Bind panel-level events
  rawPanel.bindRawEvents({
    onInput: () => {
      // textarea input — handled by note-changed listener in app.ts
    },
  });

  metaPanel.bindMetaEvents({
    onFieldChange:        () => handleMetaFieldChange(),
    onAddCustomField:     () => handleAddCustomField(),
    onRemoveCustomField:  (key: string) => handleRemoveCustomField(key),
  });

  // Tab button clicks
  const tabBtnRaw  = document.getElementById('tab-btn-raw');
  const tabBtnMeta = document.getElementById('tab-btn-meta');
  if (tabBtnRaw)  tabBtnRaw.addEventListener('click',  () => switchTab('raw'));
  if (tabBtnMeta) tabBtnMeta.addEventListener('click', () => switchTab('meta'));
}

// ── Editor ──────────────────────────────────────────────────────────────────

export function showEditor(noteData: NoteData): void {
  _currentNoteId = noteData.id;

  // Parse frontmatter for initial pending state
  const fm = parseFrontmatter(noteData.content);
  _pendingMeta = initPendingMeta(fm.meta);
  _pendingMetaDirty = false;

  // Hide empty state, show tab bar
  emptyState.style.display = 'none';
  editorTabs.style.display = 'flex';

  // Show raw tab by default
  _activeTab = 'raw';
  tabRaw.classList.add('active');
  tabMeta.classList.remove('active');
  updateTabButtons();

  // Fill textarea
  rawPanel.showRawPanel(noteData.content);

  // Populate system info fields
  metaPanel.populateSystemFields(noteData);

  // Show note name
  currentFile.innerHTML = `<span class="fname">${noteData.id}</span>`;

  rawPanel.focusRawPanel();
}

export function hideEditor(): void {
  _currentNoteId = null;
  _pendingMeta = { title: '', summary: '', tags: [], custom: {} };
  _pendingMetaDirty = false;

  // Hide panels
  editorTabs.style.display = 'none';
  tabRaw.classList.remove('active');
  tabMeta.classList.remove('active');

  // Clear textarea and meta panel
  rawPanel.hideRawPanel();
  metaPanel.resetMetaPanel();

  // Show empty state
  emptyState.style.display = 'flex';
  currentFile.innerHTML = 'No file selected';
}

/**
 * Get the current editor content, flushing pending meta if on the Meta tab.
 * Use this for saving — it has the side-effect of flushing meta to the textarea.
 */
export function flushAndGetContent(): string {
  if (_activeTab === 'meta' && _pendingMetaDirty) {
    flushPendingMeta();
  }
  return rawPanel.getRawContent();
}

/**
 * Plain read of the textarea value with no side-effects.
 * Use this for diagnostics or when you need the raw value without flushing.
 */
export function getRawContent(): string {
  return rawPanel.getRawContent();
}

/**
 * Programmatic write to the textarea (e.g. from history restore).
 * Publicly exposed for external callers.
 */
export function setRawContent(content: string): void {
  rawPanel.setRawContent(content);
}

export function setDirty(val: boolean): void {
  dirtyDot.classList.toggle('visible', val);
  btnSave.disabled = !val;
}

/** Get the ID of the currently open note. */
export function getCurrentNoteId(): string | null {
  return _currentNoteId;
}

// ── Tab switching ───────────────────────────────────────────────────────────

function switchTab(tab: 'raw' | 'meta'): void {
  if (tab === _activeTab) return;

  if (tab === 'raw') {
    // Meta → Raw: flush pending meta to textarea if dirty
    if (_pendingMetaDirty) {
      flushPendingMeta();
    }
    _activeTab = 'raw';
    tabRaw.classList.add('active');
    tabMeta.classList.remove('active');
    rawPanel.focusRawPanel();
  } else {
    // Raw → Meta: re-parse frontmatter from current textarea
    const raw = rawPanel.getRawContent();
    const fm = parseFrontmatter(raw);
    _pendingMeta = initPendingMeta(fm.meta);
    _pendingMetaDirty = false;

    // Compute stats from body (frontmatter stripped)
    const stats = computeStats(fm.body);

    // Render meta panel
    metaPanel.renderMetaPanel(_pendingMeta, stats);

    _activeTab = 'meta';
    tabRaw.classList.remove('active');
    tabMeta.classList.add('active');
  }

  updateTabButtons();
}

function updateTabButtons(): void {
  const btnRaw  = document.getElementById('tab-btn-raw');
  const btnMeta = document.getElementById('tab-btn-meta');
  if (btnRaw) {
    btnRaw.classList.toggle('active', _activeTab === 'raw');
    btnRaw.setAttribute('aria-selected', String(_activeTab === 'raw'));
  }
  if (btnMeta) {
    btnMeta.classList.toggle('active', _activeTab === 'meta');
    btnMeta.setAttribute('aria-selected', String(_activeTab === 'meta'));
  }
}

// ── Meta panel handlers ────────────────────────────────────────────────────

function handleMetaFieldChange(): void {
  const newValues = metaPanel.getMetaFormValues();
  _pendingMeta = newValues;
  _pendingMetaDirty = true;
  if (_onDirty) _onDirty();
}

function handleAddCustomField(): void {
  metaPanel.addCustomRow();
  handleMetaFieldChange();
}

function handleRemoveCustomField(key: string): void {
  delete _pendingMeta.custom[key];
  metaPanel.renderCustomRows(_pendingMeta.custom);
  _pendingMetaDirty = true;
  if (_onDirty) _onDirty();
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Flush pending meta changes to the textarea and reset dirty flag.
 */
function flushPendingMeta(): void {
  const raw = rawPanel.getRawContent();
  const updates = pendingMetaToUpdates(_pendingMeta);
  const merged = updateFrontmatter(raw, updates);
  rawPanel.setRawContent(merged);
  _pendingMetaDirty = false;
}
