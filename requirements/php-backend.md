# PHP Backend — Requirements Specification

**Scope:** `src/php/`  
**Version:** 1.0  
**Date:** 2026-06-04

---

## Table of Contents

1. [Overview](#1-overview)
2. [REQ-PHP-001: HTTP Helpers](#2-req-php-001-http-helpers)
3. [REQ-PHP-002: CORS & Method Guard](#3-req-php-002-cors--method-guard)
4. [REQ-PHP-003: JWT (JSON Web Token)](#4-req-php-003-jwt-json-web-token)
5. [REQ-PHP-004: Authentication Endpoints](#5-req-php-004-authentication-endpoints)
6. [REQ-PHP-005: JWT Authentication Guard](#6-req-php-005-jwt-authentication-guard)
7. [REQ-PHP-006: User Validation](#7-req-php-006-user-validation)
8. [REQ-PHP-007: User Management CLI](#8-req-php-007-user-management-cli)
9. [REQ-PHP-008: Storage Abstraction](#9-req-php-008-storage-abstraction)
10. [REQ-PHP-009: Audit Log](#10-req-php-009-audit-log)
11. [REQ-PHP-010: Sync Protocol](#11-req-php-010-sync-protocol)
12. [REQ-PHP-011: Trash (Soft-Delete) Management](#12-req-php-011-trash-soft-delete-management)
13. [REQ-PHP-012: Version History](#13-req-php-012-version-history)
14. [REQ-PHP-013: SPA Configuration](#14-req-php-013-spa-configuration)
15. [REQ-PHP-014: Request Router](#15-req-php-014-request-router)
16. [REQ-PHP-015: Storage Interface](#16-req-php-015-storage-interface)
17. [REQ-PHP-016: FlatFile Storage Backend](#17-req-php-016-flatfile-storage-backend)
18. [REQ-PHP-017: Audit Interface](#18-req-php-017-audit-interface)
19. [REQ-PHP-018: FlatFile Audit Backend](#19-req-php-018-flatfile-audit-backend)
20. [Non-Functional Requirements](#20-non-functional-requirements)
21. [Configuration Dependencies](#21-configuration-dependencies)

---

## 1. Overview

The PHP backend provides the server-side layer for the Leaf note-taking application.
It manages authentication, note synchronization, version history, soft-delete/trash,
and audit logging. The architecture uses a functional dispatch pattern with
pluggable storage and audit backends via interfaces.

**This document specifies internal code requirements** — what each module must do.
For API request/response shapes, protocol behavior, storage schema, and audit log
format, see [`requirements/api-protocol.md`](../requirements/api-protocol.md).

### Files

| File / Directory | Role |
|---|---|
| `http-helpers.php` | JSON response helpers (`respond`, `fail`) |
| `cors.php` | CORS headers, OPTIONS preflight, HTTP method enforcement |
| `jwt.php` | HS256 JWT encode/decode (zero dependencies) |
| `auth.php` | Login, logout, token refresh endpoints |
| `auth_guard.php` | Bearer token verification guard |
| `users.php` | Htpasswd-based password validation |
| `adduser_impl.php` | CLI tool for htpasswd user management |
| `storage.php` | Global storage backend accessor |
| `audit.php` | Global audit backend accessor |
| `sync.php` | Note synchronization protocol endpoint |
| `trash.php` | Soft-delete management (list, restore, preview, purge, empty) |
| `history.php` | Version history retrieval endpoint |
| `spa-config.php` | Exposes config to the SPA client |
| `router.php` | Request dispatcher (maps URLs to handlers) |
| `storage/StorageInterface.php` | Storage backend contract |
| `storage/FlatFileStorage.php` | Flat-file storage implementation |
| `audit/AuditInterface.php` | Audit backend contract |
| `audit/FlatFileAudit.php` | Flat-file audit implementation |

---

## 2. REQ-PHP-001: HTTP Helpers

**File:** `http-helpers.php`  
**Type:** Library

### REQ-PHP-001.1 — JSON Response

The system **MUST** provide a `respond(mixed $data, int $code = 200): never` function that:

- Sets the HTTP response code via `http_response_code()`.
- Encodes `$data` as JSON with `JSON_UNESCAPED_UNICODE`.
- Echoes the JSON body.
- Terminates execution (`exit`).

### REQ-PHP-001.2 — JSON Error Response

The system **MUST** provide a `fail(string $msg, int $code = 400): never` function that:

- Sets the HTTP response code.
- Encodes `['error' => $msg]` as JSON.
- Echoes the JSON body.
- Terminates execution (`exit`).

---

## 3. REQ-PHP-002: CORS & Method Guard

**File:** `cors.php`  
**Type:** Middleware

### REQ-PHP-002.1 — CORS Headers

The system **MUST** set the following response headers if not already set by the caller:

| Header | Default Value |
|---|---|
| `Access-Control-Allow-Origin` | `CORS_ALLOW_POLICY` (from config) |
| `Access-Control-Allow-Methods` | `POST, OPTIONS` |
| `Access-Control-Allow-Headers` | `Content-Type, Authorization` |
| `Content-Type` | `application/json` |

### REQ-PHP-002.2 — OPTIONS Preflight

When `REQUEST_METHOD === 'OPTIONS'`, the system **MUST** respond with HTTP 204 (No Content) and terminate execution — after setting CORS headers. No body is returned.

### REQ-PHP-002.3 — Method Enforcement

For non-OPTIONS requests, the system **MUST** validate that the request method is included in the `Access-Control-Allow-Methods` header. If the method is not allowed, the system **SHALL** respond with HTTP 405 and a JSON error body containing the allowed methods.

### REQ-PHP-002.4 — Customizable Headers

Callers **MAY** set CORS headers before including `cors.php`. Any header already emitted **MUST NOT** be overwritten. Specifically, callers that need a broader method set (e.g., `GET, OPTIONS` for `spa-config.php`) or a different `Allow-Headers` set (e.g., excluding `Authorization` for `auth.php`) can do so.

### REQ-PHP-002.5 — PHP < 8.4 Compatibility

The system **SHALL** polyfill `header_exists()` for PHP versions prior to 8.4.

---

## 4. REQ-PHP-003: JWT (JSON Web Token)

**File:** `jwt.php`  
**Type:** Library

### REQ-PHP-003.1 — Algorithm

The system **MUST** support HS256 (HMAC-SHA256) only. No other algorithms are required.

### REQ-PHP-003.2 — Zero External Dependencies

The system **MUST** use only PHP core functions: `hash_hmac()`, `base64_encode()`, `json_encode()`, `json_decode()`. No third-party libraries are required.

### REQ-PHP-003.3 — Token Structure

Tokens **MUST** conform to RFC 7519: three dot-separated segments (header, payload, signature), each base64url-encoded.

### REQ-PHP-003.4 — Base64URL Encoding

The system **MUST** provide:

- `base64url_encode(string $data): string` — URL-safe encoding, no padding.
- `base64url_decode(string $data): string|false` — restores padding, returns false on failure.

### REQ-PHP-003.5 — Token Issuance (`jwt_encode`)

The function `jwt_encode(array $payload, int $expiry = JWT_EXPIRY): string` **MUST**:

- Automatically set `iat` (issued at) to the current Unix timestamp if not provided.
- Automatically set `exp` (expiration) to `now + $expiry` if not provided.
- Sign the header + payload with the `JWT_SECRET` constant using HMAC-SHA256.
- Return the complete JWT string.

### REQ-PHP-003.6 — Token Verification (`jwt_decode`)

The function `jwt_decode(string $token): array|false` **MUST**:

- Split the token into three parts. If fewer or more than 3 parts, return `false`.
- Verify the signature using `hash_equals()` for timing-attack safety.
- Decode the payload from base64url. If the payload is not an array, return `false`.
- If `exp` is set and has passed, return `false`.
- If all checks pass, return the payload array.

---

## 5. REQ-PHP-004: Authentication Endpoints

**File:** `auth.php`  
**Type:** API Endpoint

### REQ-PHP-004.1 — Action Dispatch

The endpoint **MUST** dispatch on `$_GET['action']` to one of: `login`, `refresh`, `logout`. Unknown actions **MUST** return HTTP 404 with a JSON error.

### REQ-PHP-004.2 — Login (`action=login`)

The system **MUST** trim the username, validate credentials via `validate_user()`,
issue a JWT access token and an httpOnly refresh token (rotated via
`random_bytes(32)`), and log audit events for both success and failure. On failure,
the system **MUST** introduce a random delay of 1–3 seconds (`usleep()`) to blunt
timing-based user enumeration.

### REQ-PHP-004.3 — Token Refresh (`action=refresh`)

The system **MUST** read the refresh token from the cookie, validate it against
`REFRESH_TOKENS_FILE`, rotate to a new refresh token (delete old, issue new,
persist, set new cookie), and issue a new JWT access token. On failure, the cookie
**MUST** be cleared.

### REQ-PHP-004.4 — Logout (`action=logout`)

The system **MUST** invalidate the refresh token server-side (delete from
`REFRESH_TOKENS_FILE`), clear the cookie, and log the event.

### REQ-PHP-004.5 — Refresh Token Storage

The system **MUST** store tokens as a JSON map in `REFRESH_TOKENS_FILE`, prune
expired entries on every write, and write atomically (temp file + `rename()`).

> **API shapes and HTTP details** are specified in [`requirements/api-protocol.md`](../requirements/api-protocol.md#apiauth).

---

## 6. REQ-PHP-005: JWT Authentication Guard

**File:** `auth_guard.php`  
**Type:** Middleware

### REQ-PHP-005.1 — Bearer Token Extraction

The function `require_auth(): string` **MUST**:

- Read the `Authorization` header from `$_SERVER['HTTP_AUTHORIZATION']`.
- Verify it starts with `"Bearer "`.
- Extract the token (everything after `"Bearer "`).

### REQ-PHP-005.2 — Token Verification

The function **MUST** call `jwt_decode()` on the extracted token. If verification fails (return value is `false`), respond with HTTP 401 and `{ "error": "Invalid or expired token" }`.

### REQ-PHP-005.3 — Subject Claim

The system **MUST** verify that the decoded payload contains a non-empty `sub` claim (the username). If absent, return HTTP 401 with `{ "error": "Token missing subject claim" }`.

### REQ-PHP-005.4 — Return Value

On success, **MUST** return the username string from the `sub` claim.

---

## 7. REQ-PHP-006: User Validation

**File:** `users.php`  
**Type:** Library

### REQ-PHP-006.1 — Htpasswd-Based Validation

The function `validate_user(string $username, string $password): string|false` **MUST**:

- Reject empty usernames and passwords.
- Reject usernames containing colons (htpasswd delimiter character).
- Return `false` if `HTPASSWD_FILE` does not exist (with an `error_log` message).
- Read the htpasswd file, skipping comment lines (`#` prefix) and malformed lines.
- Find the line matching the username (case-sensitive).
- Reject non-bcrypt hashes (`$2y$` and `$2a$` prefixes only) — log and return `false`.
- Verify the password with `password_verify()`.
- Return the username on success, `false` on any failure.

### REQ-PHP-006.2 — Backend Swapability

The system **SHOULD** be designed so that replacing only the body of `validate_user()` switches the entire user backend, leaving the rest of the auth layer untouched.

---

## 8. REQ-PHP-007: User Management CLI

**File:** `adduser_impl.php`  
**Type:** CLI Tool

### REQ-PHP-007.1 — CLI-Only Operation

The tool **MUST** be run from the command line only. Execution via HTTP **MUST NOT** be possible (or must exit immediately).

### REQ-PHP-007.2 — Commands

The tool **MUST** support these subcommands:

| Command | Arguments | Description |
|---|---|---|
| `add` | `<username> <password>` | Add or update a user |
| `delete` | `<username>` | Remove a user |
| `list` | — | List all usernames |
| `check` | `<username> <password>` | Test a password (via `validate_user()`) |

### REQ-PHP-007.3 — Add Command

- **MUST** validate the username (non-empty, ≤64 chars, no colons, no path separators `/` or `\`).
- **MUST** require passwords to be at least 8 characters.
- **MUST** hash passwords with `PASSWORD_BCRYPT` at cost 12.
- **MUST** indicate whether the user was `"Added"` or `"Updated"`.
- **SHOULD** be compatible with Apache httpd htpasswd bcrypt entries.

### REQ-PHP-007.4 — Delete Command

- **MUST** verify the user exists before attempting deletion.
- **MUST** abort with an error if the user is not found.

### REQ-PHP-007.5 — List Command

- **MUST** display all usernames from the htpasswd file.
- **MUST** indicate the path to the htpasswd file.

### REQ-PHP-007.6 — Check Command

- **MUST** use `validate_user()` for verification.
- **MUST** exit with status 0 on success, 1 on failure.

### REQ-PHP-007.7 — Atomic Writes

The htpasswd file **MUST** be written atomically: temp file with PID suffix, then `rename()`.

### REQ-PHP-007.8 — Error Reporting

Errors **MUST** be printed to STDERR and cause a non-zero exit code.

---

## 9. REQ-PHP-008: Storage Abstraction

**File:** `storage.php`  
**Type:** Service Locator

### REQ-PHP-008.1 — Backend Registration

The system **MUST** provide a `storage_set(StorageInterface $s): void` function that sets the global storage backend. It **MUST** be called once during bootstrap (in `config.php`).

### REQ-PHP-008.2 — Backend Access

The system **MUST** provide a `storage(): StorageInterface` function that returns the global backend. If the backend has not been initialized, it **MUST** throw a `RuntimeException` with a descriptive message.

### REQ-PHP-008.3 — Backend Swapping

Consumers (`sync.php`, `trash.php`, `history.php`) **MUST** call `storage()->method()` rather than calling global functions directly, so swapping backends requires changing only the one line in `config.php` that calls `storage_set()`.

---

## 10. REQ-PHP-009: Audit Log

**File:** `audit.php`  
**Type:** Service Locator

### REQ-PHP-009.1 — Backend Registration

The system **MUST** provide an `audit_set(AuditInterface $a): void` function that sets the global audit backend. It **MUST** be called once during bootstrap (in `config.php`).

### REQ-PHP-009.2 — Backend Access

The system **MUST** provide an `audit(): AuditInterface` function that returns the global backend. If the backend has not been initialized, it **MUST** throw a `RuntimeException` with a descriptive message.

---

## 11. REQ-PHP-010: Sync Protocol

**File:** `sync.php`  
**Type:** API Endpoint

### REQ-PHP-010.1 — Authentication

The endpoint **MUST** require a valid JWT Bearer token via `require_auth()`. All operations are scoped to the authenticated username (`$author`).

### REQ-PHP-010.2 — Change Type Constants

The system **MUST** define constants for Dexie-compatible change types:
`DEXIE_CREATE` (1), `DEXIE_UPDATE` (2), `DEXIE_DELETE` (3), `DEXIE_RENAME` (4).

### REQ-PHP-010.3 — Note ID Sanitization

The system **MUST** sanitize note identifiers from client input via `safe_id()`:

- Trim whitespace.
- Map `/` to `:` (preserves logical paths without directory traversal).
- Replace leading dots with `_` (prevents hidden files and `..` traversal).
- Strip characters not in `[a-zA-Z0-9_\-.\$%'@~!(){}^#&\x60:]`, replacing with `_`.

### REQ-PHP-010.4 — Applying Client Changes

For each change in the request's `changes` array, the system **MUST**:

- **CREATE (type=1) or UPDATE (type=2):** Call `storage()->putNoteLogged()` and log via `audit()->log('NOTE_WRITE', ...)`.
- **DELETE (type=3):** Call `storage()->deleteNoteLogged()` and log via `audit()->log('NOTE_DELETE', ...)`.
- **RENAME (type=4):** Call `storage()->renameNoteLogged()` and log via `audit()->log('NOTE_RENAME', ...)`.

### REQ-PHP-010.5 — Response Construction

The system **MUST** return server-side changes and the current revision. Three
branches are implemented:

1. **Bootstrap** (`syncedRevision === 0`): build from the filesystem (no changelog scan).
2. **Incremental** (`syncedRevision > 0`): walk changelog entries, deduplicate by
   note key (most recent entry per key wins), and return HTTP 409 (`STALE_REVISION`)
   if the client's revision predates the changelog.
3. After building the response, call `storage()->markVersionSeen()` for each
   returned note not authored by the requesting user, and log
   `audit()->log('NOTE_READ', ...)` for CREATE/UPDATE changes.

### REQ-PHP-010.6 — Daily Housekeeping

On every sync request, the system **SHOULD** check if more than 24 hours have
passed since the last purge. If so, call `storage()->housekeeping('sync')` and
`audit()->purge('sync')`, recording the timestamp in
`DATA_ROOT . 'last_purge.txt'`.

> **API shapes, sync protocol behavior, conflict strategy, and E2EE opacity**
> are specified in [`requirements/api-protocol.md`](../requirements/api-protocol.md#apisync).

---

## 12. REQ-PHP-011: Trash (Soft-Delete) Management

**File:** `trash.php`  
**Type:** API Endpoint

### REQ-PHP-011.1 — Authentication

The endpoint **MUST** require a valid JWT Bearer token via `require_auth()`.

### REQ-PHP-011.2 — Action Dispatch

The system **MUST** dispatch on `body.action` to one of: `list`, `restore`,
`preview`, `purge`, `empty`.

### REQ-PHP-011.3 — Internal Behaviors

- **List:** **MUST** call `storage()->listDeletedNotes()`.
- **Restore:** **MUST** call `storage()->reviveNote()`, append a `CREATE`
  changelog entry for sync propagation, and log via
  `audit()->log('NOTE_RESTORE', ...)`. **MUST** verify the tombstone exists
  before attempting restore.
- **Preview:** **MUST** call `storage()->getTombstone()` read-only (no mutations).
- **Purge:** **MUST** call `storage()->hardDeleteNote()` for a single tombstone.
- **Empty:** **MUST** iterate all tombstones via `storage()->listDeletedNotes()`
  and call `storage()->hardDeleteNote()` for each.

> **API request/response shapes** are specified in
> [`requirements/api-protocol.md`](../requirements/api-protocol.md#apitrash).

---

## 13. REQ-PHP-012: Version History

**File:** `history.php`  
**Type:** API Endpoint

### REQ-PHP-012.1 — Authentication

The endpoint **MUST** require a valid JWT Bearer token via `require_auth()`.

### REQ-PHP-012.2 — Action Dispatch

The system **MUST** dispatch on `body.action` to one of: `list`, `get`.

### REQ-PHP-012.3 — Internal Behaviors

- **List:** **MUST** call `storage()->getVersionList()` to retrieve version
  metadata. **MUST NOT** include opaque content. **MUST** return an empty list
  if the note does not exist or is deleted.
- **Get:** **MUST** verify the note exists, then call
  `storage()->getVersionContent()` for each requested version key.

> **API request/response shapes** are specified in
> [`requirements/api-protocol.md`](../requirements/api-protocol.md#apihistory).

---

## 14. REQ-PHP-013: SPA Configuration

**File:** `spa-config.php`  
**Type:** API Endpoint

### REQ-PHP-013.1 — Configuration Exposure

The endpoint **MUST** return the `$spa_config` array (defined in `config.php`) as
JSON. If `$spa_config` is not defined, the endpoint **MUST** return `{}`.

### REQ-PHP-013.2 — No Authentication

The endpoint **MUST NOT** require authentication.

> **API shape** is specified in
> [`requirements/api-protocol.md`](../requirements/api-protocol.md#apispa-config).

---

## 15. REQ-PHP-014: Request Router

**File:** `router.php`  
**Type:** Dispatcher

### REQ-PHP-014.1 — URL Resolution

The system **MUST** determine the endpoint from the request URL using two strategies:

1. **Primary:** Parse `PATH_INFO` (supports clean URLs like `/api/auth` and explicit URLs like `/api/index.php/auth`).
2. **Fallback:** Parse `REQUEST_URI` relative to `SCRIPT_NAME` (handles servers where `PATH_INFO` is unset).

### REQ-PHP-014.2 — Route Table

The system **MUST** dispatch based on the first path segment:

| Route | Handler |
|---|---|
| `auth` | `auth.php` |
| `sync` | `sync.php` |
| `trash` | `trash.php` |
| `history` | `history.php` |
| `spa-config` | `spa-config.php` |
| *default* | HTTP 404 with `{ "error": "Endpoint not found" }` |

### REQ-PHP-014.3 — Handler Loading

Handlers **MUST** be loaded via `require` using the `LEAF_PHP_DIR` constant as the base path.

---

## 16. REQ-PHP-015: Storage Interface

**File:** `storage/StorageInterface.php`  
**Type:** Contract

### REQ-PHP-015.1 — Note Reads

| Method | Return | Description |
|---|---|---|
| `noteDeleted(string $id)` | `bool` | Check if note is soft-deleted |
| `getNote(string $id)` | `?array` | Read live note metadata + versions |
| `getNoteFull(string $id, int $clientId)` | `?array` | Read note in flat sync-protocol shape |
| `listNotes()` | `array` | Metadata for all live notes, sorted by id |

### REQ-PHP-015.2 — Tombstones

| Method | Return | Description |
|---|---|---|
| `listDeletedNotes()` | `array` | Metadata for all soft-deleted notes |
| `getTombstone(string $id)` | `?array` | Normalized tombstone data |
| `reviveNote(string $id)` | `void` | Restore from tombstone (idempotent) |
| `hardDeleteNote(string $id)` | `void` | Permanent deletion (idempotent) |

### REQ-PHP-015.3 — Logged Write Operations

Each logged write **MUST** compose a CRUD operation + a changelog entry in one call. Backends with transaction support may do both atomically.

| Method | Return | Description |
|---|---|---|
| `putNoteLogged(id, content, author, clientId, clientVersion)` | `?array` | CREATE or UPDATE + changelog |
| `deleteNoteLogged(id, author)` | `bool` | Soft-delete + changelog |
| `renameNoteLogged(oldId, newId, author)` | `bool` | Rename + changelog |

### REQ-PHP-015.4 — Sync Helpers

| Method | Description |
|---|---|
| `markVersionSeen(string $id, int $clientId)` | Clear exclusive flag when another user sees the version |

### REQ-PHP-015.5 — Version History

| Method | Return | Description |
|---|---|---|
| `getVersionList(string $id)` | `array` | Version metadata, newest first |
| `getVersionContent(string $id, string $vkey)` | `?string` | Content for a specific version |

### REQ-PHP-015.6 — Changelog

| Method | Return | Description |
|---|---|---|
| `changelogAppend(array $entry)` | `void` | Append one entry |
| `changelogNextRev()` | `int` | Next revision number (max rev + 1) |
| `changelogSince(int $since)` | `array` | All entries with rev > $since, ascending |
| `changelogCurrentRev()` | `int` | Highest revision number |
| `changelogEarliestRev()` | `int` | Oldest surviving entry's revision |

### REQ-PHP-015.7 — Housekeeping

| Method | Description |
|---|---|
| `housekeeping(string $entry)` | Periodic maintenance hook (e.g., purge expired tombstones) |

### REQ-PHP-015.8 — Capabilities

| Method | Description |
|---|---|
| `e2eeSupport(): bool` | Whether the backend supports end-to-end encryption semantics |

---

## 17. REQ-PHP-016: FlatFile Storage Backend

**File:** `storage/FlatFileStorage.php`  
**Implements:** `StorageInterface`

### REQ-PHP-016.1 — Version Resolution (Overwrite Rule)

When writing a new version, the backend **MUST**:

- **Overwrite** the current version (same version key) when all three conditions are true:
  1. The `client_id` matches the current version's `client_id`.
  2. The current version's UTC date matches today's date.
  3. The current version's `exclusive` flag is `true`.
- **Create a new version** in all other cases, finding the next available counter
  for `(date, client_id)`.

### REQ-PHP-016.2 — Atomic Writes

All file writes **MUST** use temp file + `rename()` for atomicity. Temporary files
**MUST** include the PID (`getmypid()`) in the filename.

### REQ-PHP-016.3 — Concurrent Write Safety

Changelog appends **MUST** use `flock($fh, LOCK_EX)` before writing and
`flock($fh, LOCK_UN)` after.

### REQ-PHP-016.4 — ChangelogNextRev Implementation

`changelogNextRev()` **MUST** read the last line of the changelog file to determine
the next revision number, or return `1` if the file is empty or does not exist.

### REQ-PHP-016.5 — Tombstone Purge

During housekeeping, the backend **MUST** permanently delete tombstones whose
`deleted_at` timestamp is older than `deletedNoteTtlDays` (default 30 days).

### REQ-PHP-016.6 — Rename Operation

- **MUST** use the filesystem `rename()` function (atomic on the same filesystem).
- **MUST** fail if the source note does not exist, is deleted, or the destination
  note already exists.
- **MUST** first hard-delete any tombstone at the destination path.

### REQ-PHP-016.7 — Notes Directory Creation

If the `notes/` directory does not exist at construction time, the backend
**MUST** create it with permissions `0755`.

> **File layout, note/tombstone/changelog schemas, and version key format** are
> specified in
> [`requirements/api-protocol.md`](../requirements/api-protocol.md#storage-schema).

---

## 18. REQ-PHP-017: Audit Interface

**File:** `audit/AuditInterface.php`  
**Type:** Contract

### REQ-PHP-017.1 — Log Method

The system **MUST** define `log(string $event, array $data = []): void` for appending one event entry.

### REQ-PHP-017.2 — Purge Method

The system **MUST** define `purge(string $entry): int` for removing entries older than the configured retention period. It **MUST** return the number of entries removed.

---

## 19. REQ-PHP-018: FlatFile Audit Backend

**File:** `audit/FlatFileAudit.php`  
**Implements:** `AuditInterface`

### REQ-PHP-018.1 — Concurrent Write Safety

File appends **MUST** use `flock($fh, LOCK_EX)` before writing and
`flock($fh, LOCK_UN)` after.

### REQ-PHP-018.2 — Dev Server Mirroring

When running under PHP's built-in dev server (`PHP_SAPI === 'cli-server'`), audit
entries **MUST** be additionally mirrored to stderr via `error_log()` for inline
terminal visibility. The file write remains the canonical storage.

### REQ-PHP-018.3 — Purging

Purge **MUST** delete entire monthly files when the first day of the following
month is more than `$retentionDays` (default 90) in the past. The system **MUST**
validate filenames against the pattern `audit-YYYY-MM.jsonl` to avoid accidentally
deleting unrelated files.

### REQ-PHP-018.4 — IP Logging

IP addresses **MAY** be disabled via the constructor's `$logIps` parameter. When
enabled, the client IP is read from `REMOTE_ADDR` (or `"cli"` for CLI invocations).

> **File layout structure, entry format, and audit event types** are specified in
> [`requirements/api-protocol.md`](../requirements/api-protocol.md#audit-log).

---

## 20. Non-Functional Requirements

### NFR-001 — Zero Third-Party Dependencies

The PHP backend **MUST** use only PHP core functions and extensions. No Composer
packages or external libraries are required.

### NFR-002 — Pluggable Backends

Storage and audit backends **MUST** be replaceable via interfaces
(`StorageInterface`, `AuditInterface`). Changing backends **MUST** require
modification of only the bootstrap configuration file.

### NFR-003 — Security

- Passwords **MUST** be hashed with bcrypt (cost 12). No plaintext or weaker hashes
  are permitted.
- Token verification **MUST** use `hash_equals()` for constant-time signature
  comparison.
- Login failures **MUST** introduce a random delay (1–3 seconds) to mitigate user
  enumeration via timing.
- Note identifiers from client input **MUST** be sanitized to prevent path
  traversal.
- Only bcrypt password hashes (`$2y$`, `$2a$`) are accepted for authentication.
- Refresh tokens **MUST** be generated using `random_bytes()` (cryptographically
  secure PRNG).

### NFR-004 — Atomicity

File writes for persistent data (htpasswd, note files, refresh tokens) **MUST** be
atomic: write to a temporary file, then `rename()` to the target path.

### NFR-005 — Idempotent Operations

Tombstone operations (`reviveNote`, `hardDeleteNote`, `listDeletedNotes`)
**SHOULD** be idempotent — safe to call multiple times with the same parameters.

### NFR-006 — Content-Type

All API responses **MUST** have `Content-Type: application/json`.

### NFR-007 — JSON Encoding

All JSON responses **MUST** use `JSON_UNESCAPED_UNICODE` to preserve Unicode
characters.

> **E2EE opacity, shared-hosting constraints, and token lifetimes** are specified
> in [`requirements/api-protocol.md`](../requirements/api-protocol.md).

---

## 21. Configuration Dependencies

The PHP backend expects the following constants/globals to be defined before any endpoint handler runs (typically in a `config.php` bootstrap file):

| Constant / Global | Used By | Description |
|---|---|---|
| `HTPASSWD_FILE` | `users.php`, `adduser_impl.php` | Path to the Apache htpasswd file |
| `JWT_SECRET` | `jwt.php` | Secret key for HMAC-SHA256 signing |
| `JWT_EXPIRY` | `jwt.php`, `auth.php` | Access token lifetime in seconds |
| `REFRESH_EXPIRY` | `auth.php` | Refresh token lifetime in seconds |
| `REFRESH_TOKENS_FILE` | `auth.php` | Path to refresh token persistence file |
| `COOKIE_PATH` | `auth.php` | Cookie path for refresh token |
| `DATA_ROOT` | `sync.php` | Root directory for data storage |
| `CORS_ALLOW_POLICY` | `cors.php` | CORS `Access-Control-Allow-Origin` value |
| `LEAF_PHP_DIR` | `router.php` | Absolute path to `src/php/` |
| `$spa_config` | `spa-config.php` | Optional array of SPA client configuration |
| `$sharedDir` | `router.php` | (Legacy) absolute path to `src/php/` |
