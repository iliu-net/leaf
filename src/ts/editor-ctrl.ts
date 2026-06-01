/**
 * editor-ctrl.ts — editor tab coordinator
 *
 * Owns editor-level state and orchestrates tab panels through the TabPanel
 * interface — same pattern as sidebar.ts uses SidebarView.
 *
 * Communicates outward only via exports — no external state dependencies.
 */

import * as editView  from './edit-view.js';
import * as cmView    from './codemirror-view.js';
import * as metaView  from './meta-view.js';
import * as markdownView from './markdown-view.js';
import type { TabPanel, TabPanelContext } from './tab-panel.js';
import type { NoteData } from './notes.js';
import { DOM, $, $maybe } from './dom-ids.js';
import type { DomId } from './dom-ids.js';
import { esc } from './utils.js';
import { isSystemNote } from './notes.js';

// ── State ───────────────────────────────────────────────────────────────────

let _currentNoteId: string | null = null;
let _noteData: NoteData | null = null;
let _activeTab: string = 'view';
let _cmAvailable = false;

/** Callback to mark editor state as dirty (set by app.ts via initPanels). */
let _onDirty: (() => void) | null = null;

// ── Panel registry ──────────────────────────────────────────────────────────

const panels = new Map<string, TabPanel>();

// ── DOM refs ────────────────────────────────────────────────────────────────

const emptyState  = $(DOM.EMPTY_STATE);
const currentFile = $(DOM.CURRENT_FILE);
const dirtyDot    = $(DOM.DIRTY_DOT);
const editorTabs  = $(DOM.EDITOR_TABS);

const TAB_BTN_MAP: Record<string, DomId> = {
  view: DOM.TAB_BTN_VIEW,
  code: DOM.TAB_BTN_CODE,
  raw:  DOM.TAB_BTN_RAW,
  meta: DOM.TAB_BTN_META,
};

// ── Init ────────────────────────────────────────────────────────────────────

/**
 * One-time panel initialisation.
 * @param onDirty  Callback to mark store dirty (called when meta changes occur)
 */
export function initPanels(onDirty: () => void): void {
  _onDirty = onDirty;

  // ── Edit (Raw) tab — always initialised (textarea is always present) ─
  editView.init();
  editView.bindEvents({
    onInput: () => {
      // textarea input — handled by note-changed listener in app.ts
    },
  });

  // ── Meta tab ────────────────────────────────────────────────────────
  metaView.init();
  metaView.bindEvents({
    onDirty: () => { if (_onDirty) _onDirty(); },
  });
  panels.set('meta', metaView.tabPanel);

  // ── View tab — eager setup, lazy parser (markdown-it loaded on first show) ──
  markdownView.init();
  panels.set('view', markdownView.tabPanel);

  // ── Tab button clicks ───────────────────────────────────────────────
  $maybe(DOM.TAB_BTN_VIEW)?.addEventListener('click', () => switchTab('view'));
  $maybe(DOM.TAB_BTN_CODE)?.addEventListener('click', () => switchTab('code'));
  $maybe(DOM.TAB_BTN_RAW)?.addEventListener('click',  () => switchTab('raw'));
  $maybe(DOM.TAB_BTN_META)?.addEventListener('click', () => switchTab('meta'));

  // ── CodeMirror — lazy load; fall back to raw textarea on failure ─────
  loadCodeMirror();
}

// ── Editor lifecycle ────────────────────────────────────────────────────────

export async function showEditor(noteData: NoteData): Promise<void> {
  _currentNoteId = noteData.id;
  _noteData = noteData;

  // Hide empty state, show tab bar
  emptyState.style.display = 'none';
  editorTabs.style.display = 'flex';

  // Fill textarea (source of truth)
  editView.setContent(noteData.content);

  // Show note name
  currentFile.innerHTML = `<span class="fname">${esc(noteData.id)}</span>`;

  // System notes: VIEW and META only — hide code/raw edit buttons.
  // Only toggle visibility; for user notes the buttons are already correct
  // from loadCodeMirror (init) — no need to touch them here.
  const isSys = isSystemNote(noteData.id);
  updateTabButtonVisibility(isSys);

  // Render the View tab as the default, or switch to edit mode
  // for brand-new (empty) notes so the user can start typing immediately.
  // System notes are always VIEW-only on open.
  _activeTab = 'raw';  // force-switch so switchTab doesn't early-return
  const isEmpty = !noteData.content.trim();
  if (isSys || !isEmpty) {
    await switchTab('view');
  } else {
    await switchTab(_cmAvailable ? 'code' : 'raw');
  }
}

export function hideEditor(): void {
  _currentNoteId = null;
  _noteData = null;

  // Hide all panels
  editorTabs.style.display = 'none';
  for (const panel of panels.values()) panel.hide();
  _hideAllPanelsDom();

  // Show empty state
  emptyState.style.display = 'flex';
  currentFile.innerHTML = 'No file selected';
}

/**
 * Get the current editor content, flushing pending meta if on the Meta tab.
 * Use this for saving — it has the side-effect of flushing meta to the textarea.
 */
export function flushAndGetContent(): string {
  if (_activeTab === 'meta' && metaView.hasPendingChanges()) {
    const raw = editView.getContent();
    const merged = metaView.flushPending(raw);
    editView.setContent(merged);
  }
  // Code tab textarea is kept in sync on every keystroke by
  // codemirror-view.ts's _flushToTextarea — no extra flush needed.
  return editView.getContent();
}

/**
 * Plain read of the textarea value with no side-effects.
 * Use this for diagnostics or when you need the raw value without flushing.
 */
export function getRawContent(): string {
  return editView.getContent();
}

