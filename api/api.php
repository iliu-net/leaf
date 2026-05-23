<?php
/**
 * Notes API — api.php
 *
 * Thin routing layer. All storage logic lives in storage.php.
 *
 * Content is fully opaque — never parsed, never inspected.
 * All metadata (title, tags, path) lives in frontmatter inside content.
 * This allows E2EE to be added later without changing the server.
 *
 * Endpoints (all return JSON):
 *   GET  ?action=list              → [{id, created_at, updated_at, current}]
 *   GET  ?action=load&file=ID      → {content: string}
 *   POST ?action=save              ← {file, content}  → {ok: true}
 *   POST ?action=new               ← {file}           → {ok: true, file: string}
 *   POST ?action=delete            ← {file}           → {ok: true}
 */

require_once __DIR__ . '/storage.php';
require_once __DIR__ . '/auth_guard.php';

// CORS — tighten Access-Control-Allow-Origin in production
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json');

// OPTIONS preflight must bypass auth — browser sends it without Authorization header
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$author = require_auth();   // exits with 401 if token missing/invalid

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Strip everything except safe filename characters. */
function safe_name(string $name): string {
    $name = basename(trim($name));
    return preg_replace('/[^a-zA-Z0-9_\-\.]/u', '_', $name);
}

function respond(mixed $data, int $code = 200): never {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $msg, int $code = 400): never {
    respond(['error' => $msg], $code);
}

function body(): array {
    return json_decode(file_get_contents('php://input'), true) ?? [];
}

// ─────────────────────────────────────────────
// Routing
// ─────────────────────────────────────────────

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// ── GET ?action=list ──────────────────────────
if ($action === 'list' && $method === 'GET') {
    respond(storage_list_notes());
}

// ── GET ?action=load&file=ID ──────────────────
if ($action === 'load' && $method === 'GET') {
    $id = safe_name($_GET['file'] ?? '');
    if ($id === '') fail('Missing file name');
    if (note_is_deleted($id)) fail('Note has been deleted', 404);

    $note    = storage_get_note($id);
    $current = $note['current'] ?? null;
    $content = ($current && isset($note['versions'][$current]))
        ? $note['versions'][$current]['content']
        : '';

    respond(['content' => $content]);
}

// ── POST ?action=save ─────────────────────────
if ($action === 'save' && $method === 'POST') {
    $b       = body();
    $id      = safe_name($b['file'] ?? '');
    $content = $b['content'] ?? '';
    // $author comes from require_auth() at the top of the file

    if ($id === '') fail('Invalid file name');
    if (note_is_deleted($id)) fail('Note has been deleted', 404);

    $note      = storage_get_note($id);
    $prev_vkey = $note['current'] ?? null;

    $vkey = storage_apply_write($id, $content, $author);

    // Determine actual prev for the changelog (may differ on overwrite)
    $written   = storage_get_note($id);
    $prev_vkey = $written['versions'][$vkey]['prev'] ?? null;

    changelog_append([
        'rev'          => next_rev(),
        'file'         => $id,
        'type'         => 'UPDATE',
        'ts'           => time(),
        'version'      => $vkey,
        'prev_version' => $prev_vkey,
    ]);

    respond(['ok' => true]);
}

// ── POST ?action=new ──────────────────────────
if ($action === 'new' && $method === 'POST') {
    $b  = body();
    $id = safe_name($b['file'] ?? '');
    if ($id === '') fail('Invalid file name');
    if (note_is_deleted($id)) fail('A deleted note with that name exists', 409);

    if (!storage_note_exists($id)) {
        storage_put_note($id, [
            'current'    => null,
            'created_at' => time(),
            'versions'   => [],
        ]);

        changelog_append([
            'rev'          => next_rev(),
            'file'         => $id,
            'type'         => 'CREATE',
            'ts'           => time(),
            'version'      => null,
            'prev_version' => null,
        ]);
    }

    respond(['ok' => true, 'file' => $id]);
}

// ── POST ?action=delete ───────────────────────
if ($action === 'delete' && $method === 'POST') {
    $b  = body();
    $id = safe_name($b['file'] ?? '');
    if ($id === '') fail('Invalid file name');

    // Idempotent — already deleted is fine
    if (note_is_deleted($id)) respond(['ok' => true]);

    if (!storage_note_exists($id)) fail('Note not found', 404);

    $note    = storage_get_note($id);
    $current = $note['current'] ?? null;

    storage_delete_note($id);

    changelog_append([
        'rev'          => next_rev(),
        'file'         => $id,
        'type'         => 'DELETE',
        'ts'           => time(),
        'version'      => null,
        'prev_version' => $current,
    ]);

    respond(['ok' => true]);
}

fail('Unknown action', 404);
