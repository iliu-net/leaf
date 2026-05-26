/**
 * store.ts — application state
 *
 * A minimal reactive store using a simple event emitter.
 * Components subscribe to state changes via store.on(event, handler).
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface NoteMeta {
  id: string;
  created_at: number;
  updated_at: number;
  current: string;
}

interface AppState {
  notes: NoteMeta[];
  filtered: NoteMeta[];
  current: string | null;
  content: string;
  dirty: boolean;
  query: string;
  online: boolean;
}

type Listener = (data: unknown) => void;

// ── Event emitter ────────────────────────────────────────────────────────

const listeners: Record<string, Listener[]> = {};

function emit(event: string, data?: unknown): void {
  (listeners[event] ?? []).forEach(fn => fn(data));
}

/** Subscribe to a state event. Returns an unsubscribe function. */
export function on(event: string, fn: Listener): () => void {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(fn);
  return () => { listeners[event] = listeners[event].filter(f => f !== fn); };
}

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────

const state: AppState = {
  // notes: array of objects from server — [{id, created_at, updated_at, current}]
  notes:    [],
  filtered: [],
  current:  null,    // string | null — open note id
  content:  '',      // string — full raw textarea content (includes frontmatter)
  dirty:    false,
  query:    '',      // search query — matched against note id only
  online:   navigator.onLine,
};

// ── Getters ──
export const getState   = (): AppState => ({ ...state });
export const getNotes   = (): NoteMeta[] => state.filtered;
export const getCurrent = (): string | null => state.current;
export const getContent = (): string => state.content;
export const isDirty    = (): boolean => state.dirty;
export const isOnline   = (): boolean => state.online;

// ── Mutations ──

/** Replace the full note list (array of server objects). */
export function setNotes(notes: NoteMeta[]): void {
  state.notes = notes;
  applyFilter();
}

export function setQuery(q: string): void {
  state.query = q.toLowerCase().trim();
  applyFilter();
}

function applyFilter(): void {
  // Search matches against note id (filename) only — kept simple intentionally
  state.filtered = state.query
    ? state.notes.filter(n => n.id.toLowerCase().includes(state.query))
    : [...state.notes];
  emit('notes-changed', state.filtered);
  emit('count-changed', { total: state.notes.length, shown: state.filtered.length });
}

export function openNote(id: string, content: string): void {
  state.current = id;
  state.content = content;
  state.dirty   = false;
  emit('note-opened', { id, content });
  emit('dirty-changed', false);
}

export function updateContent(content: string): void {
  state.content = content;
  // Only mark dirty if a note is actually open — browser form restoration can
  // fire extraneous input events on the hidden textarea after page load,
  // which would otherwise falsely enable the Save button and trigger an
  // unsaved-changes warning on navigation.
  if (state.current === null) return;
  if (!state.dirty) {
    state.dirty = true;
    emit('dirty-changed', true);
  }
}

export function markClean(): void {
  state.dirty = false;
  emit('dirty-changed', false);
}

export function closeNote(): void {
  state.current = null;
  state.content = '';
  state.dirty   = false;
  emit('note-closed');
  emit('dirty-changed', false);
}

export function setOnline(val: boolean): void {
  state.online = val;
  emit('online-changed', val);
}

// ── Online/offline tracking ──
window.addEventListener('online',  () => setOnline(true));
window.addEventListener('offline', () => setOnline(false));
