# Multi-Instance Hosting Plan

## Problem

An SPA and its PHP backend live in a directory tree with relative paths
(`spa/`, `api/`, `data/`).  Copying the tree to a different URL path on
the same origin (e.g. `/app1/` and `/app2/`) should produce two
independent instances, but **browser storage APIs are scoped per origin,
not per path**.  The two instances collide on:

| Storage            | Key / name                    | Impact                     |
|--------------------|-------------------------------|----------------------------|
| IndexedDB          | `notes-app`                   | **Critical** — data bleed  |
| localStorage       | `notes_sync_revision`         | **High** — sync corruption |
| Cookie             | `refresh_token` (Path=`/`)    | **High** — cross-logout    |
| BroadcastChannel   | `leaf-notes-cross-tab`        | Medium — UI churn          |
| Cache API (SW)     | `leaf-v3`                     | Low — install race         |
| JWT secret         | `api/config.php`              | Deployment hazard          |

---

## Solution overview

**Namespace every origin-scoped identifier by the instance's install
path.**  The namespace is derived once at boot from `location.pathname`
(in the SPA) and `$_SERVER['SCRIPT_NAME']` or a config constant (in
PHP).  An instance at the domain root (single-instance deployment)
produces an empty namespace, preserving 100 % backward compatibility.

---

## 1.  Namespace derivation

### 1.1  SPA side — `src/ts/config.ts` (new file)

At boot, the SPA computes the **application root path** — the directory
that contains `index.html`.  From that it derives a **namespace slug**:

```
App path                   → namespace
──────────────────────────────────────────
/                          → ""           (backward compatible)
/app1/spa/                 → "app1-spa"
/notes/work/               → "notes-work"
/sub/deep/path/            → "sub-deep-path"
```

The namespace is produced by:
1. Taking `location.pathname`
2. Stripping any filename (`index.html`, `sw.js`) so we have a clean
   directory path
3. Trimming leading and trailing slashes
4. Replacing remaining `/` with `-`
5. If the result is empty (root deployment), return `""`

The module exports:
- `getInstallPath(): string` — the clean directory path (for cookie
  path, API URL, etc.)
- `getNamespace(): string` — the slug for storage keys
- `getApiBaseUrl(): string` — computed as `getInstallPath() + '/../api/'`
  (replaces the hardcoded `'../api/'` constants in `auth.ts` and
  `sync.ts`)
- `apiUrl(endpoint): string` — convenience: `getApiBaseUrl() + endpoint`
- `loadConfig(): Promise<void>` — called at boot; performs the
  derivation and logs the result

### 1.2  PHP side — `api/config.php`

Add a new optional define:

```php
// Cookie path for the refresh_token cookie.
// Default: derived from SCRIPT_NAME (the directory containing api/).
// Override for custom deployments.
define('COOKIE_PATH', dirname($_SERVER['SCRIPT_NAME'] ?? '/') . '/../spa/');
```

This scopes the refresh-token cookie to the instance's URL path instead
of `/`.

---

## 2.  SPA changes (source in `src/ts/`)

### 2.1  `db.ts` — namespaced IndexedDB

**Current:** `super('notes-app')`

**Change:** import the namespace and use it:

```ts
import { getNamespace } from './config.js';

class NotesDatabase extends Dexie {
  constructor() {
    const ns = getNamespace();
    super(ns ? `notes-app-${ns}` : 'notes-app');
    // ...
```

Backward compatible: root deployments still use `notes-app`.

### 2.2  `sync.ts` — namespaced localStorage key

**Current:** `const REVISION_KEY = 'notes_sync_revision';`

**Change:** suffix with namespace:

```ts
import { getNamespace } from './config.js';

const NS = getNamespace();
const REVISION_KEY = NS
  ? `notes_sync_revision:${NS}`
  : 'notes_sync_revision';
```

Also replace the hardcoded `SYNC_URL`:

