# Leaf — Architecture Diagrams

Generated from `requirements/` on 2026-05-31.

---

## 1. High-Level System Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              BROWSER                                     │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                     SPA (TypeScript → esbuild)                   │    │
│  │                                                                  │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │    │
│  │  │  app.ts  │  │  ui.ts   │  │ store.ts │  │   notes-ctrl.ts  │ │    │
│  │  │ (entry)  │  │ (DOM)    │  │ (state)  │  │   trash-ctrl.ts  │ │    │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬──────────┘ │    │
│  │       │              │              │                │            │    │
│  │  ┌────┴──────────────┴──────────────┴────────────────┴────────┐  │    │
│  │  │                    DATA LAYER                               │  │    │
│  │  │  ┌────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │  │    │
│  │  │  │ db.ts  │  │ notes.ts │  │ trash.ts │  │ sync.ts      │  │  │    │
│  │  │  │(Dexie) │  │ (model)  │  │ (model)  │  │ (push/pull)  │  │  │    │
│  │  │  └───┬────┘  └─────┬────┘  └─────┬────┘  └──────┬───────┘  │  │    │
│  │  │      │              │              │              │          │  │    │
│  │  │  ┌───┴──────────────┴──────────────┴──────────────┴───────┐ │  │    │
│  │  │  │                  IndexedDB (Dexie 3.x)                 │ │  │    │
│  │  │  │  ┌───────────┐  ┌──────────────────────────────────┐   │ │  │    │
│  │  │  │  │ notes     │  │ queue (offline change queue)     │   │ │  │    │
│  │  │  │  │ id,       │  │ seq, type, id, content, status   │   │ │  │    │
│  │  │  │  │ content,  │  │ (pending/sent)                   │   │ │  │    │
│  │  │  │  │ deleted,  │  └──────────────────────────────────┘   │ │  │    │
│  │  │  │  │ ...       │                                         │ │  │    │
│  │  │  │  └───────────┘                                         │ │  │    │
│  │  │  └────────────────────────────────────────────────────────┘ │  │    │
│  │  └─────────────────────────────────────────────────────────────┘  │    │
│  │                                                                  │    │
│  │  ┌──────────────────────────────────────────────────────────┐   │    │
│  │  │                     VIEW LAYER                            │   │    │
│  │  │  ┌──────────┐  ┌──────────┐  ┌───────────┐              │   │    │
│  │  │  │tree-view │  │markdown- │  │code mirror│  ┌─────────┐ │   │    │
│  │  │  │(sidebar) │  │  view    │  │   view    │  │history  │ │   │    │
│  │  │  └──────────┘  └──────────┘  └───────────┘  │(modal)  │ │   │    │
│  │  │  ┌──────────┐  ┌──────────┐  ┌───────────┐  └─────────┘ │   │    │
│  │  │  │meta-view │  │tag-view  │  │trash-view │              │   │    │
│  │  │  └──────────┘  └──────────┘  └───────────┘              │   │    │
│  │  └──────────────────────────────────────────────────────────┘   │    │
│  │                                                                  │    │
│  │  ┌──────────────────────┐  ┌──────────────────────────────┐     │    │
│  │  │ auth.ts (JWT memory) │  │ Service Worker (sw.js)       │     │    │
│  │  │ + httpOnly cookie    │  │ Cache-first shell,           │     │    │
│  │  │ refresh token rotation│  │ network-only for API calls   │     │    │
│  │  └──────────────────────┘  └──────────────────────────────┘     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    PWA Manifest + Icons                          │    │
│  │         (installable, standalone, "New Note" shortcut)            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │  HTTPS
                               │  JWT Bearer + refresh_token cookie
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         PHP 8.x BACKEND                                  │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                     api/index.php (Router)                       │    │
│  │                                                                  │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐   │    │
│  │  │ auth.php │  │sync.php  │  │trash.php │  │ history.php   │   │    │
│  │  │ login    │  │ push/pull│  │ list     │  │ list versions │   │    │
│  │  │ refresh  │  │ bootstrap│  │ preview  │  │ get content   │   │    │
│  │  │ logout   │  │ incremental│ │ restore  │  └───────────────┘   │    │
│  │  └────┬─────┘  │ stale-409│  │ purge    │  ┌───────────────┐   │    │
│  │       │        └────┬─────┘  │ empty    │  │spa-config.php │   │    │
│  │  ┌────┴────┐        │        └────┬─────┘  │ (GET, public) │   │    │
│  │  │jwt.php  │        │             │        └───────────────┘   │    │
│  │  │ HS256   │   ┌────┴─────────────┴────────┐                  │    │
│  │  └─────────┘   │       storage.php          │                  │    │
│  │                 │  (all file I/O isolated)   │                  │    │
│  │  ┌──────────┐   │                           │                  │    │
│  │  │users.php │   │ notes/{id}.json            │                  │    │
│  │  │ bcrypt   │   │ notes/{id}.deleted.json    │                  │    │
│  │  └──────────┘   │ changelog.jsonl (append)  │                  │    │
│  │                 │ refresh_tokens.json        │                  │    │
│  │                 │ users.htpasswd             │                  │    │
│  │                 │ audit-YYYY-MM.jsonl        │                  │    │
│  │                 └───────────────────────────┘                  │    │
│  │                                                                  │    │
│  │  ┌──────────────────────────────────────────────────────────┐   │    │
│  │  │  cors.php  │  auth_guard.php (require_auth → username)   │   │    │
│  │  │  config.php (DATA_ROOT, JWT_SECRET, CORS_ALLOW_POLICY)   │   │    │
│  │  └──────────────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      FILE SYSTEM                                 │    │
│  │  data/                                                           │    │
│  │  ├── users.htpasswd          (bcrypt $2y$ hashes)                │    │
│  │  ├── refresh_tokens.json     (active sessions)                   │    │
│  │  ├── changelog.jsonl         (append-only, monotonic rev)        │    │
│  │  ├── audit-YYYY-MM.jsonl     (monthly audit logs)                │    │
│  │  └── notes/                                                      │    │
│  │      ├── welcome.json        (current + versions + created_at)   │    │
│  │      ├── old-note.deleted.json  (tombstone with deleted_at/by)   │    │
│  │      └── ...                                                     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Frontend Module Dependency Graph

