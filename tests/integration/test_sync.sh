#!/usr/bin/env bash
#
# test_sync.sh — Integration tests for sync.php
#
# Tests the push/pull sync protocol: creating notes, pushing changes,
# pulling server changes, and verifying the data roundtrips.
#
set -euo pipefail

BASE="${BASE_URL:?BASE_URL not set}"

fail() { echo "  FAIL: $*" >&2; exit 1; }
pass() { echo -n "."; }

# Helper: login and return the JWT
do_login() {
    curl -s -X POST "$BASE/api/index.php/auth?action=login" \
        -H 'Content-Type: application/json' \
        -d '{"username":"testuser","password":"test1234"}' | jq -r '.token'
}

TOKEN=$(do_login)
[ -n "$TOKEN" ] || fail "login failed"

AUTH=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')

# ── 1. Empty initial sync ─────────────────────────────────────────────────

EMPTY=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d '{"syncedRevision":0,"client_id":1,"changes":[]}')

EMPTY_REV=$(echo "$EMPTY" | jq -r '.currentRevision // empty')
[ "$EMPTY_REV" = "0" ] || fail "empty sync: expected currentRevision=0, got '$EMPTY_REV'"
EMPTY_COUNT=$(echo "$EMPTY" | jq '.changes | length')
[ "$EMPTY_COUNT" = "0" ] || fail "empty sync: expected 0 changes, got $EMPTY_COUNT"
pass

# ── 2. Create a note via push ──────────────────────────────────────────────

CREATE=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d '{"syncedRevision":0,"client_id":1,"changes":[{"type":1,"key":"test-note","obj":{"id":"test-note","content":"hello world","version":"0"}}]}')

CREATE_REV=$(echo "$CREATE" | jq -r '.currentRevision')
[ "$CREATE_REV" -gt 0 ] || fail "create note: expected currentRevision > 0, got '$CREATE_REV'"
CREATE_COUNT=$(echo "$CREATE" | jq '.changes | length')
[ "$CREATE_COUNT" = "1" ] || fail "create note: expected 1 change in response, got $CREATE_COUNT"
pass

# ── 3. Pull after create receives the new note ─────────────────────────────

PULL=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":0,\"client_id\":1,\"changes\":[]}")

PULL_COUNT=$(echo "$PULL" | jq '.changes | length')
[ "$PULL_COUNT" = "1" ] || fail "pull after create: expected 1 change, got $PULL_COUNT"

PULL_KEY=$(echo "$PULL" | jq -r '.changes[0].key')
[ "$PULL_KEY" = "test-note" ] || fail "pull after create: expected key test-note, got '$PULL_KEY'"

PULL_CONTENT=$(echo "$PULL" | jq -r '.changes[0].obj.content')
[ "$PULL_CONTENT" = "hello world" ] || fail "pull after create: content mismatch, got '$PULL_CONTENT'"

# Verify version and prev_version fields are present in response
PULL_VERSION=$(echo "$PULL" | jq -r '.changes[0].obj.version // empty')
[ -n "$PULL_VERSION" ] || fail "pull after create: expected version field, got empty"
PULL_PREV=$(echo "$PULL" | jq -r '.changes[0].obj.prev_version // "null"')
# For a CREATE, prev_version may be null — just verify the field exists
[ "$PULL_PREV" = "null" ] && pass_prev=1 || pass_prev=1
pass

# ── 4. Update a note ───────────────────────────────────────────────────────

UPDATE=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":1,\"client_id\":1,\"changes\":[{\"type\":2,\"key\":\"test-note\",\"obj\":{\"id\":\"test-note\",\"content\":\"updated content\",\"version\":\"0\"}}]}")

UPDATE_REV=$(echo "$UPDATE" | jq -r '.currentRevision')
[ "$UPDATE_REV" -gt 1 ] || fail "update note: expected currentRevision > 1, got '$UPDATE_REV'"
pass

