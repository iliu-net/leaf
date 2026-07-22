/**
 * AppContext.tsx — Single React Context + useReducer for all application state.
 *
 * Design:
 *   - StateContext holds the full AppState (read-only for components).
 *   - DispatchContext holds the stable dispatch function (never re-renders
 *     consumers that only dispatch actions, e.g. buttons, keyboard handlers).
 *   - Data mutations still call the existing data layer (notes.ts, auth.ts,
 *     etc.) directly.  The reducer updates React state after the DB call
 *     completes.
 *   - change-bus subscription syncs state when other tabs or remote sync
 *     change data.
 */

import {
  type Dispatch,
  createContext,
  useContext,
  useReducer,
  type ReactNode,
} from 'react';
import type { NoteMeta, NoteData } from '../notes.js';
import type { TrashEntry } from '../trash.js';

/* ── Toast ────────────────────────────────────────────────────────────── */

export interface Toast {
  id: string;
  message: string;
  isError?: boolean;
}

/* ── State ─────────────────────────────────────────────────────────────── */

export interface AppState {
  /* Notes (sidebar + active note) */
  notes: NoteMeta[];
  activeNoteId: string | null;
  activeNoteContent: string | null;
  /** Extra metadata (timestamps, frontmatter) for ViewTab rendering. */
  activeNoteData: Omit<NoteData, 'id' | 'content'> | null;
  activeTab: 'view' | 'code' | 'meta';
  isDirty: boolean;
  isSystemNote: boolean;

  /* Auth */
  auth: {
    username: string | null;
    showLogin: boolean;
  };

  /* Trash */
  trash: TrashEntry[];
  trashPreview: {
    id: string;
    content: string;
    source: 'local' | 'server';
    meta: {
      created_at?: number;
      updated_at?: number;
      created_by?: string;
      updated_by?: string;
      current?: string;
    };
  } | null;

  /* Sidebar UI */
  sidebarMode: 'notes' | 'trash' | 'tags';
  searchQuery: string;

  /* Modal */
  modal: {
    open: boolean;
    mode: 'create' | 'rename';
    noteId?: string;
    searchValue?: string;
  };

  /* Status bar */
  status: string;
  isOffline: boolean;
  syncStatus: string;

  /* Toasts */
  toasts: Toast[];

  /* Confirm dialog */
  confirmDialog: {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    variant: 'danger' | 'default';
  };
}

/* ── Initial state ────────────────────────────────────────────────────── */

export const initialAppState: AppState = {
  notes: [],
  activeNoteId: null,
  activeNoteContent: null,
  activeNoteData: null,
  activeTab: 'view',
  isDirty: false,
  isSystemNote: false,

  auth: {
    username: null,
    showLogin: false,
  },

  trash: [],
  trashPreview: null,

  sidebarMode: 'notes',
  searchQuery: '',

  modal: {
    open: false,
    mode: 'create',
  },

  status: '',
  isOffline: !navigator.onLine,
  syncStatus: '',

  toasts: [],

  confirmDialog: {
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    variant: 'default',
  },
};

/* ── Actions ───────────────────────────────────────────────────────────── */

export type AppAction =
  /* ── Notes ── */
  | { type: 'NOTES_LOADED'; notes: NoteMeta[] }
  | { type: 'NOTE_SELECTED'; id: string; content: string; isSystemNote: boolean; noteData: AppState['activeNoteData'] }
  | { type: 'NOTE_CONTENT_CHANGED'; content: string }
  | { type: 'NOTE_SAVED' }
  | { type: 'CLEAR_EDITOR' }

  /* ── Trash ── */
  | { type: 'TRASH_LOADED'; trash: TrashEntry[] }
  | { type: 'SHOW_TRASH_PREVIEW'; id: string; content: string; source: 'local' | 'server'; meta: NonNullable<AppState['trashPreview']>['meta'] }
  | { type: 'CLEAR_TRASH_PREVIEW' }

  /* ── Auth ── */
  | { type: 'LOGIN'; username: string }
  | { type: 'LOGOUT' }
  | { type: 'SHOW_LOGIN' }
  | { type: 'HIDE_LOGIN' }

  /* ── UI ── */
  | { type: 'SET_ACTIVE_TAB'; tab: 'view' | 'code' | 'meta' }
  | { type: 'SET_SIDEBAR_MODE'; mode: AppState['sidebarMode'] }
  | { type: 'SET_SEARCH_QUERY'; query: string }
  | { type: 'SET_MODAL'; open: boolean; mode: 'create' | 'rename'; noteId?: string; searchValue?: string }
  | { type: 'SET_STATUS'; status: string }
  | { type: 'SET_OFFLINE'; isOffline: boolean }
  | { type: 'SET_SYNC_STATUS'; status: string }
  | { type: 'ADD_TOAST'; id: string; message: string; isError?: boolean }
  | { type: 'REMOVE_TOAST'; id: string }

  /* ── Confirm dialog ── */
  | { type: 'SHOW_CONFIRM'; title: string; message: string; confirmLabel: string; variant: 'danger' | 'default' }
  | { type: 'HIDE_CONFIRM' };

