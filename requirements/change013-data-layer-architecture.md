# Data Layer Architecture — Cross-Cutting Concerns

## Motivation

Following the MVC refactoring (change006), the data layer was split into pure
models (`notes.ts`, `trash.ts`) and controllers (`notes-ctrl.ts`,
`trash-ctrl.ts`).  The rule is: **models never import the server API, sync
engine, or auth module**.  Two intentional exceptions remain — `db.ts` and
`sync.ts` — whose cross-cutting imports are architectural, not accidental.

## Requirements

### R1 — `db.ts` imports `auth.ts` as ambient session context

`db.ts` calls `getUsername()` to stamp `updated_by` and `created_by` on every
write (`dbSaveNote`, `dbCreateNote`, `dbRestoreNote`).

Moving the username up to callers would add boilerplate through every layer
(`controller → model → db`) without meaningful decoupling.  The username is
session-scoped state — it changes only at login/logout and is equally available
everywhere.  It is analogous to a request context, not a service dependency.

`db.ts` SHALL continue to import `getUsername` from `auth.ts` for this purpose.

### R2 — `sync.ts` is the local↔server bridge by design

`sync.ts` imports `db.ts` (queue + notes), `api.ts` (server communication), and
`change-bus.js` (pub/sub).  This is not accidental coupling — `sync.ts` *is* the
orchestration layer that wires local persistence to the server.

`sync.ts` SHALL:
- Subscribe to the change-bus at module load to enqueue outbound changes
- Push the local queue to the server via `api.ts`
- Pull server changes and apply them to local IndexedDB
- Export `syncStart()` / `syncNow()` / `stopSync()` as its public API

### R3 — Pure models: `notes.ts` and `trash.ts`

Both model files SHALL import only:

| Module | Allowed imports |
|--------|----------------|
| `notes.ts` | `db.js`, `frontmatter.ts`, `change-bus.js` |
| `trash.ts` | `db.js`, `change-bus.js` |

Neither SHALL import `auth.ts`, `sync.ts`, or `api.ts` (types excepted).

### R4 — Controllers own cross-cutting orchestration

Operations that span local DB + server API SHALL live in controllers:

| Controller | Responsibilities |
|-----------|-----------------|
| `notes-ctrl.ts` | create, open, save, delete, rename, search |
| `trash-ctrl.ts` | load (local+server merge), preview (local or server dispatch), restore, purge, empty |

Controllers MAY import `api.ts`, `auth.ts`, `sync.ts`, `db.ts`, `utils.ts`, and
the pure models.

### R5 — Module-level listener registration is intentional

`app.ts` registers `onSyncStatus()` and `onAuthFailure()` listeners at module
scope (lines 173, 185), and `sync.ts` subscribes to `change-bus` at module scope
(line 51).  These execute at import time, before `boot()` or `syncStart()` run.

This is intentional and SHALL NOT be moved into boot functions:

- **Registration ≠ activation.**  The callbacks are inert until the
  corresponding events fire.  `syncStart()` (Phase 2) gates actual sync
  activity; `_started` guards premature `syncNow()` calls.  No listener
  triggers side effects before the system is ready.

- **Replay for initial state.**  `onSyncStatus()` immediately invokes the
  handler with the current status (`'IDLE'` or `'OFFLINE'`), setting the UI
  indicator at the earliest possible moment.  Deferring registration would
  leave the indicator blank until boot reaches those lines.

- **Idiomatic for an entry point.**  `app.ts` is the single entry point
  loaded once at startup.  Module-level registration is the standard pattern
  for wiring long-lived listeners that span the entire application lifetime.

- **`sync.ts` queue writes are correct even pre-start.**  The change-bus
  subscription in `sync.ts` enqueues outbound changes before `syncStart()`
  is called.  This is by design — changes made while offline must be queued
  so they push when connectivity resumes.  The `_started` guard only
  suppresses `syncNow()`, not `queueChange()`.

## Dependency graph

```
                    ┌──────────────┐
                    │  change-bus  │
                    └──────┬───────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ notes.ts │    │ trash.ts │    │ sync.ts  │
    │ (model)  │    │ (model)  │    │(bridge)  │
    └────┬─────┘    └────┬─────┘    └──┬───┬───┘
         │               │             │   │
         ▼               ▼             ▼   ▼
    ┌──────────────────────────┐   ┌──────────┐
    │          db.ts           │   │  api.ts  │
    │  ┌────────────────────┐  │   └──────────┘
    │  │ getUsername() from │  │
    │  │ auth.ts (ambient)  │  │
    │  └────────────────────┘  │
    └──────────────────────────┘
```
