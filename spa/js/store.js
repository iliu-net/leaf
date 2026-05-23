/**
 * store.js — application state
 *
 * A minimal reactive store using a simple event emitter.
 * Components subscribe to state changes via store.on(event, handler).
 */

const listeners = {};

function emit(event, data) {
  (listeners[event] ?? []).forEach(fn => fn(data));
}

/** Subscribe to a state event. Returns an unsubscribe function. */
export function on(event, fn) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(fn);
  return () => { listeners[event] = listeners[event].filter(f => f !== fn); };
}

// ─────────────────────────────────────────────
// Frontmatter parser
//
// Parses YAML-lite frontmatter from note content:
//   ---
//   title: My note
//   path: work/meetings/standup
//   tags: [work, meetings]
//   created: 2025-05-20
//   ---
//   Body text...
//
// Returns { meta: {title, path, tags, created, ...}, body: string }
// If no frontmatter block is present, returns { meta: {}, body: rawContent }
// ─────────────────────────────────────────────
export function parseFrontmatter(raw) {
  if (typeof raw !== 'string') return { meta: {}, body: '' };

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    const trimmed = val.trim();
    // Parse inline arrays:  [one, two, three]
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      meta[key] = trimmed
        .slice(1, -1)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    } else {
      meta[key] = trimmed;
    }
  }

  return { meta, body: match[2] };
}

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────

const state = {
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
export const getState   = () => ({ ...state });
export const getNotes   = () => state.filtered;
export const getCurrent = () => state.current;
export const getContent = () => state.content;
export const isDirty    = () => state.dirty;
export const isOnline   = () => state.online;

// ── Mutations ──

/** Replace the full note list (array of server objects). */
export function setNotes(notes) {
  state.notes = notes;
  applyFilter();
}

export function setQuery(q) {
  state.query = q.toLowerCase().trim();
  applyFilter();
}

function applyFilter() {
  // Search matches against note id (filename) only — kept simple intentionally
  state.filtered = state.query
    ? state.notes.filter(n => n.id.toLowerCase().includes(state.query))
    : [...state.notes];
  emit('notes-changed', state.filtered);
  emit('count-changed', { total: state.notes.length, shown: state.filtered.length });
}

export function openNote(id, content) {
  state.current = id;
  state.content = content;
  state.dirty   = false;
  emit('note-opened', { id, content });
  emit('dirty-changed', false);
}

export function updateContent(content) {
  state.content = content;
  if (!state.dirty) {
    state.dirty = true;
    emit('dirty-changed', true);
  }
}

export function markClean() {
  state.dirty = false;
  emit('dirty-changed', false);
}

export function closeNote() {
  state.current = null;
  state.content = '';
  state.dirty   = false;
  emit('note-closed');
  emit('dirty-changed', false);
}

export function setOnline(val) {
  state.online = val;
  emit('online-changed', val);
}

// ── Online/offline tracking ──
window.addEventListener('online',  () => setOnline(true));
window.addEventListener('offline', () => setOnline(false));
