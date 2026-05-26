# Single PHP Entry Point & Shared SPA

## Problem

Currently the SPA accesses the backend by calling individual PHP files directly:

- `api/auth.php?action=login`
- `api/auth.php?action=refresh`
- `api/auth.php?action=logout`
- `api/sync.php`
- `api/trash.php` (future SPA use)

Each handler does `require_once __DIR__ . '/config.php'` to pull in
dependencies.  When deploying multiple instances (per
`change003-multi-tenant.md`), the **entire** `api/` directory — 10 PHP
files — and the **entire** `spa/` directory must be copied to each
instance even though they're identical across instances.  Only
`config.php` actually differs.

---

## Solution overview

Two changes that together produce a single-copy deployment model:

### 1. Front controller: `api/index.php`

A single entry point replaces all the individual PHP endpoints.  It loads
the per-instance `config.php`, determines the shared code directory, then
hands off to the shared router:

- `api/index.php/auth?action=login`  (was `api/auth.php?action=login`)
- `api/index.php/sync`               (was `api/sync.php`)
- `api/index.php/trash`              (was `api/trash.php`)

`index.php` itself is a pure bootstrap — ~5 lines of code.  All routing
logic lives in `src/php/router.php`.

Naming it `index.php` avoids the redundant `api/api.php` and allows clean
URLs (`api/auth`) with standard server config (mod_dir + AcceptPathInfo).

### 2. Shared SPA via symlink

The built `spa/` directory is a static artefact — identical for every
instance.  Instead of copying it, each instance symlinks to a single
shared copy.

### Deployment result

```
                     SHARED (one copy)           PER INSTANCE
                     ─────────────────           ────────────
PHP handlers:        src/php/*.php               api/index.php
                                                 api/adduser.php
                                                 api/config.php

SPA:                 built spa/                  spa/ → symlink

Data:                                           data/ (notes, users, changelog)
```

Before: ~80 KB copied per instance (10 PHP + built SPA).
After:  ~3 KB per instance (3 small files + 1 symlink).

---

## Directory structure after change

```
leaf/                              ← repo root
├── api/                           ← per-instance (3 files)
│   ├── index.php                  ← front controller        (NEW)
│   ├── adduser.php                ← thin CLI wrapper         (NEW)
│   ├── config.php                 ← per-instance config      (kept)
│   └── config.php-sample          ← template                 (kept)
│
├── src/
│   ├── php/                       ← shared PHP handlers   (NEW dir)
│   │   ├── router.php             ← request dispatcher     (NEW)
│   │   ├── auth.php               ← moved from api/, config require removed
│   │   ├── sync.php               ← moved from api/
│   │   ├── trash.php              ← moved from api/
│   │   ├── auth_guard.php         ← moved from api/, config require removed
│   │   ├── storage.php            ← moved from api/, config require removed
│   │   ├── jwt.php                ← moved from api/, config require removed
│   │   ├── users.php              ← moved from api/, config require removed
│   │   ├── audit.php              ← moved from api/, config require removed
│   │   └── adduser_impl.php       ← moved from api/adduser.php, guard removed
│   │
│   └── ts/                        ← SPA source
│       ├── config.ts              ← MODIFIED: apiUrl() uses index.php/
│       ├── auth.ts                ← MODIFIED: 'auth.php' → 'auth'
│       └── sync.ts                ← MODIFIED: 'sync.php' → 'sync'
│
├── spa/                           ← built SPA (unchanged)
├── data/                          ← per-instance data (unchanged)
└── tests/
    ├── php/bootstrap.php          ← MODIFIED: paths to src/php/
    └── integration/
        ├── run.sh                 ← MODIFIED: layout + symlinks
        ├── test_auth.sh           ← MODIFIED: URLs
        └── test_sync.sh           ← MODIFIED: URLs
```

---

## How routing works

`index.php` loads config, sets `$sharedDir`, then includes
`src/php/router.php`.  The router determines the endpoint from the URL
path and dispatches to the matching handler.

### PATH_INFO (primary mechanism)

| Request URL                          | SCRIPT_NAME              | PATH_INFO  | → Route     |
|--------------------------------------|--------------------------|------------|-------------|
| `/api/auth?action=login`             | `/api/index.php`         | `/auth`    | `auth`      |
| `/api/index.php/auth?action=login`   | `/api/index.php`         | `/auth`    | `auth`      |
| `/api/sync`                          | `/api/index.php`         | `/sync`    | `sync`      |
| `/api/index.php/sync`                | `/api/index.php`         | `/sync`    | `sync`      |

Apache sets PATH_INFO automatically (AcceptPathInfo, default On).
PHP's built-in server sets it for `index.php/endpoint` URLs.

### REQUEST_URI fallback