```
                              ┌─────────────────────┐
                              │      app.ts         │
                              │    (entry point)    │
                              │  boot(), showApp(), │
                              │  saveFile(),        │
                              │  Keyboard shortcuts │
                              └──────────┬──────────┘
                                         │ imports
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
              ▼                          ▼                          ▼
   ┌──────────────────┐    ┌───────────────────────┐    ┌──────────────────┐
   │   notes-ctrl.ts  │    │    trash-ctrl.ts      │    │   login-ctrl.ts  │
   │   (controller)   │    │     (controller)      │    │   (controller)   │
   │                  │    │                       │    │                  │
   │ create, open,    │    │ load, preview, restore,│    │ login, logout,   │
   │ save, delete,    │    │ purge, empty          │    │ tryRestoreSession│
   │ rename, search   │    │                       │    │                  │
   └───┬──────┬───────┘    └───┬───────┬───────────┘    └────────┬─────────┘
       │      │                │       │                         │
       │      │                │       │                         │
       ▼      ▼                ▼       ▼                         ▼
   ┌────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐    ┌──────────────────┐
   │notes.ts│ │frontmatter│ │trash.ts│ │  api.ts  │    │    auth.ts       │
   │(model) │ │   .ts     │ │(model) │ │ (fetch)  │    │ JWT memory,      │
   │        │ │           │ │        │ │          │    │ authFetch(),     │
   │ load,  │ │ parse,    │ │ local  │ │ POST to  │    │ refreshToken()   │
   │ list,  │ │ update,   │ │ trash  │ │ sync.php,│    │                  │
   │ save   │ │ stats     │ │ queries│ │ auth.php │    └────────┬─────────┘
   └───┬────┘ └──────────┘ └───┬────┘ └────┬─────┘             │
       │                       │           │                   │ ambient
       │                       │           │                   │ getUsername()
       ▼                       ▼           ▼                   │
   ┌─────────────────────────────────────────────────┐        │
   │                    db.ts                         │◄───────┘
   │              (Dexie IndexedDB)                   │
   │                                                  │
   │  Schema: notes(id, content, deleted, ...)        │
   │          queue(++seq, type, id, content, status) │
   │                                                  │
   │  Helpers: dbListNotes, dbGetNote, dbSaveNote,    │
   │           dbDeleteNote, dbRenameNote,            │
   │           dbApplyServerChange,                   │
   │           queueChange, queueGetPending,          │
   │           queueMarkSent, queuePruneSent          │
   └──────────────────────┬──────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
   ┌──────────────────┐    ┌──────────────────────┐
   │    sync.ts       │    │   change-bus.ts      │
   │  (local↔server   │    │   (pub/sub events)   │
   │   bridge)        │    │                      │
   │                  │    │ Emits on every local │
   │ push(), pull(),  │    │ mutating operation   │
   │ tick(), poll loop│    │ (save, create,       │
   │                  │    │  delete, rename)     │
   │ On module load:  │◄───┤                      │
   │ subscribe to     │    │ sync.ts listens to   │
   │ change-bus       │    │ enqueue outbound ops │
   └────────┬─────────┘    └──────────────────────┘
            │
            │ authFetch()
            ▼
   ┌──────────────────┐
   │     api.ts       │
   │ /api/sync.php    │
   └──────────────────┘
```

---

