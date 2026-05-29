/**
 * editor-ctrl.ts — editor tab coordinator
 *
 * Owns editor-level state and orchestrates tab panels through the TabPanel
 * interface — same pattern as sidebar.ts uses SidebarView.
 *
 * Communicates outward only via exports — no external state dependencies.
 */

import * as editView  from './edit-view.js';
import * as metaView  from './meta-view.js';
import * as markdownView from './markdown-view.js';
import type { TabPanel, TabPanelContext } from './tab-panel.js';
import type { NoteData } from './notes.js';
import { DOM, $, $maybe } from './dom-ids.js';
import { esc } from './utils.js';

// ── State ───────────────────────────────────────────────────────────────────

let _currentNoteId: string | null = null;
let _noteData: NoteData | null = null;
let _activeTab: string = 'view';

/** Callback to mark editor state as dirty (set by app.ts via initPanels). */
let _onDirty: (() => void) | null = null;

// ── Panel registry ──────────────────────────────────────────────────────────

const panels = new Map<string, TabPanel>();

// ── DOM refs ────────────────────────────────────────────────────────────────

const emptyState  = $(DOM.EMPTY_STATE);
const currentFile = $(DOM.CURRENT_FILE);
const dirtyDot    = $(DOM.DIRTY_DOT);
const btnSave     = $(DOM.BTN_SAVE) as HTMLButtonElement;
const editorTabs  = $(DOM.EDITOR_TABS);

// ── Init ────────────────────────────────────────────────────────────────────

/**
 * One-time panel initialisation.
 * @param onDirty  Callback to mark store dirty (called when meta changes occur)
 */
export function initPanels(onDirty: () => void): void {
  _onDirty = onDirty;

  // ── Edit (Raw) tab ──────────────────────────────────────────────────
  editView.init();
  editView.bindEvents({
    onInput: () => {
      // textarea input — handled by note-changed listener in app.ts
    },
  });
  panels.set('raw', editView.tabPanel);

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
  $maybe(DOM.TAB_BTN_RAW)?.addEventListener('click',  () => switchTab('raw'));
  $maybe(DOM.TAB_BTN_META)?.addEventListener('click', () => switchTab('meta'));
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

  // Render the View tab as the default.
  _activeTab = 'raw';  // force-switch so switchTab('view') doesn't early-return
  await switchTab('view');
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
 * Publicly exposed for external callers.
 */
export function setRawContent(content: string): void {
  editView.setContent(content);
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
    _updateTabButtons();
  }
}

// ── Internal ────────────────────────────────────────────────────────────────

const TAB_PANEL_IDS = [DOM.TAB_VIEW, DOM.TAB_RAW, DOM.TAB_META] as const;

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
  for (const t of ['view', 'raw', 'meta'] as const) {
    const btnId = t === 'view' ? DOM.TAB_BTN_VIEW : t === 'raw' ? DOM.TAB_BTN_RAW : DOM.TAB_BTN_META;
    const btn = $maybe(btnId);
    if (btn) {
      btn.classList.toggle('active', _activeTab === t);
      btn.setAttribute('aria-selected', String(_activeTab === t));
    }
  }
}
