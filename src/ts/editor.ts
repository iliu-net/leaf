/**
 * editor.ts — editor / textarea / meta-panel lifecycle
 *
 * Extracted from ui.ts. Owns all editor state and tab/meta coordination.
 * Communicates outward only via exports — no external state dependencies.
 */

import * as rawPanel  from './raw-panel.js';
import * as metaPanel from './meta-panel.js';
import type { NoteData } from './notes.js';
import {
  parseFrontmatter,
  updateFrontmatter,
  initPendingMeta,
  pendingMetaToUpdates,
} from './frontmatter.js';
import type { PendingMeta } from './frontmatter.js';
import { computeStats } from './utils.js';

// ── State ───────────────────────────────────────────────────────────────────

/** ID of the note currently open in the editor (not DOM-dependent). */
let _currentNoteId: string | null = null;

/**
 * Cached NoteData (IndexedDB record fields) for the currently open note.
 * Needed by the View panel footer (system info) and re-renders on tab switch.
 */
let _noteData: NoteData | null = null;

/** Currently active tab: 'view', 'raw', or 'meta'. */
let _activeTab: 'view' | 'raw' | 'meta' = 'view';

/** Lazy-loaded view-panel module reference. */
let _viewMod: typeof import('./view-panel.js') | null = null;

/** Pending meta state (form values before flush to textarea). */
let _pendingMeta: PendingMeta = { title: '', summary: '', tags: [], custom: {} };

/** True when meta edits have been made that haven't been flushed to textarea. */
let _pendingMetaDirty = false;

/**
 * Callback to mark editor state as dirty (set by app.ts via initPanels).
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
  const tabBtnView = document.getElementById('tab-btn-view');
  const tabBtnRaw  = document.getElementById('tab-btn-raw');
  const tabBtnMeta = document.getElementById('tab-btn-meta');
  if (tabBtnView) tabBtnView.addEventListener('click', () => switchTab('view'));
  if (tabBtnRaw)  tabBtnRaw.addEventListener('click',  () => switchTab('raw'));
  if (tabBtnMeta) tabBtnMeta.addEventListener('click', () => switchTab('meta'));
}

// ── Editor ──────────────────────────────────────────────────────────────────

export async function showEditor(noteData: NoteData): Promise<void> {
  _currentNoteId = noteData.id;
  _noteData = noteData;

  // Parse frontmatter for initial pending state
  const fm = parseFrontmatter(noteData.content);
  _pendingMeta = initPendingMeta(fm.meta);
  _pendingMetaDirty = false;

  // Hide empty state, show tab bar
  emptyState.style.display = 'none';
  editorTabs.style.display = 'flex';

  // Fill textarea (raw panel is the source of truth)
  rawPanel.showRawPanel(noteData.content);

  // Populate system info fields
  metaPanel.populateSystemFields(noteData);

  // Show note name
  currentFile.innerHTML = `<span class="fname">${noteData.id}</span>`;

  // Render the View tab as the default.  Set _activeTab to a non-'view'
  // value so switchTab('view') doesn't early-return on subsequent calls
  // (the module-level default is already 'view').
  _activeTab = 'raw';
  await switchTab('view');
}

export function hideEditor(): void {
  _currentNoteId = null;
  _noteData = null;
  _pendingMeta = { title: '', summary: '', tags: [], custom: {} };
  _pendingMetaDirty = false;

  // Hide panels
  editorTabs.style.display = 'none';
  const tabView = document.getElementById('tab-view');
  if (tabView) tabView.classList.remove('active');
  tabRaw.classList.remove('active');
  tabMeta.classList.remove('active');

  // Clear textarea, meta panel, and view panel
  rawPanel.hideRawPanel();
  metaPanel.resetMetaPanel();
  if (_viewMod) _viewMod.hideViewPanel();

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

async function switchTab(tab: 'view' | 'raw' | 'meta'): Promise<void> {
  if (tab === _activeTab) return;

  // ── Leave current tab ──────────────────────────────────────────────
  // Only Meta can hold unflushed state — flush it to the textarea.
  if (_activeTab === 'meta' && _pendingMetaDirty) {
    flushPendingMeta();
  }

  const prev = _activeTab;
  _activeTab = tab;

  // ── Enter target tab ───────────────────────────────────────────────

  if (tab === 'raw') {
    // View/Raw → Raw: show textarea, focus it
    showPanel('tab-raw');
    rawPanel.focusRawPanel();

  } else if (tab === 'meta') {
    // Re-parse frontmatter from current textarea
    const raw = rawPanel.getRawContent();
    const fm = parseFrontmatter(raw);
    _pendingMeta = initPendingMeta(fm.meta);
    _pendingMetaDirty = false;

    // Compute stats from body (frontmatter stripped)
    const stats = computeStats(fm.body);

    // Render meta panel
    metaPanel.renderMetaPanel(_pendingMeta, stats);

    showPanel('tab-meta');

  } else if (tab === 'view') {
    // Lazy-load the view-panel module on first use
    if (!_viewMod) {
      _viewMod = await import('./view-panel.js');
      _viewMod.initViewPanel();
    }

    // Re-parse from current textarea and render
    const raw = rawPanel.getRawContent();
    if (_noteData) {
      _viewMod.showViewPanel(raw, _noteData);
    }

    showPanel('tab-view');
  }

  updateTabButtons();
}

/** Show one tab panel, hide the others. */
function showPanel(activeId: string): void {
  const panels = ['tab-view', 'tab-raw', 'tab-meta'];
  for (const id of panels) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', id === activeId);
  }
}

function updateTabButtons(): void {
  for (const t of ['view', 'raw', 'meta'] as const) {
    const btn = document.getElementById(`tab-btn-${t}`);
    if (btn) {
      btn.classList.toggle('active', _activeTab === t);
      btn.setAttribute('aria-selected', String(_activeTab === t));
    }
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
