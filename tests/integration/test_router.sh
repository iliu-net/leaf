#!/usr/bin/env bash
#
# test_router.sh — Integration tests for index.php routing
#
# Tests PATH_INFO and REQUEST_URI parsing, 404 for unknown endpoints,
# and that each registered handler receives requests correctly.
#
set -euo pipefail

BASE="${BASE_URL:?BASE_URL not set}"

fail() { echo "  FAIL: $*" >&2; exit 1; }
pass() { echo -n "."; }

# ── 1. Unknown endpoint returns 404 ────────────────────────────────────────

UNKNOWN=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/index.php/nonexistent")
[ "$UNKNOWN" = "404" ] || fail "unknown endpoint: expected 404, got $UNKNOWN"
pass

# ── 2. Unknown endpoint returns JSON error body ────────────────────────────

UNKNOWN_BODY=$(curl -s -X POST "$BASE/api/index.php/foobar")
UNKNOWN_ERR=$(echo "$UNKNOWN_BODY" | jq -r '.error // empty')
[ "$UNKNOWN_ERR" = "Endpoint not found" ] || fail "unknown endpoint: expected error message, got '$UNKNOWN_ERR'"
pass

# ── 3. Bare index.php (no endpoint) returns 404 ────────────────────────────

BARE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/index.php")
[ "$BARE" = "404" ] || fail "bare index.php: expected 404, got $BARE"
pass

# ── 4. Clean URL (mod_dir style) — unknown endpoint ────────────────────────
#    Tests PATH_INFO routing with clean URLs (no index.php in path)

CLEAN_404=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/bogus")
[ "$CLEAN_404" = "404" ] || fail "clean URL unknown: expected 404, got $CLEAN_404"
pass

# ── 5. Clean URL reaches auth handler ───────────────────────────────────────
#    Proves PATH_INFO routing works for clean URLs

CLEAN_AUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth?action=login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"nobody","password":"wrong"}')
[ "$CLEAN_AUTH" = "401" ] || fail "clean URL auth: expected 401, got $CLEAN_AUTH"
pass

# ── 6. Explicit index.php/auth reaches auth handler ─────────────────────────

EXPL_AUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/index.php/auth?action=login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"nobody","password":"wrong"}')
[ "$EXPL_AUTH" = "401" ] || fail "explicit index.php/auth: expected 401, got $EXPL_AUTH"
pass

# ── 7. Auth endpoint rejects GET (handler-level method check) ───────────────

GET_AUTH=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/index.php/auth?action=login")
[ "$GET_AUTH" = "405" ] || fail "GET auth: expected 405, got $GET_AUTH"
pass

# ── 8. Sync endpoint requires auth (returns 401 without token) ──────────────

NOAUTH_SYNC=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/index.php/sync" \
    -H 'Content-Type: application/json' \
    -d '{"baseRevision":0,"syncedRevision":0,"changes":[],"partial":false}')
[ "$NOAUTH_SYNC" = "401" ] || fail "sync without auth: expected 401, got $NOAUTH_SYNC"
pass

# ── 9. Trash endpoint is routable (requires auth) ───────────────────────────

NOAUTH_TRASH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/index.php/trash" \
    -H 'Content-Type: application/json' \
    -d '{"action":"list"}')
[ "$NOAUTH_TRASH" = "401" ] || fail "trash without auth: expected 401, got $NOAUTH_TRASH"
pass

# ── 10. OPTIONS preflight is handled by the handler (not the router) ────────

OPTIONS_AUTH=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "$BASE/api/index.php/auth")
[ "$OPTIONS_AUTH" = "204" ] || fail "OPTIONS auth: expected 204, got $OPTIONS_AUTH"
pass

echo ""