For servers where PATH_INFO is unset (some nginx configs), `router.php`
falls back to parsing `REQUEST_URI` relative to `SCRIPT_NAME`:

```
REQUEST_URI  = /app1/api/index.php/sync
SCRIPT_NAME  = /app1/api/index.php
→ endpoint   = /sync  →  route = sync
```

### Clean URLs (optional, server-side only)

To use `api/auth` instead of `api/index.php/auth`, the web server must
route directory requests to `index.php`.  Apache does this by default
(mod_dir).  For nginx:

```nginx
location /api/ {
    try_files $uri $uri/ /api/index.php$uri?$args;
}
```

`index.php` + `router.php` handle both PATH_INFO (clean URL) and
REQUEST_URI (explicit URL) — no code change needed on either side.

---

## Changes — detailed

### 1. Create `src/php/` directory

```bash
mkdir -p src/php
```

### 2. Move handler files: `api/` → `src/php/`

| From `api/`            | To `src/php/`          | Notes                       |
|------------------------|------------------------|-----------------------------|
| `auth.php`             | `auth.php`             | remove config require       |
| `sync.php`             | `sync.php`             | (no config require to remove)|
| `trash.php`            | `trash.php`            |                             |
| `auth_guard.php`       | `auth_guard.php`       | remove config require       |
| `storage.php`          | `storage.php`          | remove config require       |
| `jwt.php`              | `jwt.php`              | remove config require       |
| `users.php`            | `users.php`            | remove config require       |
| `audit.php`            | `audit.php`            | remove config require       |
| `adduser.php`          | `adduser_impl.php`     | remove config require + CLI guard |

Files **kept** in `api/`: `config.php`, `config.php-sample`

### 3. Remove `require_once … config.php` from moved files

Config is loaded by the entry point (`index.php` or `adduser.php`)
*before* any handler is included.  Each moved file that had
`require_once __DIR__ . '/config.php';` must have that line **removed**.

| File               | Line | Statement to remove                     |
|--------------------|------|-----------------------------------------|
| `auth.php`         | 28   | `require_once __DIR__ . '/config.php';` |
| `auth_guard.php`   | 21   | `require_once __DIR__ . '/config.php';` |
| `jwt.php`          | 16   | `require_once __DIR__ . '/config.php';` |
| `users.php`        | 24   | `require_once __DIR__ . '/config.php';` |
| `storage.php`      | 65   | `require_once __DIR__ . '/config.php';` |
| `audit.php`        | 47   | `require_once __DIR__ . '/config.php';` |
| `adduser_impl.php` | 29   | `require_once __DIR__ . '/config.php';` |

**Also remove the CLI guard from `adduser_impl.php`** (lines 23-27,
the `php_sapi_name() !== 'cli'` check).  The wrapper `api/adduser.php`
handles HTTP blocking and config loading.  The shared impl file contains
only the business logic.

**Internal `require_once` paths stay unchanged.**  Since all shared files
live in the same `src/php/` directory, `require_once __DIR__ . '/jwt.php'`
etc. resolve correctly.  This includes `adduser_impl.php` → `users.php`
(line 163, for the `check` command).

### 4. Create `api/index.php` — pure bootstrap

`index.php` does exactly three things: load config, set `$sharedDir`,
require the router.  No routing logic lives here — it's a thin bridge
between the per-instance config and the shared codebase.

```php
<?php
/**
 * index.php — single entry point for all API requests
 *
 * Loads the per-instance configuration, determines the shared code
 * directory, then delegates to the shared router.
 *
 * This file is the only PHP file that differs per instance (besides
 * config.php).  All request handling logic lives in src/php/.
 */

require_once __DIR__ . '/config.php';

$sharedDir = dirname(__DIR__) . '/src/php/';

require $sharedDir . 'router.php';
```

### 5. Create `src/php/router.php` — request dispatcher

The router determines the endpoint from the URL and dispatches to the
matching handler.  All routing logic is centralised here; adding a new
endpoint only requires a new `case` — no changes to per-instance files.

