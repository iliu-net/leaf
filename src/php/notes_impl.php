<?php
/**
 * notes_impl.php — dump note content or list notes via the storage backend
 *
 * Usage:
 *   php api/index.php notes <id>       Dump the latest content of a note
 *   php api/index.php notes --list     List all live note IDs
 *
 * Examples:
 *   php api/index.php notes welcome
 *   php api/index.php notes --list
 */

// ── Helpers ───────────────────────────────────────────────────────────────

function notes_usage(): never {
    fwrite(STDERR, "Usage: php api/index.php notes <id>\n");
    fwrite(STDERR, "       php api/index.php notes --list\n");
    exit(1);
}

// ── Dispatch ──────────────────────────────────────────────────────────────

$arg = $argv[2] ?? '';

if ($arg === '' || $arg === '--help' || $arg === '-h') {
    notes_usage();
}

if ($arg === '--list') {
    $notes = storage()->listNotes();
    if (empty($notes)) {
        echo "No notes found.\n";
    } else {
        foreach ($notes as $note) {
            echo $note['id'] . "\n";
        }
    }
    exit(0);
}

// ── Dump note content ─────────────────────────────────────────────────────

$id = $arg;

$note = storage()->getNote($id);
if (!$note) {
    fwrite(STDERR, "Note not found: {$id}\n");
    exit(1);
}

$current = $note['current'] ?? null;
if ($current === null) {
    fwrite(STDERR, "Note has no current version\n");
    exit(1);
}

$version = $note['versions'][$current] ?? null;
if ($version === null) {
    fwrite(STDERR, "Current version '{$current}' not found\n");
    exit(1);
}

$content = $version['content'] ?? '';

if ($content === '') {
    // Empty content is valid — a blank note
    echo "\n";
    exit(0);
}

echo $content;

// Trailing newline only if content doesn't already end with one
if (!str_ends_with($content, "\n")) {
    echo "\n";
}