## 3. Editor Tab Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EDITOR WRAPPER                              │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                      TAB BAR                                  │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │  │
│  │  │  View    │  │  Raw     │  │  Meta    │                   │  │
│  │  │ (default)│  │          │  │          │                   │  │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘                   │  │
│  │       │              │              │                         │  │
│  └───────┼──────────────┼──────────────┼─────────────────────────┘  │
│          │              │              │                            │
│  ┌───────┴──────┐ ┌─────┴──────┐ ┌─────┴──────────┐               │
│  │ markdown-    │ │ edit-view  │ │ meta-view.ts   │               │
│  │ view.ts      │ │ .ts        │ │                │               │
│  │              │ │            │ │ title, summary,│               │
│  │ READ-ONLY    │ │ CodeMirror │ │ user-tags,     │               │
│  │              │ │ editor     │ │ custom fields, │               │
│  │ rendered     │ │            │ │ system info,   │               │
│  │ markdown +   │ │ full raw   │ │ body stats     │               │
│  │ frontmatter  │ │ content    │ │                │               │
│  │ header       │ │ (includes  │ │ EDITABLE meta  │               │
│  │              │ │ fm block)  │ │ with pending   │               │
│  │ lazy-loaded  │ │            │ │ state machine  │               │
│  │ + extensions │ │ SOURCE OF  │ │                │               │
│  │ + fence      │ │   TRUTH    │ │ flushed to raw │               │
│  │ hydration    │ │            │ │ on save/tab    │               │
│  └──────────────┘ └─────┬──────┘ └────────────────┘               │
│                          │                                         │
│                          │ textarea content flows:                  │
│                          │                                         │
│  Tab transition logic:   │                                         │
│  ┌───────────────────────┴──────────────────────────────────────┐  │
│  │  View ← Raw:   no flush needed (view re-renders from raw)    │  │
│  │  Meta ← Raw:   re-parse frontmatter from textarea            │  │
│  │  Raw ← Meta:   flush pending meta → updateFrontmatter()      │  │
│  │  Raw ← View:   no flush needed                               │  │
│  │  Save (any):   flushAndGetContent() → saveNote()             │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                  SUPPORTING MODULES                            │  │
│  │  ┌────────────┐  ┌───────────┐  ┌──────────────┐             │  │
│  │  │ markdown.ts│  │frontmatter│  │render-fm.ts  │             │  │
│  │  │ markdown-it│  │   .ts     │  │ shared HTML   │             │  │
│  │  │ wrapper    │  │ parse,    │  │ rendering     │             │  │
│  │  │ use() API  │  │ update,   │  │               │             │  │
│  │  │ lazy plug- │  │ pending,  │  │ for markdown- │             │  │
│  │  │ in loader  │  │ stats     │  │ view + trash  │             │  │
│  │  └────────────┘  └───────────┘  └──────────────┘             │  │
│  │                                                                │  │
│  │  ┌────────────┐  ┌───────────┐  ┌──────────────────────────┐  │  │
│  │  │fence-      │  │codemirror/│  │   extensions/            │  │  │
│  │  │hydrate.ts  │  │setup.ts   │  │   ├── emoji.ts            │  │  │
│  │  │ (mermaid,  │  │           │  │   ├── wikilinks.ts        │  │  │
│  │  │ graphviz,  │  │ syntax    │  │   ├── highlight.ts        │  │  │
│  │  │ math)     │  │ highlight,│  │   └── hcl-grammar.ts      │  │  │
│  │  └────────────┘  │ autocomplete│  └──────────────────────────┘  │  │
│  │                  └───────────┘                                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Offline-First Sync Protocol

