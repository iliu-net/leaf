/**
 * dom-ids.ts — Central registry of all DOM element IDs.
 *
 * Every `document.getElementById(...)` call across the app references
 * these constants so that IDs are never duplicated or misspelled.
 *
 * Also exports the canonical DOM access helpers:
 *   $(id)     — mandatory access, throws if missing
 *   $maybe(id) — optional access, returns null if absent
 */

// ── Centred DOM access ─────────────────────────────────────────────────────

/**
 * Get a mandatory DOM element by its ID constant.
 *
 * Throws a descriptive error if the element is missing from the DOM.
 * Use for elements that MUST exist (app shell, required panels, etc.).
 */
export function $(id: DomId): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Required DOM element #${id} not found`);
  return el;
}

/**
 * Get an optional DOM element by its ID constant.
 *
 * Returns null if the element is not present in the current DOM.
 * Use for elements that may or may not exist (conditional UI,
 * mode-specific chrome, etc.).
 */
export function $maybe(id: DomId): HTMLElement | null {
  return document.getElementById(id);
}

// ── ID registry ────────────────────────────────────────────────────────────

export const DOM = {
  // ── App shell ───────────────────────────────────────────────────────────
  APP: 'app',

  // ── Login ───────────────────────────────────────────────────────────────
  LOGIN_SCREEN:     'login-screen',
  LOGIN_FORM:       'login-form',
  LOGIN_USERNAME:   'login-username',
  LOGIN_PASSWORD:   'login-password',
  LOGIN_BTN:        'login-btn',
  LOGIN_ERROR:      'login-error',
  LOGIN_CLOSE:      'login-close',
  USERNAME_DISPLAY: 'username-display',
  BTN_LOGOUT:       'btn-logout',
  BTN_SIGNIN:       'btn-signin',

  // ── Header / menu ──────────────────────────────────────────────────────
  HEADER_BRAND:    'header-brand',
  BTN_MENU:        'btn-menu',
  MENU_RESET_DB:   'menu-reset-db',
  MENU_FOLDER:     'menu-folder',
  MENU_TAGS:       'menu-tags',
  MENU_TRASH:      'menu-trash',
  BTN_VIEW_HISTORY: 'btn-view-history',

  // ── Toolbar ─────────────────────────────────────────────────────────────
  BTN_BACK:            'btn-back',
  BTN_NEW:             'btn-new',
  BTN_SAVE:            'btn-save',
  BTN_TOGGLE_SIDEBAR:  'btn-toggle-sidebar',
  DIRTY_DOT:           'dirty-dot',
  CURRENT_FILE:        'current-file',

  // ── Status bar ──────────────────────────────────────────────────────────
  STATUS_MSG:      'status-msg',
  OFFLINE_BADGE:   'offline-badge',
  TOAST_CONTAINER: 'toast-container',
  SYNC_STATUS:     'sync-status',
  BTN_COOKMODE:    'btn-cookmode',

  // ── Sidebar ─────────────────────────────────────────────────────────────
  SIDEBAR:          'sidebar',
  SIDEBAR_RESIZER:  'sidebar-resizer',
  FILE_LIST:        'file-list',
  SEARCH:           'search',
  SIDEBAR_LOADING:  'sidebar-loading',
  SIDEBAR_TOOLBAR:  'sidebar-toolbar',
  SIDEBAR_FOOTER:   'sidebar-footer',
  TRASH_TOOLBAR:    'trash-toolbar',
  TRASH_FOOTER:     'trash-footer',
  TRASH_SEARCH:     'trash-search',
  TRASH_ITEM_COUNT: 'trash-item-count',
  NOTE_COUNT:       'note-count',

  // ── Editor area ─────────────────────────────────────────────────────────
  NOTE_AREA:    'note-area',
  EDITOR_TABS:  'editor-tabs',
  HEADER_CENTER:       'header-center',
  MOBILE_TAB_DROPDOWN: 'mobile-tab-dropdown',
  TAB_BTN_VIEW: 'tab-btn-view',
  TAB_BTN_CODE: 'tab-btn-code',
  TAB_BTN_RAW:  'tab-btn-raw',
  TAB_BTN_META: 'tab-btn-meta',
  TAB_VIEW:     'tab-view',
  TAB_CODE:     'tab-code',
  CODE_TITLE:   'code-title',
  TAB_RAW:      'tab-raw',
  TAB_META:     'tab-meta',
  EMPTY_STATE:  'empty-state',

  // ── Meta tab ────────────────────────────────────────────────────────────
  META_TITLE:          'meta-title',
  META_SUMMARY:        'meta-summary',
  META_TAGS:           'meta-tags',
  META_CUSTOM_ROWS:    'meta-custom-rows',
  META_STATS:          'meta-stats',
  META_SYS_CURRENT:    'meta-sys-current',
  META_SYS_CREATED:    'meta-sys-created',
  META_SYS_UPDATED:    'meta-sys-updated',
  META_SYS_EDIT_TIME:  'meta-sys-edit-time',
  BTN_ADD_CUSTOM:      'btn-add-custom',
  BTN_ADD_LANG:        'btn-add-lang',

  // ── Modal ───────────────────────────────────────────────────────────────
  MODAL_OVERLAY: 'modal-overlay',
  MODAL_TITLE:   'modal-title',
  MODAL_INPUT:   'modal-input',
  MODAL_HINT:    'modal-hint',
  MODAL_CREATE:  'modal-create',
  MODAL_CANCEL:  'modal-cancel',

  // ── Datalists ────────────────────────────────────────────────────────────
  LANG_LIST:   'lang-list',
  KNOWN_KEYS:  'known-keys',

  // ── Context menu ────────────────────────────────────────────────────────
  CONTEXT_MENU: 'context-menu',

  // ── Trash preview banner ────────────────────────────────────────────────
  TRASH_BANNER:         'trash-banner',
  TRASH_BANNER_BODY:    'trash-banner-body',
  TRASH_BANNER_TITLE:   'trash-banner-title',
  TRASH_BANNER_RESTORE: 'trash-banner-restore',
  TRASH_BANNER_PURGE:   'trash-banner-purge',

  // ── System notes ─────────────────────────────────────────────────────────
  SYSTEM_NOTES_SECTION: 'system-notes-section',
  SYSTEM_NOTES_LIST:    'system-notes-list',

  // ── Empty trash button ──────────────────────────────────────────────────
  BTN_EMPTY_TRASH: 'btn-empty-trash',

  // ── Image editor modal ──────────────────────────────────────────────────
  IMG_EDITOR_OVERLAY:    'img-editor-overlay',
  IMG_EDITOR_CANVAS:     'img-editor-canvas',
  IMG_EDITOR_SLIDER:     'img-editor-slider',
  IMG_EDITOR_SLIDER_VAL: 'img-editor-slider-val',
  IMG_EDITOR_OUTPUT_DIMS:'img-editor-output-dims',
  IMG_EDITOR_ORIG_DIMS:  'img-editor-orig-dims',
  IMG_EDITOR_ENCODE:     'img-editor-encode',
  IMG_EDITOR_EST_SIZE:   'img-editor-est-size',
  IMG_EDITOR_INSERT_BTN: 'img-editor-insert',
  IMG_EDITOR_CANCEL_BTN: 'img-editor-cancel',
} as const;

export type DomId = (typeof DOM)[keyof typeof DOM];