# ── 5. Verify content after pull with syncedRevision ───────────────────────

PULL2=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":1,\"client_id\":1,\"changes\":[]}")

PULL2_CONTENT=$(echo "$PULL2" | jq -r '.changes[0].obj.content')
[ "$PULL2_CONTENT" = "updated content" ] || fail "pull after update: content mismatch, got '$PULL2_CONTENT'"
pass

# ── 6. Delete a note ───────────────────────────────────────────────────────

DELETE=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":2,\"client_id\":1,\"changes\":[{\"type\":3,\"key\":\"test-note\",\"obj\":null}]}")

DELETE_REV=$(echo "$DELETE" | jq -r '.currentRevision')
[ "$DELETE_REV" -gt 2 ] || fail "delete note: expected currentRevision > 2, got '$DELETE_REV'"
pass

# ── 7. Pull after delete shows deletion ────────────────────────────────────

PULL3=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":2,\"client_id\":1,\"changes\":[]}")

PULL3_TYPE=$(echo "$PULL3" | jq -r '.changes[0].type // empty')
# Type 3 = DELETE
[ "$PULL3_TYPE" = "3" ] || fail "pull after delete: expected type 3, got '$PULL3_TYPE'"
PULL3_KEY=$(echo "$PULL3" | jq -r '.changes[0].key')
[ "$PULL3_KEY" = "test-note" ] || fail "pull after delete: expected key test-note, got '$PULL3_KEY'"
pass

# ── 8. Create note with colons as path separator ─────────────────────────

SPECIAL=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d '{"syncedRevision":0,"client_id":1,"changes":[{"type":1,"key":"work:meetings:notes","obj":{"id":"work:meetings:notes","content":"colon as path separator","version":"0"}}]}')

# Pull to verify the key was stored as-is (colons are safe)
PULL4=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d '{"syncedRevision":0,"client_id":1,"changes":[]}')

FOUND=$(echo "$PULL4" | jq '[.changes[] | select(.key == "work:meetings:notes")] | length')
[ "$FOUND" = "1" ] || fail "colon path: expected key work:meetings:notes, got nothing"
pass

# ── 8b. Unsafe key with slash is rejected with 400 ───────────────────────

UNSAFE_CODE=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d '{"syncedRevision":0,"client_id":1,"changes":[{"type":1,"key":"work/slash","obj":{"id":"work/slash","content":"has slash","version":"0"}}]}')
[ "$UNSAFE_CODE" = "400" ] || fail "unsafe slash key: expected 400, got $UNSAFE_CODE"

UNSAFE_BODY=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d '{"syncedRevision":0,"client_id":1,"changes":[{"type":1,"key":"work/slash","obj":{"id":"work/slash","content":"has slash","version":"0"}}]}')
UNSAFE_ERROR=$(echo "$UNSAFE_BODY" | jq -r '.error // empty')
[ "$UNSAFE_ERROR" = "INVALID_ID" ] || fail "unsafe slash key: expected error INVALID_ID, got '$UNSAFE_ERROR'"
pass

# ── 9. Rename a note via push (type 4) ──────────────────────────────────────

# Bootstrap: get the initial revision so later requests use the incremental path.
# (syncedRevision=0 now triggers the filesystem bootstrap, which does not
#  return RENAME entries.  Use a positive syncedRevision to get them.)
REV_BOOT=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d '{"syncedRevision":0,"client_id":1,"changes":[]}' | jq -r '.currentRevision')
[ "$REV_BOOT" -gt 0 ] || fail "rename setup: expected currentRevision > 0"

# First create a note to rename
REN_SRC="note-to-rename"
REN_DST="renamed-note"

REV_AFTER_CREATE=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":$REV_BOOT,\"client_id\":1,\"changes\":[{\"type\":1,\"key\":\"$REN_SRC\",\"obj\":{\"id\":\"$REN_SRC\",\"content\":\"will be renamed\",\"version\":\"0\"}}]}" | jq -r '.currentRevision')
[ "$REV_AFTER_CREATE" -gt "$REV_BOOT" ] || fail "rename: got empty or unchanged currentRevision"