```
┌─────────────── CLIENT ───────────────┐      ┌─────────── SERVER ──────────┐
│                                      │      │                             │
│  User Action (save/create/delete)    │      │                             │
│         │                            │      │                             │
│         ▼                            │      │                             │
│  ┌──────────────────┐               │      │                             │
│  │ 1. Write to      │               │      │                             │
│  │    IndexedDB      │               │      │                             │
│  │    (immediate,    │               │      │                             │
│  │     offline-safe) │               │      │                             │
│  └────────┬─────────┘               │      │                             │
│           │                          │      │                             │
│           ▼                          │      │                             │
│  ┌──────────────────┐               │      │                             │
│  │ 2. Enqueue change │               │      │                             │
│  │    to queue table  │               │      │                             │
│  │    (collapse       │               │      │                             │
│  │     pending for    │               │      │                             │
│  │     same note id)  │               │      │                             │
│  └────────┬─────────┘               │      │                             │
│           │                          │      │                             │
│           ▼                          │      │                             │
│  ┌──────────────────┐               │      │                             │
│  │ 3. Emit on        │               │      │                             │
│  │    change-bus     │               │      │                             │
│  └────────┬─────────┘               │      │                             │
│           │                          │      │                             │
│  ╔════════╧══════════════════════════╗      │                             │
│  ║  sync.ts poll loop (every 30s)   ║      │                             │
│  ║  or immediate syncNow() after    ║      │                             │
│  ║  user action                     ║      │                             │
│  ╚════════╤══════════════════════════╝      │                             │
│           │                          │      │                             │
│           ▼                          │      │                             │
│  ┌──────────────────────────────────┐│      │                             │
│  │ tick()                           ││      │                             │
│  │                                  ││      │                             │
│  │  push():                         ││      │                             │
│  │  ┌───────────────────────────┐   ││      │                             │
│  │  │ POST /api/sync            │───┼┼──────┼──► ┌───────────────────┐   │
│  │  │ { baseRevision,           │   ││      │   │ sync.php          │   │
│  │  │   syncedRevision,         │   ││      │   │                   │   │
│  │  │   changes: [             │   ││      │   │ 1. Apply incoming  │   │
│  │  │     {type:1|2|3|4,       │   ││      │   │    changes         │   │
│  │  │      key, obj}           │   ││      │   │    (last-write-wins│   │
│  │  │   ]}                     │   ││      │   │     version chain) │   │
│  │  └───────────────────────────┘   ││      │   │                   │   │
│  │                                  ││      │   │ 2. Read changelog │   │
│  │  pull():                         ││      │   │    since syncedRev │   │
│  │  ┌───────────────────────────┐   ││      │   │                   │   │
│  │  │ Response:                 │◄──┼┼──────┼───│ 3. Deduplicate    │   │
│  │  │ { changes: [...],         │   ││      │   │    per note id     │   │
│  │  │   currentRevision: N }    │   ││      │   │                   │   │
│  │  └───────────┬───────────────┘   ││      │   │ 4. Return changes │   │
│  │              │                   ││      │   └───────────────────┘   │
│  │              ▼                   ││      │                             │
│  │  ┌───────────────────────────┐   ││      │                             │
│  │  │ dbApplyServerChange()     │   ││      │                             │
│  │  │ (never re-queued)         │   ││      │                             │
│  │  └───────────────────────────┘   ││      │                             │
│  │                                  ││      │                             │
│  │  queuePruneSent()                ││      │                             │
│  │  update localStorage revision    ││      │                             │
│  └──────────────────────────────────┘│      │                             │
│                                      │      │                             │
│  State Machine:                      │      │                             │
│  ┌────────────────────────────────┐  │      │                             │
│  │ OFFLINE ↔ IDLE → SYNCING → IDLE│  │      │                             │
│  │              ↘ ERROR ↗         │  │      │                             │
│  │   (10s retry delay on error)   │  │      │                             │
│  └────────────────────────────────┘  │      │                             │
└──────────────────────────────────────┘      └─────────────────────────────┘

Change Types:
  DEXIE_CREATE = 1   (content + version)
  DEXIE_UPDATE = 2   (content + version)
  DEXIE_DELETE = 3   (deleted_by + deleted_at)
  DEXIE_RENAME = 4   (renamed_to + renamed_by)

Server Bootstrap (syncedRevision=0):
  Filesystem scan → live notes as CREATE + tombstones as DELETE
  (O(notes) — no changelog scan)

Server Incremental (syncedRevision ≥ earliest_rev):
  Changelog scan → deduplicate per key → send final state only

Server Stale (0 < syncedRevision < earliest_rev):
  HTTP 409 STALE_REVISION → client re-bootstraps
```

---

## 5. Authentication Flow

```
┌─────────────────── CLIENT ───────────────────┐    ┌─────── SERVER ───────┐
│                                               │    │                      │
│  BOOT SEQUENCE:                               │    │                      │
│  ┌─────────────────────────────────────────┐  │    │                      │
│  │ 1. showApp(false) — app shell visible   │  │    │                      │
│  │ 2. tryRestoreSession()                  │  │    │                      │
│  │    └─► POST /api/auth?action=refresh    │──┼────┼──► ┌──────────────┐ │
│  │        (cookie sent automatically)       │  │    │   │ auth.php     │ │
│  │        ◄── new JWT + rotated cookie ────┼──┼────┼───│ refresh      │ │
│  │                                          │  │    │   │              │ │
│  │    Results:                              │  │    │   │ validate     │ │
│  │    • 'ok' → upgrade UI, start sync      │  │    │   │ refresh token│ │
│  │    • 'auth-failed' → show login screen  │  │    │   │ rotate token │ │
│  │    • 'network-error' → offline mode     │  │    │   │ issue JWT    │ │
│  └─────────────────────────────────────────┘  │    │   └──────────────┘ │
│                                               │    │                      │
│  LOGIN:                                       │    │                      │
│  ┌─────────────────────────────────────────┐  │    │                      │
│  │ POST /api/auth?action=login             │──┼────┼──► ┌──────────────┐ │
│  │ { username, password }                   │  │    │   │ validate_user│ │
│  │ ◄── { ok, token, username, expires } ────┼──┼────┼───│ (bcrypt)     │ │
│  │ + httpOnly refresh_token cookie set      │  │    │   │              │ │
│  │                                          │  │    │   │ issue JWT +  │ │
│  │ JWT stored in JS memory only (not       │  │    │   │ refresh token│ │
│  │ localStorage — resists XSS)             │  │    │   └──────────────┘ │
│  └─────────────────────────────────────────┘  │    │                      │
│                                               │    │                      │
│  TOKEN EXPIRY DURING SESSION:                 │    │                      │
│  ┌─────────────────────────────────────────┐  │    │                      │
│  │ authFetch(url, opts)                     │  │    │                      │
│  │   → attaches Authorization: Bearer      │  │    │                      │
│  │   → on 401: refreshToken() (deduped)    │──┼────┼──► POST /api/auth   │
│  │   → on success: retry original request  │  │    │    ?action=refresh   │
│  │   → on failure: notifyAuthFailure()     │  │    │                      │
│  │       → showLogin() + stopSync()        │  │    │                      │
│  └─────────────────────────────────────────┘  │    │                      │
│                                               │    │                      │
│  LOGOUT:                                      │    │                      │
│  ┌─────────────────────────────────────────┐  │    │                      │
│  │ POST /api/auth?action=logout            │──┼────┼──► delete refresh   │
│  │ clear JWT memory, stopSync(),           │  │    │    token, clear      │
│  │ notifyAuthFailure() → showLogin()       │  │    │    cookie            │
│  └─────────────────────────────────────────┘  │    │                      │
│                                               │    │                      │
│  OFFLINE / DISMISS LOGIN:                     │    │                      │
│  ┌─────────────────────────────────────────┐  │    │                      │
│  │ Login screen has × dismiss button       │  │    │                      │
│  │ → hide login, show app in offline mode  │  │    │                      │
│  │ → user works locally, "Sign in" button  │  │    │                      │
│  │   in header to authenticate later       │  │    │                      │
│  └─────────────────────────────────────────┘  │    │                      │
└───────────────────────────────────────────────┘    └──────────────────────┘
```