```php
<?php
/**
 * router.php — request dispatcher
 *
 * Determines the endpoint from the request URL and dispatches to the
 * matching handler.  Called by api/index.php after config is loaded and
 * $sharedDir is set.
 *
 * Expects $sharedDir to be defined (the absolute path to src/php/).
 */

// ── Determine the endpoint ───────────────────────────────────────────────

$endpoint = '';

$pathInfo = $_SERVER['PATH_INFO'] ?? '';

if ($pathInfo !== '') {
    $endpoint = ltrim($pathInfo, '/');
} else {
    $scriptName = $_SERVER['SCRIPT_NAME'] ?? '';
    $requestUri = $_SERVER['REQUEST_URI'] ?? '';

    $qpos = strpos($requestUri, '?');
    $pathOnly = $qpos !== false ? substr($requestUri, 0, $qpos) : $requestUri;

    if (!str_ends_with($pathOnly, '.php')) {
        $endpoint = substr($pathOnly, strlen($scriptName));
        $endpoint = ltrim($endpoint, '/');
    }
}

// ── Route to handler ─────────────────────────────────────────────────────

$parts = explode('/', $endpoint, 2);
$route = $parts[0] ?? '';

switch ($route) {
    case 'auth':
        require $sharedDir . 'auth.php';
        break;
    case 'sync':
        require $sharedDir . 'sync.php';
        break;
    case 'trash':
        require $sharedDir . 'trash.php';
        break;
    default:
        http_response_code(404);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Endpoint not found']);
        break;
}
```

### 6. Create `api/adduser.php` — thin CLI wrapper

```php
<?php
/**
 * adduser.php — htpasswd user management tool
 *
 * Thin per-instance wrapper: loads config, blocks HTTP access, then
 * delegates to the shared implementation.
 *
 * Usage:
 *   php api/adduser.php add    <username> <password>
 *   php api/adduser.php delete <username>
 *   php api/adduser.php list
 *   php api/adduser.php check  <username> <password>
 */

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    echo "CLI only\n";
    exit(1);
}

require_once __DIR__ . '/config.php';
require_once dirname(__DIR__) . '/src/php/adduser_impl.php';
```

### 7. Update SPA — `src/ts/config.ts`

```ts
export function apiUrl(endpoint: string): string {
  return _apiBaseUrl + 'index.php/' + endpoint;
}
// apiUrl('auth')  →  "../api/index.php/auth"
// apiUrl('sync')  →  "../api/index.php/sync"
```

### 8. Update SPA callers

| File       | Current                     | New                  |
|------------|-----------------------------|----------------------|
| `auth.ts`  | `apiUrl('auth.php')` (L39)  | `apiUrl('auth')`     |
| `sync.ts`  | `apiUrl('sync.php')` (L62)  | `apiUrl('sync')`     |

### 9. Update `tests/php/bootstrap.php`

```php
// Was:
$apiDir = __DIR__ . '/../../api';
@require_once $apiDir . '/jwt.php';
@require_once $apiDir . '/storage.php';
@require_once $apiDir . '/users.php';

// New:
$phpDir = __DIR__ . '/../../src/php';
@require_once $phpDir . '/jwt.php';
@require_once $phpDir . '/storage.php';
@require_once $phpDir . '/users.php';
```

### 10. Update integration tests

#### 10.1 `tests/integration/run.sh`

```bash
# Copy per-instance files only
cp "$ROOT_DIR"/api/index.php   "$ENV_DIR/"
cp "$ROOT_DIR"/api/adduser.php "$ENV_DIR/"
cp "$SCRIPT_DIR/config.php"    "$ENV_DIR/config.php"

# Symlink shared code (both PHP and SPA) — mirrors production layout
ln -s "$ROOT_DIR"/src "$ENV_DIR/src"
ln -s "$ROOT_DIR"/spa "$ENV_DIR/spa"

# Data directories
mkdir -p "$ENV_DIR/data"/notes

# Add test user
php "$ENV_DIR/adduser.php" add testuser test1234 > /dev/null
```

Test environment layout:
```
$ENV_DIR/
├── index.php         ← per-instance front controller
├── adduser.php       ← per-instance CLI wrapper
├── config.php        ← test config
├── src/  → ../src    ← symlink to shared PHP
├── spa/  → ../spa    ← symlink to shared SPA
└── data/             ← test data
```

#### 10.2 `tests/integration/test_auth.sh`

All `auth.php?action=X` → `index.php/auth?action=X` (8 occurrences).

#### 10.3 `tests/integration/test_sync.sh`

`$BASE/auth.php?action=login` → `$BASE/index.php/auth?action=login`
`$BASE/sync.php` → `$BASE/index.php/sync` (~20 occurrences)

### 11. Update `api/config.php-sample` — header only

```php
<?php
/**
 * config.php — per-instance environment configuration
 *
 * This is one of only three files in the api/ directory.  The others are
 * index.php (front controller) and adduser.php (CLI user management).
 * All shared handler code lives in src/php/.  The SPA lives in spa/ and
 * is symlinked from a shared build.
 *
 * ... (rest unchanged)
 */
```

### 12. Update `requirements/change003-multi-tenant.md`

The deployment section currently shows copying all of `api/` and `spa/`
per instance.  Update to reflect the new model: `api/` contains only the
3 per-instance files; `src/php/` and `spa/` are shared (deployed once or
symlinked).

---

## Deployment layout

### Single instance (repo deployed as-is)