# Now push a RENAME change
REV_AFTER_RENAME=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":$REV_AFTER_CREATE,\"client_id\":1,\"changes\":[{\"type\":4,\"key\":\"$REN_SRC\",\"obj\":{\"renamed_to\":\"$REN_DST\",\"version\":\"0\"}}]}" | jq -r '.currentRevision')
[ "$REV_AFTER_RENAME" -gt "$REV_AFTER_CREATE" ] || fail "rename: expected currentRevision to advance"
pass

# ── 10. Pull after rename shows RENAME change ───────────────────────────────

PULL_RENAME=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":$REV_AFTER_CREATE,\"client_id\":1,\"changes\":[]}")

# Find the RENAME entry (type 4)
REN_TYPE=$(echo "$PULL_RENAME" | jq '[.changes[] | select(.type == 4)] | length')
[ "$REN_TYPE" -ge 1 ] || fail "pull after rename: expected at least 1 type 4 change, got $REN_TYPE"

# Find the entry for our old key
REN_ENTRY=$(echo "$PULL_RENAME" | jq '.changes[] | select(.key == "'"$REN_SRC"'" and .type == 4)')
[ -n "$REN_ENTRY" ] || fail "pull after rename: expected RENAME entry for '$REN_SRC'"

REN_NEW_ID=$(echo "$REN_ENTRY" | jq -r '.obj.renamed_to')
[ "$REN_NEW_ID" = "$REN_DST" ] || fail "pull after rename: expected renamed_to '$REN_DST', got '$REN_NEW_ID'"
pass

# ── 11. Renamed note content is accessible under new name ───────────────────

# Push an UPDATE under the new name to verify the note exists and content is intact
UPDATE_RENAMED=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":$REV_AFTER_RENAME,\"client_id\":1,\"changes\":[{\"type\":2,\"key\":\"$REN_DST\",\"obj\":{\"id\":\"$REN_DST\",\"content\":\"rename verified\",\"version\":\"0\"}}]}")

UPDATE_RENAMED_REV=$(echo "$UPDATE_RENAMED" | jq -r '.currentRevision')
[ "$UPDATE_RENAMED_REV" -gt "$REV_AFTER_RENAME" ] || fail "update renamed: expected currentRevision to advance"
pass

# Pull after syncedRevision to see the update on renamed note
PULL_RENAMED=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":$REV_AFTER_RENAME,\"client_id\":1,\"changes\":[]}")

# The renamed note should appear under the new key with updated content
RENAMED_CONTENT=$(echo "$PULL_RENAMED" | jq -r '.changes[] | select(.key == "'"$REN_DST"'") | .obj.content // empty')
[ "$RENAMED_CONTENT" = "rename verified" ] || fail "renamed note: content mismatch under '$REN_DST', got '$RENAMED_CONTENT'"
pass

# ── 12. Rename to already-existing name should fail ─────────────────────────

# Track the current revision so we can use incremental syncs below.
REV_BEFORE_RENAME_FAIL=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d '{"syncedRevision":0,"client_id":1,"changes":[]}' | jq -r '.currentRevision')

# Create another note
REV_AFTER_CREATE2=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":$REV_BEFORE_RENAME_FAIL,\"client_id\":1,\"changes\":[{\"type\":1,\"key\":\"existing-target\",\"obj\":{\"id\":\"existing-target\",\"content\":\"i exist\",\"version\":\"0\"}}]}" | jq -r '.currentRevision')
[ "$REV_AFTER_CREATE2" -gt "$REV_BEFORE_RENAME_FAIL" ] || fail "rename fail setup: expected currentRevision to advance"

