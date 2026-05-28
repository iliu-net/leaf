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