/* ── Reducer ───────────────────────────────────────────────────────────── */

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    /* ── Notes ── */
    case 'NOTES_LOADED':
      return { ...state, notes: action.notes };

    case 'NOTE_SELECTED': {
      // Empty content → start in Code tab so the user can begin typing.
      // System notes stay in View (read-only).
      const isEmpty = !action.content.trim();
      // Only reset the tab when navigating to a *different* note.
      // When reloading the same note (after sync or cross-tab update),
      // preserve the current tab so the user isn't yanked out of the editor.
      const isSameNote = action.id === state.activeNoteId;
      return {
        ...state,
        activeNoteId: action.id,
        activeNoteContent: action.content,
        activeNoteData: action.noteData,
        activeTab: isSameNote
          ? state.activeTab
          : (isEmpty && !action.isSystemNote) ? 'code' : 'view',
        isDirty: false,
        isSystemNote: action.isSystemNote,
      };
    }

    case 'NOTE_CONTENT_CHANGED':
      return {
        ...state,
        activeNoteContent: action.content,
        isDirty: true,
      };

    case 'NOTE_SAVED':
      return { ...state, isDirty: false };

    case 'CLEAR_EDITOR':
      return {
        ...state,
        activeNoteId: null,
        activeNoteContent: null,
        activeNoteData: null,
        isDirty: false,
        isSystemNote: false,
      };

    /* ── Trash ── */
    case 'TRASH_LOADED':
      return { ...state, trash: action.trash };

    case 'SHOW_TRASH_PREVIEW':
      return {
        ...state,
        trashPreview: {
          id: action.id,
          content: action.content,
          source: action.source,
          meta: action.meta,
        },
      };

    case 'CLEAR_TRASH_PREVIEW':
      return { ...state, trashPreview: null };

    /* ── Auth ── */
    case 'LOGIN':
      return {
        ...state,
        auth: { username: action.username, showLogin: false },
      };

    case 'LOGOUT':
      return {
        ...state,
        auth: { username: null, showLogin: false },
        // Also reset editor state on logout
        activeNoteId: null,
        activeNoteContent: null,
        activeNoteData: null,
        isDirty: false,
        isSystemNote: false,
      };

    case 'SHOW_LOGIN':
      return {
        ...state,
        auth: { ...state.auth, showLogin: true },
      };

    case 'HIDE_LOGIN':
      return {
        ...state,
        auth: { ...state.auth, showLogin: false },
      };

    /* ── UI ── */
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.tab };

    case 'SET_SIDEBAR_MODE':
      return { ...state, sidebarMode: action.mode };

    case 'SET_SEARCH_QUERY':
      return { ...state, searchQuery: action.query };

    case 'SET_MODAL':
      return {
        ...state,
        modal: { open: action.open, mode: action.mode, noteId: action.noteId, searchValue: action.searchValue },
      };

    case 'SET_STATUS':
      return { ...state, status: action.status };

    case 'SET_OFFLINE':
      return { ...state, isOffline: action.isOffline };

    case 'SET_SYNC_STATUS':
      return { ...state, syncStatus: action.status };

    case 'ADD_TOAST':
      // Avoid duplicate toasts with the same id
      if (state.toasts.some(t => t.id === action.id)) return state;
      return {
        ...state,
        toasts: [...state.toasts, { id: action.id, message: action.message, isError: action.isError }],
      };

    case 'REMOVE_TOAST':
      return {
        ...state,
        toasts: state.toasts.filter(t => t.id !== action.id),
      };

    /* ── Confirm dialog ── */
    case 'SHOW_CONFIRM':
      return {
        ...state,
        confirmDialog: {
          open: true,
          title: action.title,
          message: action.message,
          confirmLabel: action.confirmLabel,
          variant: action.variant,
        },
      };

    case 'HIDE_CONFIRM':
      return {
        ...state,
        confirmDialog: { ...state.confirmDialog, open: false },
      };

    default:
      return state;
  }
}

/* ── Context ───────────────────────────────────────────────────────────── */

const StateContext = createContext<AppState>(initialAppState);
const DispatchContext = createContext<Dispatch<AppAction>>(() => {
  throw new Error('useDispatch must be used within AppProvider');
});

/** Hook: read the full application state. */
export function useAppState(): AppState {
  return useContext(StateContext);
}

/** Hook: get the stable dispatch function. */
export function useAppDispatch(): Dispatch<AppAction> {
  return useContext(DispatchContext);
}

/* ── Provider ──────────────────────────────────────────────────────────── */

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        {children}
      </DispatchContext.Provider>
    </StateContext.Provider>
  );
}