/**
 * Programmatic write to the textarea (e.g. from history restore).
 * Dispatches note-changed so auto-save / dirty tracking picks it up.
 */
export function setRawContent(content: string): void {
  editView.setContent(content);
}

/**
 * Cross-tab content refresh — update the editor in-place without
 * switching tabs, without dispatching note-changed (content came from DB).
 * Preserves cursor position in CodeMirror and pending edits in Meta tab.
 */
export function refreshActiveTab(noteData: NoteData): void {
  _currentNoteId = noteData.id;
  _noteData = noteData;

  // Update textarea silently (no note-changed → no auto-save loop).
  editView.setContentSilent(noteData.content);

  // Refresh the currently active tab panel with new content.
  const panel = panels.get(_activeTab);
  if (panel) {
    const ctx: TabPanelContext = { content: noteData.content, noteData };
    panel.show(ctx);
  }
}

export function setDirty(val: boolean): void {
  dirtyDot.classList.toggle('visible', val);
}

/** Get the ID of the currently open note. */
export function getCurrentNoteId(): string | null {
  return _currentNoteId;
}

/** Whether the currently open note is a system note (CODE/RAW tabs unavailable). */
export function isCurrentNoteSystem(): boolean {
  return _currentNoteId != null && isSystemNote(_currentNoteId);
}

/** Get the currently active tab name. */
export function getActiveTab(): string {
  return _activeTab;
}

/** Whether CodeMirror loaded successfully. */
export function isCmAvailable(): boolean {
  return _cmAvailable;
}

/**
 * Switch to the given editor tab programmatically.
 * Focuses the target panel's primary input after it becomes active.
 */
export async function switchEditorTab(tab: string): Promise<void> {
  await switchTab(tab);
}

/**
 * Re-focus the currently active tab's primary input.
 * Use when already on the target tab and you want to re-focus without a
 * full tab switch (e.g. hitting the same shortcut twice).
 */
export function focusActiveTab(): void {
  const panel = panels.get(_activeTab);
  panel?.focus?.();
}

// ── Tab switching ───────────────────────────────────────────────────────────

async function switchTab(tab: string): Promise<void> {
  if (tab === _activeTab) return;

  // ── Leave current tab ──────────────────────────────────────────────
  // Flush pending meta to textarea if leaving the meta tab.
  if (_activeTab === 'meta' && metaView.hasPendingChanges()) {
    const raw = editView.getContent();
    const merged = metaView.flushPending(raw);
    editView.setContent(merged);
  }

  _activeTab = tab;

  // ── Enter target tab ───────────────────────────────────────────────
  const ctx: TabPanelContext = {
    content: editView.getContent(),
    noteData: _noteData!,
  };

  const panel = panels.get(tab);
  if (panel) {
    _showOnePanelDom(`tab-${tab}`);
    await panel.show(ctx);
    // Focus the primary input so the user can start typing immediately
    // (keyboard shortcut or mouse click → grab focus on entry).
    panel.focus?.();
    _updateTabButtons();
  }
}

// ── CodeMirror lazy-load ────────────────────────────────────────────────────

async function loadCodeMirror(): Promise<void> {
  try {
    const mod = await import('./codemirror/setup.js');
    cmView.init(mod.createEditor);
    cmView.setSearchOpener(mod.openSearchPanelWithQuery);
    cmView.tabPanel.init();
    panels.set('code', cmView.tabPanel);
    _cmAvailable = true;

    // Show code tab button, hide raw tab button
    const btnRaw  = $maybe(DOM.TAB_BTN_RAW);
    const btnCode = $maybe(DOM.TAB_BTN_CODE);
    if (btnRaw)  btnRaw.style.display = 'none';
    if (btnCode) btnCode.style.display = '';
  } catch {
    // CM chunk not in SW cache or load failed → use raw textarea
    panels.set('raw', editView.tabPanel);
    const btnCode = $maybe(DOM.TAB_BTN_CODE);
    if (btnCode) btnCode.style.display = 'none';
  }
}

// ── Internal ────────────────────────────────────────────────────────────────

const TAB_PANEL_IDS = [
  DOM.TAB_VIEW,
  DOM.TAB_CODE,
  DOM.TAB_RAW,
  DOM.TAB_META,
] as const;

function _showOnePanelDom(activeId: string): void {
  for (const id of TAB_PANEL_IDS) {
    const el = $maybe(id);
    if (el) el.classList.toggle('active', id === activeId);
  }
}

function _hideAllPanelsDom(): void {
  for (const id of TAB_PANEL_IDS) {
    const el = $maybe(id);
    if (el) el.classList.remove('active');
  }
}

function _updateTabButtons(): void {
  for (const t of ['view', 'code', 'raw', 'meta'] as const) {
    const btn = $maybe(TAB_BTN_MAP[t]);
    if (btn) {
      btn.classList.toggle('active', _activeTab === t);
      btn.setAttribute('aria-selected', String(_activeTab === t));
    }
  }
}

/**
 * Show/hide CODE and RAW tab buttons.
 *
 * Called with `true` for system notes (VIEW/META only).
 * Called with `false` when switching back to a user note to restore the
 * buttons — safe because CodeMirror has already loaded by then.
 */
function updateTabButtonVisibility(isSystem: boolean): void {
  const btnCode = $maybe(DOM.TAB_BTN_CODE);
  const btnRaw  = $maybe(DOM.TAB_BTN_RAW);
  if (isSystem) {
    if (btnCode) btnCode.style.display = 'none';
    if (btnRaw)  btnRaw.style.display  = 'none';
  } else {
    if (btnCode) btnCode.style.display = _cmAvailable ? '' : 'none';
    if (btnRaw)  btnRaw.style.display  = _cmAvailable ? 'none' : '';
  }
}

