#!/usr/bin/env bash
#
# test_auth.sh — Integration tests for auth.php
#
# Tests login, token refresh, and logout flows.
#
set -euo pipefail

BASE="${BASE_URL:?BASE_URL not set}"

fail() { echo "  FAIL: $*" >&2; exit 1; }
pass() { echo -n "."; }

# ── 1. Login with valid credentials ─────────────────────────────────────────

LOGIN_RESP=$(curl -s -X POST "$BASE/api/index.php/auth?action=login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"testuser","password":"test1234"}')

TOKEN=$(echo "$LOGIN_RESP" | jq -r '.token // empty')
USERNAME=$(echo "$LOGIN_RESP" | jq -r '.username // empty')
EXPIRES=$(echo "$LOGIN_RESP" | jq -r '.expires // empty')

[ -n "$TOKEN" ]    || fail "login: no token returned"
[ "$USERNAME" = "testuser" ] || fail "login: expected username testuser, got '$USERNAME'"
[ "$EXPIRES" -gt "$(date +%s)" ] || fail "login: expires is not in the future"
pass

# ── 2. Login with wrong password returns 401 ────────────────────────────────

WRONG=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/index.php/auth?action=login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"testuser","password":"wrongpass"}')

[ "$WRONG" = "401" ] || fail "wrong password: expected 401, got $WRONG"
pass

# ── 3. Login with unknown user returns 401 ──────────────────────────────────

UNKNOWN=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/index.php/auth?action=login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"nobody","password":"test1234"}')

[ "$UNKNOWN" = "401" ] || fail "unknown user: expected 401, got $UNKNOWN"
pass

# ── 4. Refresh returns a new token ──────────────────────────────────────────

# curl's cookie jar captures the httpOnly refresh cookie from login
COOKIE_JAR=$(mktemp)
curl -s -c "$COOKIE_JAR" -X POST "$BASE/api/index.php/auth?action=login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"testuser","password":"test1234"}' > /dev/null

REFRESH_RESP=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE/api/index.php/auth?action=refresh")
REFRESH_TOKEN=$(echo "$REFRESH_RESP" | jq -r '.token // empty')

[ -n "$REFRESH_TOKEN" ] || fail "refresh: no token returned"
[ "$REFRESH_TOKEN" != "$TOKEN" ] || fail "refresh: token was not rotated"
pass

# ── 5. Refresh without cookie returns 401 ───────────────────────────────────

NOCOOKIE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/index.php/auth?action=refresh")
[ "$NOCOOKIE" = "401" ] || fail "refresh without cookie: expected 401, got $NOCOOKIE"
pass

# ── 6. Logout clears the refresh cookie ────────────────────────────────────

LOGOUT_RESP=$(curl -s -b "$COOKIE_JAR" -c /dev/null -X POST "$BASE/api/index.php/auth?action=logout")
LOGOUT_OK=$(echo "$LOGOUT_RESP" | jq -r '.ok // false')
[ "$LOGOUT_OK" = "true" ] || fail "logout: expected ok=true"

# After logout, refresh should fail
POST_LOGOUT=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" -X POST "$BASE/api/index.php/auth?action=refresh")
[ "$POST_LOGOUT" = "401" ] || fail "refresh after logout: expected 401, got $POST_LOGOUT"
pass

rm -f "$COOKIE_JAR"
echo ""