```ts
// Was: const SYNC_URL = '../api/sync.php';
import { apiUrl } from './config.js';
const SYNC_URL = apiUrl('sync.php');
```

### 2.3  `auth.ts` — namespaced API URL

**Current:** `const AUTH_URL = '../api/auth.php';`

**Change:**

```ts
import { apiUrl } from './config.js';
const AUTH_URL = apiUrl('auth.php');
```

No other changes needed — tokens are in JS memory only.

### 2.4  `cross-tab.ts` — namespaced BroadcastChannel

**Current:** `const CHANNEL_NAME = 'leaf-notes-cross-tab';`

**Change:**

```ts
import { getNamespace } from './config.js';

const NS = getNamespace();
const CHANNEL_NAME = NS
  ? `leaf-notes-cross-tab:${NS}`
  : 'leaf-notes-cross-tab';
```

### 2.5  `app.ts` — call `loadConfig()` at boot

In the `boot()` function, call `loadConfig()` **before** any other
initialization:

```ts
import { loadConfig } from './config.js';

async function boot(): Promise<void> {
  await loadConfig();   // must be first — derives namespace
  // ... rest of boot sequence
```

### 2.6  `spa/sw.js` — namespaced Cache API cache name

**Current:** `const CACHE = 'leaf-v3';`

**Change:** derive from the SW's own path (it already computes `BASE`):

```js
const BASE  = self.location.pathname.replace(/\/sw\.js$/, '');
const CACHE = 'leaf-v3:' + BASE.replace(/^\/|\/$/g, '').replace(/\//g, '-') || 'root';
```

This keeps the cache per-instance, avoiding the install-time race.

### 2.7  `spa/manifest.json` — no changes needed

`start_url: "./"` is already relative and resolves correctly per
instance.  The `scope` defaults to the manifest's directory.

---

## 3.  PHP changes

### 3.1  `api/config.php` — add `COOKIE_PATH`

```php
// ── Cookie path — scopes refresh_token to this instance ─────────────────
// Derived automatically from SCRIPT_NAME.  Override for CDN or reverse-proxy
// setups where the URL path differs from the filesystem path.
define('COOKIE_PATH',
    rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/') . '/../spa/');
```

### 3.2  `api/auth.php` — use `COOKIE_PATH`

**Current (set_refresh_cookie):**
```php
header(sprintf(
    'Set-Cookie: refresh_token=%s; Path=/; Expires=%s; HttpOnly; SameSite=Strict%s',
    ...
));
```

**Change:** Replace `Path=/` with `Path=' . COOKIE_PATH . '`:

```php
header(sprintf(
    'Set-Cookie: refresh_token=%s; Path=%s; Expires=%s; HttpOnly; SameSite=Strict%s',
    rawurlencode($token),
    COOKIE_PATH,
    ...
));
```

**Current (clear_refresh_cookie):**
```php
header('Set-Cookie: refresh_token=; Path=/; Expires=...');
```

**Change:** Same — replace `Path=/` with the scoped path.

### 3.3  `api/config.php-sample` — mirror the changes

Add the `COOKIE_PATH` define and document it.  **Always update the
sample when changing `config.php`** (per CLAUDE.md project convention).

---

## 4.  Deployment guide

### 4.1  Single instance (default, backward compatible)

No changes needed.  Namespace is empty for root deployments; cookie path
is `/`.  Everything works exactly as before.

### 4.2  Multiple instances on the same origin

**Directory layout:**

```
/var/www/
├── instance1/
│   ├── spa/        ← SPA files (identical across instances)
│   ├── api/        ← PHP files (identical, except config.php)
│   └── data/       ← instance1's notes, users, changelog
├── instance2/
│   ├── spa/
│   ├── api/        ← with unique config.php
│   └── data/       ← instance2's notes, users, changelog
```

**Web server config (nginx example):**

