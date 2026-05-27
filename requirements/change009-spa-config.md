# SPA Config Support

## New files

| File | Purpose |
|---|---|
| `src/php/spa-config.php` | Reads `$spa_config` from `config.php`, outputs JSON. Degrades to `{}` if undefined. Sets CORS and Content-Type headers. |

## Modified files

| File | Change |
|---|---|
| `api/config.php` | Add `$spa_config` array with `markdown.html` default `false` |
| `api/config.php-sample` | Same — keep samples in sync |
| `src/php/router.php` | Add `'spa-config'` route → `require $sharedDir . 'spa-config.php'` |
| `src/ts/config.ts` | Add `SpaConfig` interface, `fetchSpaConfig()`, `getSpaConfig()`, localStorage cache with namespace-prefixed key |

## PHP handler (`src/php/spa-config.php`)

```php
header('Access-Control-Allow-Origin: ' . CORS_ALLOW_POLICY);
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Content-Type: application/json');
echo json_encode($spa_config ?? (object)[]);
```

- Uses `CORS_ALLOW_POLICY` from `config.php` (already loaded)
- `$spa_config ?? (object)[]` — safe upgrade path: existing deployments without the array return `{}` (empty object, not empty array)

## Client config type (`src/ts/config.ts`)

```typescript
export interface SpaConfig {
  markdown: {
    html: boolean;
  };
}
```

## Client cache strategy

- **localStorage key**: `${namespace || 'root'}:spa-config` — handles root deployment (empty namespace) cleanly
- **On boot**: `fetchSpaConfig()` fires a GET to the server; on success caches result; on failure falls back to localStorage; if no cache, uses hardcoded safe defaults.  The function catches all errors internally and never throws — a failed fetch is silent.
- **`getSpaConfig()`**: synchronous — returns the in-memory cached config (populated by `fetchSpaConfig` at boot, or defaults)
- **Null-safe access**: consumers use `cfg?.markdown?.html ?? false` — the server may return `{}` if `$spa_config` is missing, so every key path defaults safely
- **Error isolation**: `fetchSpaConfig()` catches all errors internally and never throws — a failed fetch silently keeps whatever is already cached (or defaults)

## Lazy parser creation in `markdown.ts`

The markdown-it instance is NOT created at module load time.  Instead it is
created lazily on first `parse()` call, reading `getSpaConfig()` at that point:

```typescript
let _md: MarkdownIt | null = null;
function getParser(): MarkdownIt {
  if (!_md) {
    const cfg = getSpaConfig();
    const html = cfg?.markdown?.html ?? false;
    _md = new MarkdownIt({ html });
    // register extra inline markup, extension hooks...
  }
  return _md;
}
export function parse(md: string): string { return getParser().render(md); }
```

This avoids any timing dependency — `getSpaConfig()` is always available by the
time a note is actually opened and `parse()` is called.

## Boot ordering (revised)

`fetchSpaConfig()` is a fire-and-forget background fetch — it must NOT block the
app shell from rendering.  The lazy parser means config can arrive anytime before
first note open.

```
boot():
  loadConfig()              // sync  — derives namespace, installPath, apiBaseUrl
  createFileOps()           // sync  — wire file/trash/cross-tab factories
  createTrashOps()
  createCrossTabHandler()
  pwa.initPwa()            // fire-and-forget
  showApp(false)           // ← app shell visible immediately
  fetchSpaConfig()         // ← fire-and-forget, populates cache in background
  tryRestoreSession()      // async
```

If `fetchSpaConfig` has not completed by the time a note is opened and
`markdown.parse()` is called, the parser uses hardcoded safe defaults.  This is
acceptable — at worst the first note renders without raw-HTML passthrough until
the background fetch completes (no visible effect for most notes).

## Flow

```
Boot
  │
  ├── loadConfig()           ← derives namespace, API URL from path
  ├── showApp(false)         ← app shell visible (sidebar, status bar)
  ├── fetchSpaConfig()       ← fire-and-forget, caches in localStorage
  │     ├── online  → GET /api/index.php/spa-config → cache in localStorage
  │     └── offline → read localStorage key "{ns}:spa-config" → use cached or defaults
  │
  └── First note open → markdown.ts lazy-creates parser with getSpaConfig()
```

---

## app.ts refactor

`app.ts` is 539 lines.  Before adding spa-config boot logic, extract three
self-contained sections to their own modules.  Each follows the pattern already
used by `app-auth.ts` (extracted from `app.ts`).

### New files