---

## 6. Data Model — Note Version Chain

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    notes/welcome.json                                   │
│                                                                         │
│  {                                                                      │
│    "current": "2026-05-27:2:alice",    ◄── points to active version    │
│    "created_at": 1748000000,           ◄── set once, never changes     │
│    "created_by": "alice",              ◄── original creator            │
│    "versions": {                                                        │
│                                                                         │
│      "2026-05-26:1:bob": {              ◄── earlier version            │
│        "author": "bob",                                                 │
│        "saved_at": 1748260000,                                          │
│        "content": "# v1 by bob\n\n...",  ◄── opaque to server          │
│        "prev": null,                     ◄── root version              │
│        "exclusive": false                ◄── seen by alice via sync    │
│      },                                                                 │
│                                                                         │
│      "2026-05-27:1:alice": {            ◄── alice's first edit         │
│        "author": "alice",                                               │
│        "saved_at": 1748340000,                                          │
│        "content": "# v2 by alice\n\n...",                              │
│        "prev": "2026-05-26:1:bob",       ◄── links to bob's version    │
│        "exclusive": true                 ◄── only alice has seen this  │
│      },                                                                 │
│                                                                         │
│      "2026-05-27:2:alice": {            ◄── alice's second edit        │
│        "author": "alice",               ◄── same day → overwrote slot  │
│        "saved_at": 1748350000,           │    (counter didn't increment │
│        "content": "# v3 by alice\n\n...",│     because same author+date │
│        "prev": "2026-05-27:1:alice",    ◄── and exclusive=true)        │
│        "exclusive": true                                               │
│      }                                                                  │
│    }                                                                    │
│  }                                                                      │
│                                                                         │
│  Version Key: {YYYY-MM-DD}:{counter}:{author}                          │
│  Lexicographic sort = chronological order (ksort OK)                   │
│                                                                         │
│  Overwrite rule: same author + same UTC day → overwrite existing slot  │
│  New version:    different author or next UTC day → new key            │
│  Exclusive flag: true until another user fetches via sync              │
│                                                                         │
│  ┌── prev chain ──────────────────────────────────────────────────┐    │
│  │  2026-05-26:1:bob ──► 2026-05-27:1:alice ──► 2026-05-27:2:alice │   │
│  │       (root)              (alice overwrites bob)    (same day)   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  After soft-delete → renamed to welcome.deleted.json                   │
│  Gains: deleted_at, deleted_by at top level                            │
│  Restore → stripped, moved back to welcome.json                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Folder / Tree Structure Convention

```
  Note IDs use colon (:) as path separator — no actual directories on disk:

  ┌────────────────────────────────────────┐
  │  Flat file storage:                    │
  │  notes/work:meetings:standup.json      │
  │  notes/work:meetings:retro.json        │
  │  notes/work:projects:leaf.json         │
  │  notes/personal:journal.json           │
  │  notes/personal:recipes.json           │
  └────────────────────────────────────────┘
                    │
                    │ tree-view.ts reconstructs hierarchy
                    ▼
  ┌────────────────────────────────────────┐
  │  Sidebar Tree View:                    │
  │                                        │
  │  ▶ work/                               │
  │    ▶ meetings/                         │
  │      📄 standup                        │
  │      📄 retro                          │
  │    ▶ projects/                         │
  │      📄 leaf                           │
  │  ▶ personal/                           │
  │    📄 journal                          │
  │    📄 recipes                          │
  │                                        │
  │  Sorted: natural sort (numeric parts  │
  │  as numbers), branches before leaves   │
  │  Auto-expand ancestors of open note    │
  │  Context menu on ⋯ (rename/delete)     │
  └────────────────────────────────────────┘

  User input: slashes (/) are mapped to colons by safeName()
```

---

