#!/usr/bin/env bash
#
# run.sh — Integration test runner
#
# 1. Copies api/ files to a temp directory with the test config.php
# 2. Creates a test user in the temp htpasswd
# 3. Starts php -S on the temp directory
# 4. Runs each test_*.sh script against the local server
# 5. Cleans up
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_DIR=$(mktemp -d /tmp/leaf-integration-env-XXXXXX)
PID=""
PASS=0
FAIL=0
PORT=0

cleanup() {
    [ -n "$PID" ] && kill "$PID" 2>/dev/null || true
    rm -rf "$ENV_DIR" 2>/dev/null || true
    echo ""
    echo "════════════════════════════════════════"
    if [ "$FAIL" -eq 0 ]; then
        echo "  All tests passed! ($PASS/$((PASS+FAIL)))"
    else
        echo "  $FAIL test(s) failed. ($PASS/$((PASS+FAIL)))"
    fi
    echo "════════════════════════════════════════"
    exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
}
trap cleanup EXIT INT TERM

# ── Build test environment ──────────────────────────────────────────────────

echo "==> Setting up test environment..."

# Create api/ subdirectory (mirrors production layout)
mkdir -p "$ENV_DIR/api"

# Copy per-instance files only: index.php, adduser.php, config.php
cp "$ROOT_DIR"/api/index.php   "$ENV_DIR/api/"
cp "$ROOT_DIR"/api/adduser.php "$ENV_DIR/api/"
cp "$SCRIPT_DIR/config.php"    "$ENV_DIR/api/config.php"

# Symlink shared code — mirrors production deployment
ln -s "$ROOT_DIR"/src "$ENV_DIR/src"
ln -s "$ROOT_DIR"/spa "$ENV_DIR/spa"

# Create data directories
mkdir -p "$ENV_DIR/data"/notes

# Add a test user (adduser.php loads config, delegates to src/php/adduser_impl.php)
php "$ENV_DIR/api/adduser.php" add testuser test1234 > /dev/null

echo "     Environment: $ENV_DIR"

# ── Start PHP built-in server ───────────────────────────────────────────────

PORT=$(shuf -i 9000-9999 -n 1)
php -S "127.0.0.1:$PORT" -t "$ENV_DIR" &>/dev/null &
PID=$!
sleep 1

if ! kill -0 "$PID" 2>/dev/null; then
    echo "ERROR: PHP server failed to start"
    exit 1
fi

export BASE_URL="http://127.0.0.1:$PORT"
echo "     Server:     $BASE_URL"
echo ""

# ── Run tests ───────────────────────────────────────────────────────────────

for test_script in "$SCRIPT_DIR"/test_*.sh; do
    name=$(basename "$test_script" .sh)
    echo "── $name ─────────────────────────────────────"

    if bash "$test_script"; then
        echo "  PASS"
        PASS=$((PASS+1))
    else
        echo "  FAIL"
        FAIL=$((FAIL+1))
    fi
    echo ""
done

echo "==> Cleaning up..."