```
/var/www/leaf/
├── api/
│   ├── index.php        ← front controller
│   ├── adduser.php      ← CLI user management
│   ├── config.php       ← unique JWT_SECRET
│   └── config.php-sample
├── src/php/             ← shared handlers + router
├── spa/                 ← built SPA
└── data/                ← notes, users, changelog
```

### Multiple instances — everything shared via symlinks

```
/var/www/
├── shared/
│   ├── php/             ← src/php/ from repo (one copy)
│   └── spa/             ← built spa/ from repo (one copy)
│
├── instance1/
│   ├── api/
│   │   ├── index.php
│   │   ├── adduser.php
│   │   └── config.php   ← unique JWT_SECRET
│   ├── src/  → ../../shared/php/     ← symlink
│   ├── spa/  → ../../shared/spa/     ← symlink
│   └── data/
│
├── instance2/
│   ├── api/
│   │   ├── index.php
│   │   ├── adduser.php
│   │   └── config.php   ← different JWT_SECRET
│   ├── src/  → ../../shared/php/     ← symlink
│   ├── spa/  → ../../shared/spa/     ← symlink
│   └── data/
```

Each instance has only 3 real files in `api/` + 2 symlinks + its own
`data/` directory.  Upgrading the app means replacing the shared `php/`
and `spa/` directories once — all instances pick up the change.

### Deploy script sketch

```bash
#!/usr/bin/env bash
# deploy-instance.sh <name> <jwt-secret>
NAME=$1; SECRET=$2
BASE=/var/www/$NAME

mkdir -p "$BASE"/api "$BASE"/data/notes

# Per-instance files
cp templates/index.php    "$BASE/api/"
cp templates/adduser.php  "$BASE/api/"

# Generate config from template + secret
sed "s/CHANGE_ME/$SECRET/" templates/config.php > "$BASE/api/config.php"

# Symlink shared code
ln -s /var/www/shared/php "$BASE/src"
ln -s /var/www/shared/spa "$BASE/spa"

echo "Instance $NAME ready at /$NAME/spa/"
```

---

## Backward compatibility

**None.**  Old URLs (`auth.php`, `sync.php`) return 404.  The SPA and
server layout must be updated together.  Since this is a bundled
single-user app, the update is atomic from the user's perspective.

---

## Affected files summary

| File                              | Change                                     |
|-----------------------------------|--------------------------------------------|
| `src/php/` (new dir)              | **Create** — shared handler code            |
| `src/php/router.php`              | **New** — request dispatcher                |
| `src/php/auth.php`                | **Moved** from `api/`, remove config require|
| `src/php/sync.php`                | **Moved** from `api/`                       |
| `src/php/trash.php`               | **Moved** from `api/`                       |
| `src/php/auth_guard.php`          | **Moved** from `api/`, remove config require|
| `src/php/storage.php`             | **Moved** from `api/`, remove config require|
| `src/php/jwt.php`                 | **Moved** from `api/`, remove config require|
| `src/php/users.php`               | **Moved** from `api/`, remove config require|
| `src/php/audit.php`               | **Moved** from `api/`, remove config require|
| `src/php/adduser_impl.php`        | **Moved** from `api/adduser.php`            |
| `api/index.php`                   | **New** — pure bootstrap (5 lines)          |
| `api/adduser.php`                 | **New** — thin CLI wrapper                  |
| `api/auth.php` etc. (8 files)     | **Removed** (moved to `src/php/`)           |
| `api/config.php-sample`           | **Modified** — header comment               |
| `src/ts/config.ts`                | **Modified** — `apiUrl('X')` → `index.php/X`|
| `src/ts/auth.ts`                  | **Modified** — arg `'auth.php'` → `'auth'`  |
| `src/ts/sync.ts`                  | **Modified** — arg `'sync.php'` → `'sync'`  |
| `tests/php/bootstrap.php`         | **Modified** — paths to `src/php/`          |
| `tests/integration/run.sh`        | **Modified** — copy 3 files + 2 symlinks    |
| `tests/integration/test_auth.sh`  | **Modified** — URL pattern                  |
| `tests/integration/test_sync.sh`  | **Modified** — URL pattern                  |
| `requirements/change003-*.md`     | **Modified** — deployment section           |

---

## Testing checklist

- [ ] PHPUnit: `cd tests/php && php ../vendor/bin/phpunit`
- [ ] Integration: `bash tests/integration/run.sh`
- [ ] Login via `index.php/auth?action=login`
- [ ] Sync via `index.php/sync`
- [ ] `php api/adduser.php add test test1234` works
- [ ] Old URLs (`auth.php`, `sync.php`) return 404
- [ ] `config.php-sample` header updated
- [ ] Multi-instance: symlink layout works, data isolated