## 8. Frontmatter / Content Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     OPAQUE NOTE CONTENT                          │
│                                                                  │
│  Server stores and transmits this as a single opaque string.     │
│  Client parses frontmatter between --- delimiters.               │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  ---                                                       │  │
│  │  title: My Note                      ← editable             │  │
│  │  summary: A short description        ← editable             │  │
│  │  user-tags: [work, meetings]         ← editable             │  │
│  │  created_by: alice                   ← read-only, set once  │  │
│  │  updated_by: bob                     ← read-only, auto-set  │  │
│  │  auto-tags: [auto:recent]            ← reserved, future use │  │
│  │  custom_key: some value              ← editable custom      │  │
│  │  ---                                                       │  │
│  │                                                            │  │
│  │  Note body text here...                                    │  │
│  │  This is rendered as Markdown in View tab.                 │  │
│  │                                                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────┐  ┌───────────────────┐                    │
│  │ frontmatter.ts   │  │   meta-view.ts    │                    │
│  │                  │  │                   │                    │
│  │ parseFrontmatter │  │ title input       │                    │
│  │ updateFrontmatter│  │ summary textarea  │                    │
│  │ initPendingMeta  │  │ tags input        │                    │
│  │ pendingMetaToUp- │  │ custom rows       │                    │
│  │    dates         │  │ system info table │                    │
│  │ computeStats     │  │ body stats        │                    │
│  │                  │  │                   │                    │
│  │ PURE FUNCTIONS   │  │ DOM + pending     │                    │
│  │ (no DOM deps)    │  │ state machine     │                    │
│  └──────────────────┘  └───────────────────┘                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 9. Markdown Rendering Pipeline

```
  Raw content (from textarea)
         │
         ▼
  ┌──────────────────────────────────────────────┐
  │              markdown.ts                      │
  │                                              │
  │  ┌────────────────────────────────────────┐  │
  │  │  markdown-it instance (singleton)      │  │
  │  │                                        │  │
  │  │  Registered plugins (server-driven):   │  │
  │  │  ┌──────────────────────────────────┐  │  │
  │  │  │ Built-in:                        │  │  │
  │  │  │  • wikilinks [[note]] → <a>      │  │  │
  │  │  │  • fence hydration (custom       │  │  │
  │  │  │    renderer dispatch)            │  │  │
  │  │  ├──────────────────────────────────┤  │  │
  │  │  │ Lazy-loaded via loadPlugins():   │  │  │
  │  │  │  • emoji :smile: → 😄            │  │  │
  │  │  │  • highlight (syntax via hljs)   │  │  │
  │  │  │  • hcl-grammar                  │  │  │
  │  │  │  • (more from extensions/)      │  │  │
  │  │  └──────────────────────────────────┘  │  │
  │  └────────────────────────────────────────┘  │
  │                    │                         │
  │                    ▼                         │
  │  ┌────────────────────────────────────────┐  │
  │  │  parse(body) → HTML string             │  │
  │  └────────────────────────────────────────┘  │
  └──────────────────────┬───────────────────────┘
                         │
                         ▼
  ┌──────────────────────────────────────────────┐
  │           markdown-view.ts                    │
  │                                              │
  │  ┌────────────────────────────────────────┐  │
  │  │  Sticky Header:                        │  │
  │  │  renderFrontmatter(fm, noteData)       │  │
  │  │  → title <h1>, tags, custom fields     │  │
  │  ├────────────────────────────────────────┤  │
  │  │  Body:                                 │  │
  │  │  markdown.parse(body)                  │  │
  │  │  → rendered HTML                       │  │
  │  ├────────────────────────────────────────┤  │
  │  │  Footer:                               │  │
  │  │  renderStats(body) + updated_at        │  │
  │  └────────────────────────────────────────┘  │
  │                                              │
  │  Lazy-loaded via dynamic import()            │
  └──────────────────────────────────────────────┘
```

---

## 10. Theming System

```
  ┌────────────────────────────────────────────────────────────────────┐
  │                         THEMING SYSTEM                              │
  │                                                                    │
  │  spa/css/                                                          │
  │  ├── layout.css          (structural only: display, flex, grid,    │
  │  │                         padding, margin, z-index, animations)   │
  │  ├── theme-dark.css      (dark editorial, gold accent)             │
  │  ├── theme-light.css     (paper-like, dark gold accent)            │
  │  ├── theme-magenta.css   (Deutsche Telekom style, #e20074)         │
  │  ├── theme-paired-12.css (bluish, IBM Plex fonts)                  │
  │  ├── hljs.css            (theme-gated: dark themes→GitHub Dark,    │
  │  │                         light themes→GitHub Light)              │
  │  └── cm.css              (CodeMirror editor theme variables)       │
  │                                                                    │
  │  Activation:                                                       │
  │  ┌──────────────────────────────────────────────────────────────┐  │
  │  │  <html data-theme="dark|light|magenta|paired-12">           │  │
  │  │                                                              │  │
  │  │  1. Inline <script> in <head> sets data-theme from           │  │
  │  │     localStorage or prefers-color-scheme (no flash)          │  │
  │  │  2. themes.ts: applyTheme() sets attribute, persists to      │  │
  │  │     localStorage, syncs meta theme-color, notifies CM        │  │
  │  │  3. Theme selector in app menu dropdown (4 radio items)      │  │
  │  └──────────────────────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────────────────────┘
```