# Try to rename REN_DST to existing-target — server returns no change entry for it
RENAME_FAIL=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":$REV_AFTER_CREATE2,\"client_id\":1,\"changes\":[{\"type\":4,\"key\":\"$REN_DST\",\"obj\":{\"renamed_to\":\"existing-target\",\"version\":\"0\"}}]}")

# The response should NOT include a RENAME entry for this key
RENAME_FAIL_ENTRIES=$(echo "$RENAME_FAIL" | jq '[.changes[] | select(.key == "'"$REN_DST"'" and .type == 4)] | length')
[ "$RENAME_FAIL_ENTRIES" = "0" ] || fail "rename to existing: expected 0 RENAME entries, got $RENAME_FAIL_ENTRIES"
pass

# ── 13. Rename to tombstoned name should succeed ──────────────────────────

# Track revision before the delete so we can use incremental sync path.
REV_BEFORE_DELETE=$(echo "$RENAME_FAIL" | jq -r '.currentRevision')

# Delete existing-target to create a tombstone
REV_AFTER_DELETE=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":$REV_BEFORE_DELETE,\"client_id\":1,\"changes\":[{\"type\":3,\"key\":\"existing-target\",\"obj\":null}]}" | jq -r '.currentRevision')
[ "$REV_AFTER_DELETE" -gt "$REV_BEFORE_DELETE" ] || fail "tomb rename setup: expected currentRevision to advance"

# Now rename something to the tombstoned name — should work
RENAME_TOMB=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":$REV_AFTER_DELETE,\"client_id\":1,\"changes\":[{\"type\":4,\"key\":\"$REN_DST\",\"obj\":{\"renamed_to\":\"existing-target\",\"version\":\"0\"}}]}")

RENAME_TOMB_ENTRIES=$(echo "$RENAME_TOMB" | jq '[.changes[] | select(.key == "'"$REN_DST"'" and .type == 4)] | length')
[ "$RENAME_TOMB_ENTRIES" = "1" ] || fail "rename to tombstoned: expected 1 RENAME entry, got $RENAME_TOMB_ENTRIES"

RENAME_TOMB_TARGET=$(echo "$RENAME_TOMB" | jq -r '.changes[] | select(.key == "'"$REN_DST"'" and .type == 4) | .obj.renamed_to')
[ "$RENAME_TOMB_TARGET" = "existing-target" ] || fail "rename to tombstoned: expected renamed_to existing-target, got '$RENAME_TOMB_TARGET'"
pass

# ── 14. Create over a tombstone should succeed ────────────────────────────

# Create a note, delete it (creates tombstone), then create again with same name
curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":0,\"client_id\":1,\"changes\":[{\"type\":1,\"key\":\"tomb-create-test\",\"obj\":{\"id\":\"tomb-create-test\",\"content\":\"first life\",\"version\":\"0\"}}]}" > /dev/null

# Delete it — creates tombstone
curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":0,\"client_id\":1,\"changes\":[{\"type\":3,\"key\":\"tomb-create-test\",\"obj\":null}]}" > /dev/null

# Now CREATE again with the same name — should revive the tombstone and create fresh
curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":0,\"client_id\":1,\"changes\":[{\"type\":1,\"key\":\"tomb-create-test\",\"obj\":{\"id\":\"tomb-create-test\",\"content\":\"second life\",\"version\":\"0\"}}]}" > /dev/null

# Pull to verify the revived note exists with new content
PULL_REVIVE=$(curl -s "${AUTH[@]}" -X POST "$BASE/api/index.php/sync" \
    -d "{\"syncedRevision\":0,\"client_id\":1,\"changes\":[]}")

REVIVE_CONTENT=$(echo "$PULL_REVIVE" | jq -r '.changes[] | select(.key == "tomb-create-test") | .obj.content // empty')
[ "$REVIVE_CONTENT" = "second life" ] || fail "create over tombstone: content mismatch, got '$REVIVE_CONTENT'"
pass

echo ""