| File | Extracts | Lines |
|---|---|---|
| `src/ts/app-trash.ts` | `refreshTrashList`, `handleToggleTrash`, `handleTrashPreview`, `handleTrashRestore`, `handleTrashPurge`, `handleTrashEmpty` | 98 |
| `src/ts/app-files.ts` | `refreshList`, `openFile`, `saveFile`, `deleteFile`, `createFile`, `handleRenameClick`, `handleRenameConfirm`, `handleSearch` | 136 |
| `src/ts/app-cross-tab.ts` | `handleCrossTabChange`, `reloadOpenNote`, `reloadOpenNoteAs` | 141 |

### Dependencies

Each extracted module receives its dependencies as function parameters (not
imports), keeping the module testable and avoiding circular imports.
Cross-module calls (e.g. trash → file-list refresh) are passed as callbacks.

```typescript
// app-files.ts
export function createFileOps(deps: {
  store: typeof import('./store.js'),
  ui: typeof import('./ui.js'),
  notes: typeof import('./notes.js'),
  syncNow: () => void,
}) { ... }

// app-trash.ts
export function createTrashOps(deps: {
  store: typeof import('./store.js'),
  ui: typeof import('./ui.js'),
  sidebar: typeof import('./sidebar-chrome.js'),
  refreshList: (selectId?: string | null) => Promise<void>,
}) { ... }

// app-cross-tab.ts
export function createCrossTabHandler(deps: {
  store: typeof import('./store.js'),
  ui: typeof import('./ui.js'),
  notes: typeof import('./notes.js'),
  refreshList: (selectId?: string | null) => Promise<void>,
  refreshTrashList: () => Promise<void>,
  loadTrashEntries: () => Promise<TrashEntry[]>,
}) { ... }
```

In `boot()`, the factories are created in dependency order and wired together:

```typescript
files = createFileOps({ store, ui, notes, syncNow });
trash = createTrashOps({ store, ui, sidebar, refreshList: (id) => files.refreshList(id) });
crossTab = createCrossTabHandler({
  store, ui, notes,
  refreshList: (id) => files.refreshList(id),
  refreshTrashList: () => trash.refreshTrashList(),
  loadTrashEntries,
});
```

### UI event binding

`ui.bindEvents()` runs at module top level, before `boot()` assigns the factory
instances.  To avoid dereferencing undefined variables, handler references use
arrow closures that resolve at call time:

```typescript
ui.bindEvents({
  onOpen:  id => files.openFile(id),       // not: files.openFile
  onSave:  () => files.saveFile(),         // not: files.saveFile
  ...
});
```

### After refactor

`app.ts` drops from 539L to 273L, containing only:
- Boot sequence + factory wiring (`boot`, `showApp`, `showLogin`)
- Store subscriptions (3L)
- Sync status → UI wiring (21L)
- UI event binding (15L) — wires handlers from the extracted modules
- PWA + history button wiring (40L)

### Impact on this plan

The spa-config change touches only `boot()` (1 line).  The refactor is applied
alongside the spa-config changes — it does not block or depend on spa-config.

### Demo instance

Not tracked in git — ignored for now.  The main instance config files cover the
pattern; demo instance can be updated separately when needed.

## Added keys (change012)

Two additional keys were added to `$spa_config` for client-side configuration.
The `spa-config.php` handler passes them through unchanged — no handler changes needed.

### `deleted_notes_ttl_days`

| Config file | Value |
|---|---|
| `api/config.php-sample` | `7` |
| `api/config.php` | `7` |
| `demo/cookbook/api/config.php-sample` | `7` |
| `demo/cookbook/api/config.php` | `7` |
| `tests/integration/config.php` | `7` |

Tells the SPA how many days to keep deleted notes visible in the trash before
purging them client-side.  Defaults to 7 days.  This is separate from the
server-side `DELETED_NOTE_TTL_DAYS` constant (default 30 days), allowing the
client to be stricter than the server.

### `timestamp_format`

| Config file | Value |
|---|---|
| `api/config.php-sample` | `null` |
| `api/config.php` | `null` |
| `demo/cookbook/api/config.php-sample` | `null` |
| `demo/cookbook/api/config.php` | `'YYYY-MM-DD HH:mm'` |
| `tests/integration/config.php` | `null` |

Arbitrary format string for the SPA to use when displaying dates and times.
`null` means the client chooses its own default (typically the browser locale).
The demo cookbook instance sets `"YYYY-MM-DD HH:mm"` (24-hour, dayjs-compatible).