---

## 11. Trash Architecture

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                         TRASH SYSTEM                              │
  │                                                                  │
  │  Sidebar mode toggle: Notes ↔ Trash                              │
  │                                                                  │
  │  ┌────────────────────────────────────────────────────────────┐  │
  │  │  trash-ctrl.ts (controller)                                │  │
  │  │  • loadTrash(): merge local IndexedDB + server /api/trash  │  │
  │  │  • previewTrash(): read deleted note content               │  │
  │  │  • restoreNote(): revives tombstone → live note            │  │
  │  │  • purgeNote(): permanent delete (single)                  │  │
  │  │  • emptyTrash(): permanent delete (all)                    │  │
  │  └──────────────────────┬─────────────────────────────────────┘  │
  │                         │                                        │
  │              ┌──────────┴──────────┐                             │
  │              ▼                     ▼                             │
  │  ┌──────────────────┐  ┌──────────────────────────┐             │
  │  │ trash.ts (model) │  │ api.ts                    │             │
  │  │                  │  │ POST /api/trash            │             │
  │  │ local IndexedDB  │  │ ?action=list|preview|     │             │
  │  │ queries for      │  │        restore|purge|empty │             │
  │  │ deleted notes    │  │                            │             │
  │  └──────────────────┘  └──────────────────────────┘             │
  │                                                                  │
  │  Server:                                                         │
  │  ┌────────────────────────────────────────────────────────────┐  │
  │  │  trash.php                                                 │  │
  │  │  • list: scan data/notes/*.deleted.json                    │  │
  │  │  • preview: read tombstone content                         │  │
  │  │  • restore: rename .deleted.json → .json, changelog CREATE │  │
  │  │  • purge: unlink .deleted.json (permanent)                 │  │
  │  │  • empty: unlink all .deleted.json                         │  │
  │  └────────────────────────────────────────────────────────────┘  │
  │                                                                  │
  │  Auto-purge:                                                     │
  │  • Client: dbPurgeDeletedNotes() on boot (notes > 7 days old)   │
  │  • Server: audit log purge hook on sync requests                 │
  │            (retention: AUDIT_RETENTION_DAYS, default 90)         │
  └──────────────────────────────────────────────────────────────────┘
```

---

## 12. Keyboard Shortcuts & Interaction Layer

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                    INTERACTION LAYER                              │
  │                                                                  │
  │  keyboard.ts (shortcut registry):                                │
  │  ┌────────────────────────────────────────────────────────────┐  │
  │  │  Ctrl/Cmd + S     → Save current note                      │  │
  │  │  Escape           → Close modal or dismiss login           │  │
  │  │  (extensible registry pattern)                             │  │
  │  └────────────────────────────────────────────────────────────┘  │
  │                                                                  │
  │  context-menu.ts:                                                │
  │  ┌────────────────────────────────────────────────────────────┐  │
  │  │  Right-click / ⋯ button on note in tree:                   │  │
  │  │  ┌───────────────────────┐                                  │  │
  │  │  │  Rename / Delete      │                                  │  │
  │  │  └───────────────────────┘                                  │  │
  │  │  Dismissed on outside click                                 │  │
  │  └────────────────────────────────────────────────────────────┘  │
  │                                                                  │
  │  modal.ts:                                                       │
  │  ┌────────────────────────────────────────────────────────────┐  │
  │  │  New Note modal: pre-fills with search text + path prefix  │  │
  │  │  Rename modal: pre-filled with current note id             │  │
  │  │  Escape / Cancel button to dismiss                         │  │
  │  └────────────────────────────────────────────────────────────┘  │
  │                                                                  │
  │  cookmode.ts (Screen Wake Lock):                                 │
  │  ┌────────────────────────────────────────────────────────────┐  │
  │  │  ☀ toggle in status bar → navigator.wakeLock              │  │
  │  │  Re-acquires on visibility change                          │  │
  │  │  Always starts OFF, no persistence                         │  │
  │  └────────────────────────────────────────────────────────────┘  │
  │                                                                  │
  │  nav-history.ts (in-app back button):                            │
  │  ┌────────────────────────────────────────────────────────────┐  │
  │  │  Tracks navigation history within the app                  │  │
  │  │  Supports back/forward between opened notes                │  │
  │  └────────────────────────────────────────────────────────────┘  │
  │                                                                  │
  │  edit-time.ts (editing time tracker):                            │
  │  ┌────────────────────────────────────────────────────────────┐  │
  │  │  Tracks active editing time per note session               │  │
  │  │  Displayed in status bar / meta panel                      │  │
  │  └────────────────────────────────────────────────────────────┘  │
  └──────────────────────────────────────────────────────────────────┘
```

---

## 13. Deployment Architecture

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │                     SHARED PHP HOSTING                               │
  │                     (Namecheap / LiteSpeed / Phusion Passenger)      │
  │                                                                      │
  │  /home/user/public_html/        ← web root                          │
  │  ├── spa/                       ← SPA (subdirectory-safe)            │
  │  │   ├── index.html                                                  │
  │  │   ├── app.js                 ← esbuild bundle (TypeScript → ES)   │
  │  │   ├── sw.js                  ← Service Worker (cache-first)       │
  │  │   ├── manifest.json          ← PWA manifest                       │
  │  │   └── css/                   ← layout.css + theme-*.css           │
  │  │                                                                   │
  │  ├── api/                       ← PHP REST API                      │
  │  │   ├── index.php              ← Router (PATH_INFO extraction)      │
  │  │   ├── config.php             ← All constants, JWT_SECRET          │
  │  │   └── .htaccess              ← URL rewriting (if needed)          │
  │  │                                                                   │
  │  /home/user/data/               ← OUTSIDE web root (production)      │
  │  ├── users.htpasswd                                                  │
  │  ├── refresh_tokens.json                                             │
  │  ├── changelog.jsonl                                                 │
  │  ├── audit-YYYY-MM.jsonl                                             │
  │  └── notes/                                                          │
  │      ├── *.json                   ← live notes                      │
  │      └── *.deleted.json           ← tombstones (soft-deleted)       │
  │                                                                      │
  │  Build pipeline (local/dev):                                         │
  │  ┌──────────────────────────────────────────────────────────────┐   │
  │  │  make build-spa                                               │   │
  │  │    esbuild ts/app.ts --bundle --format=esm --splitting        │   │
  │  │      --outdir=../spa/                                         │   │
  │  │                                                               │   │
  │  │  make typecheck                                               │   │
  │  │    tsc --noEmit                                               │   │
  │  │                                                               │   │
  │  │  make test                                                    │   │
  │  │    Vitest (jsdom + fake-indexeddb) + PHPUnit + shell scripts  │   │
  │  │                                                               │   │
  │  │  make serve                                                   │   │
  │  │    php -S localhost:9000                                      │   │
  │  └──────────────────────────────────────────────────────────────┘   │
  └──────────────────────────────────────────────────────────────────────┘
```

---

## Key Architectural Decisions (from ADRs.md)

| Decision | Rationale |
|---|---|
| **PHP + flat files** (not MySQL) | Shared hosting constraints; storage.php isolates all I/O for future MySQL migration |
| **No JS framework** | Keep bundle small, no build-step complexity beyond esbuild |
| **Dexie 3.x** (IndexedDB wrapper) | Mature offline-first DB, bundled into app.js |
| **Custom sync protocol** | Poll-based, not Dexie Observable/Syncable; full control over conflict resolution |
| **Content opaque to server** | Enables future end-to-end encryption; server never reads/parses note content |
| **JWT in memory only** | Resists XSS token theft (no localStorage); refresh cookie httpOnly+SameSite=Strict |
| **Last-write-wins + version chain** | No data lost — both versions preserved in chain; 3-way merge UI future work |
| **esbuild code splitting** | Dynamic `import()` for heavy features (history, markdown-view, CodeMirror, highlight.js) |
| **markdown-it** over other renderers | Most extensible plugin ecosystem; lazy plugin loading via server-driven config |
| **Colon-separated note names** | Simulates folder hierarchy without actual directories on disk |
| **Soft delete (tombstones)** | `.deleted.json` preserves full version history; 7-day purge on client, 30+ on server |
| **Lexicographic version keys** | `date:counter:author` format so `ksort()` = chronological order |

---

## 14. Summary: Technology Stack & Component Map

```
  ╔════════════════════════════════════════════════════════════════════╗
  ║                         LEAF STACK                                ║
  ╠════════════════════════════════════════════════════════════════════╣
  ║                                                                    ║
  ║  BUILD        pnpm + esbuild + tsc --noEmit                       ║
  ║                                                                    ║
  ║  FRONTEND     TypeScript 5.x (no framework)                       ║
  ║               Dexie 3.x (IndexedDB)                               ║
  ║               CodeMirror 6 (editor)                               ║
  ║               markdown-it (markdown renderer)                     ║
  ║               highlight.js (syntax highlighting)                  ║
  ║                                                                    ║
  ║  BACKEND      PHP 8.x + flat files                               ║
  ║               JWT HS256 + bcrypt                                  ║
  ║               httpOnly refresh cookies (SameSite=Strict)          ║
  ║                                                                    ║
  ║  PWA          Service Worker (cache-first shell)                  ║
  ║               Web App Manifest (installable)                      ║
  ║               Screen Wake Lock API (cookmode)                     ║
  ║                                                                    ║
  ║  TESTING      Vitest + jsdom + fake-indexeddb (frontend)          ║
  ║               PHPUnit (backend)                                   ║
  ║               Shell scripts (integration)                         ║
  ║                                                                    ║
  ║  DEPLOY       Shared PHP hosting (Namecheap/LiteSpeed)            ║
  ║               Subdirectory-safe (relative paths everywhere)       ║
  ║               Data directory outside web root                     ║
  ║                                                                    ║
  ╚════════════════════════════════════════════════════════════════════╝
```