```nginx
server {
    listen 443 ssl;
    server_name example.com;

    # Instance 1
    location /app1/spa/ {
        alias /var/www/instance1/spa/;
        try_files $uri $uri/ /app1/spa/index.html;
    }
    location /app1/api/ {
        alias /var/www/instance1/api/;
        # PHP-FPM handling
        fastcgi_pass unix:/run/php/php-fpm.sock;
        fastcgi_param SCRIPT_FILENAME /var/www/instance1/api/$fastcgi_script_name;
        include fastcgi_params;
    }

    # Instance 2
    location /app2/spa/ {
        alias /var/www/instance2/spa/;
        try_files $uri $uri/ /app2/spa/index.html;
    }
    location /app2/api/ {
        alias /var/www/instance2/api/;
        fastcgi_pass unix:/run/php/php-fpm.sock;
        fastcgi_param SCRIPT_FILENAME /var/www/instance2/api/$fastcgi_script_name;
        include fastcgi_params;
    }
}
```

**Per-instance checklist:**

1. Generate a unique `JWT_SECRET` for each instance:
   ```bash
   php -r "echo bin2hex(random_bytes(32));"
   ```
2. Set a unique admin user for each instance:
   ```bash
   php api/adduser.php <username> <password>
   ```
3. Verify `CORS_ALLOW_POLICY` if tightening from `*`.
4. The `COOKIE_PATH` define in `config.php` auto-derives from
   `SCRIPT_NAME` — verify it resolves correctly (e.g.
   `/app1/spa/`) or override manually.

### 4.3  Alternative: subdomain isolation (no code changes needed)

If each instance gets its own subdomain, all origin-scoped storage is
automatically isolated:

- `https://app1.example.com/spa/`
- `https://app2.example.com/spa/`

This requires **zero code changes** — different origins, different
storage, different cookies.  The namespacing approach is only needed
when multiple instances share the same origin (same host:port).

---

## 5.  Affected files summary

| File                  | Change                                              |
|-----------------------|-----------------------------------------------------|
| `src/ts/config.ts`    | **New** — namespace derivation, API URL helpers      |
| `src/ts/db.ts`        | Namespace the Dexie database name                    |
| `src/ts/sync.ts`      | Namespace localStorage key + use apiUrl()            |
| `src/ts/auth.ts`      | Use apiUrl() instead of hardcoded relative path       |
| `src/ts/cross-tab.ts` | Namespace BroadcastChannel name                      |
| `src/ts/app.ts`       | Call loadConfig() at boot                            |
| `spa/sw.js`           | Namespace Cache API cache name                       |
| `api/config.php`      | Add `COOKIE_PATH` define                             |
| `api/config.php-sample` | Mirror config.php changes                          |
| `api/auth.php`        | Use `COOKIE_PATH` for refresh_token cookie           |
| `plan.md`             | This file                                            |

---

## 6.  Testing considerations

### 6.1  Unit tests (`tests/spa/`)

- Verify `getNamespace()` returns expected slugs for various paths
- Verify `apiUrl()` builds correct URLs
- Existing Dexie and sync tests should pass unchanged (root namespace)

### 6.2  Integration tests (`tests/integration/`)

- Deploy two instances at different paths (e.g. `/test1/` and `/test2/`)
- Verify each has isolated IndexedDB data
- Verify login on instance A does not authenticate instance B
- Verify saving a note on instance A does not appear in instance B's
  sidebar

### 6.3  Manual smoke test

1. Deploy two instances side-by-side
2. Log into instance A, create a note, log out
3. Visit instance B — should show login screen (not instance A's data)
4. Log into instance B — should have empty note list
5. Log back into instance A — should still have the note

---

## 7.  Migration note

Existing users upgrading to this version:

- **Root deployments** (`/`): no migration — namespace is empty,
  database and localStorage keys are unchanged.
- **Already at a non-root path before this change**: the namespace was
  previously empty, so existing IndexedDB data and localStorage will
  appear "lost" after the upgrade.  This is acceptable because
  multi-instance hosting wasn't supported before — users at non-root
  paths were already sharing storage with root, which was buggy.
  A fresh start is the correct behavior.
