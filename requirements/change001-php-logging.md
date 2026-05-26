# Audit Log — Implementation Plan

## Overview

Add an append-only audit log to the PHP backend that records:

1. **User authentications** — login (success & failure), token refresh, logout
2. **Note access** — read, write (create/update), delete, rename

Each entry records who did what and when, with note ID + version for note events.

---

## Storage Design: Monthly JSONL Files

Rather than a single monolithic file with a line-scanning purge, audit entries are written to **monthly files**:

```
data/audit-2026-05.jsonl    ← current month (appends go here)
data/audit-2026-04.jsonl
data/audit-2026-03.jsonl
```

- Filename derived from `gmdate('Y-m')` at write time
- Append with `flock(LOCK_EX)` — safe under concurrent requests
- **Purging is atomic** — `unlink()` the whole file, no read-rewrite needed
- Natural rotation — filename *is* the timestamp
- Queryable with `cat data/audit-*.jsonl | jq '...'`

---

## New File: `api/audit.php`

Shared logging utility. Every endpoint that logs requires it.

### Public API

```php
require_once __DIR__ . '/audit.php';

audit_log(string $event, array $data): void
```

- `$event` — one of the event type constants (see below)
- `$data` — additional key/value pairs merged into the entry (e.g. `user`, `note_id`, `version`)

`ts` (timestamp) and `ip` (when `AUDIT_LOG_IPS` is true) are added automatically.

### Dev-Server Detection

```
PHP_SAPI === 'cli-server'
```

When running under PHP's built-in dev server (`php -S`):

- Entry is **also written to STDERR** with a timestamp prefix that matches PHP's own log format
- Entry is **still written to the monthly file** (so the file code path is exercised during development)

In production (Apache / nginx / php-fpm): file only.

### Internal Logic

```php
function audit_log(string $event, array $data = []): void {
    // Build entry
    $entry = ['ts' => time(), 'event' => $event] + $data;
    if (AUDIT_LOG_IPS) {
        $entry['ip'] = $_SERVER['REMOTE_ADDR'] ?? 'cli';
    }

    $line = json_encode($entry, JSON_UNESCAPED_UNICODE) . "\n";

    // Dev server: mirror to stderr
    if (PHP_SAPI === 'cli-server') {
        $prefix = '[' . gmdate('D M d H:i:s Y') . '] AUDIT: ';
        fwrite(STDERR, $prefix . $line);
    }

    // Always write to the monthly file
    $file = DATA_ROOT . 'audit-' . gmdate('Y-m') . '.jsonl';
    $fh = fopen($file, 'a');
    if (!$fh) return;
    flock($fh, LOCK_EX);
    fwrite($fh, $line);
    flock($fh, LOCK_UN);
    fclose($fh);
}
```

---

## Config Additions (`api/config.php`)

Two new constants:

```php
// ── Audit log ───────────────────────────────────────────────────────────────
define('AUDIT_RETENTION_DAYS', 90);   // Monthly files older than this are deleted
define('AUDIT_LOG_IPS',       true);  // Include $_SERVER['REMOTE_ADDR'] in entries
```

---

## Purge Mechanism

The existing daily purge hook in `sync.php` (currently purges expired tombstones) gains a second step:

```
audit_purge(): int
```

- `glob(DATA_ROOT . 'audit-*.jsonl')`
- Parse `YYYY-MM` from each filename
- If the *last day* of that month + `AUDIT_RETENTION_DAYS` is in the past → `unlink()`
- Returns count of files removed

Called once per day alongside `storage_purge_deleted_notes()`.

---

## Event Types & Call Sites

### Entry Schema

Every line in the audit file is a JSON object:

```json
{"ts":1716163200,"event":"NOTE_WRITE","user":"alice","note_id":"welcome","version":"2026-05-26:1:alice","ip":"192.168.1.1"}
```

| Field | When present | Description |
|-------|-------------|-------------|
| `ts` | Always | Unix timestamp (server time, UTC) |
| `event` | Always | Event type string |
| `user` | Always | Authenticated username (or attempted username for login failures) |
| `ip` | When `AUDIT_LOG_IPS=true` | `$_SERVER['REMOTE_ADDR']` |
| `note_id` | Note events only | Note identifier |
| `version` | Note read/write only | Version key written or read |
| `renamed_to` | Note rename only | New note identifier after rename |

### Auth Events (`api/auth.php`)

| Event | Trigger | Call site | Data |
|-------|---------|-----------|------|
| `AUTH_LOGIN` | Successful login | After `issue_access_token()` succeeds | `['user' => $valid]` |
| `AUTH_LOGIN_FAIL` | Failed login | Before the `sleep()` + `respond()` | `['user' => $username]` (the attempted username) |
| `AUTH_REFRESH` | Token refresh | After issuing new access + refresh tokens | `['user' => $username]` |
| `AUTH_LOGOUT` | Logout | Before clearing cookie + responding | `['user' => $username]` *only if a valid refresh token was presented* |

### Note Events (`api/sync.php`)

| Event | Trigger | Call site | Data |
|-------|---------|-----------|------|
| `NOTE_WRITE` | CREATE or UPDATE applied | In `apply_client_change()`, after changelog append for CREATE/UPDATE | `['user' => $author, 'note_id' => $key, 'version' => $vkey]` |
| `NOTE_DELETE` | DELETE applied | In `apply_client_change()`, after changelog append for DELETE | `['user' => $author, 'note_id' => $key]` |
| `NOTE_RENAME` | RENAME applied | In `apply_client_change()`, after changelog append for RENAME | `['user' => $author, 'note_id' => $key, 'renamed_to' => $new_id]` |
| `NOTE_READ` | Note content delivered in sync response | In the response-building loop, for each non-DELETE change returned to the client | `['user' => $author, 'note_id' => $note_id, 'version' => $current_version]` |

`NOTE_READ` fires for **every** note whose content is included in a sync response, unconditionally (including self-reads). This is analogous to a web server access log — the scale is the same.

---

## Files Changed Summary

| File | Change |
|------|--------|
| `api/config.php` | Add `AUDIT_RETENTION_DAYS` and `AUDIT_LOG_IPS` constants |
| `api/audit.php` | **New file** — logging utility with `audit_log()` and `audit_purge()` |
| `api/auth.php` | Add `require_once __DIR__ . '/audit.php'`; add 4 `audit_log()` calls |
| `api/sync.php` | Add `require_once __DIR__ . '/audit.php'`; add calls in `apply_client_change()` and response loop; call `audit_purge()` in daily purge hook |

---

## Query Examples

```bash
# All failed logins
cat data/audit-*.jsonl | jq 'select(.event == "AUTH_LOGIN_FAIL")'

# Who read note "welcome"?
cat data/audit-*.jsonl | jq 'select(.note_id == "welcome" and .event == "NOTE_READ") | {user, ts}'

# Activity per user this month
cat data/audit-2026-05.jsonl | jq -s 'group_by(.user) | map({user: .[0].user, count: length})'

# Timeline of a specific note
cat data/audit-*.jsonl | jq 'select(.note_id == "welcome")'

# All events for a specific user, newest first
cat data/audit-*.jsonl | jq -s 'map(select(.user == "alice")) | sort_by(-.ts)'
```
