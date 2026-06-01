<?php
/**
 * PHPUnit bootstrap — defines test constants before loading source files.
 *
 * Constants are set first so they take precedence over the production
 * values in api/config.php. Source files are loaded with @require_once
 * to suppress harmless E_WARNING from config.php redefining constants.
 */

define('TEST_TMP_ROOT', sys_get_temp_dir() . '/leaf-phpunit-' . getmypid());

define('DATA_ROOT',           TEST_TMP_ROOT . '/data/');
define('NOTES_DIR',           DATA_ROOT . 'notes/');
define('CHANGELOG_FILE',      DATA_ROOT . 'changelog.jsonl');
define('HTPASSWD_FILE',       DATA_ROOT . 'users.htpasswd');
define('REFRESH_TOKENS_FILE', DATA_ROOT . 'refresh_tokens.json');
define('JWT_SECRET',          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
define('JWT_EXPIRY',          900);
define('REFRESH_EXPIRY',      86400);
define('DELETED_NOTE_TTL_DAYS', 30);
define('COOKIE_PATH', '/');

@mkdir(DATA_ROOT, 0755, true);
@mkdir(NOTES_DIR, 0755, true);

$phpDir = __DIR__ . '/../../src/php';

@require_once $phpDir . '/jwt.php';
@require_once $phpDir . '/storage.php';
@require_once $phpDir . '/storage/FlatFileStorage.php';
@require_once $phpDir . '/users.php';

// ── Wire storage backend ───────────────────────────────────────────────

$GLOBALS['testStorage'] = new FlatFileStorage(DATA_ROOT, DELETED_NOTE_TTL_DAYS);
storage_set($GLOBALS['testStorage']);

/**
 * Invoke a private/protected method on the concrete FlatFileStorage
 * instance.  Used by unit tests that exercise internal building blocks
 * (resolveVersion, applyWrite, putNote, etc.).
 */
function storage_invoke(string $method, mixed ...$args): mixed
{
    $s = $GLOBALS['testStorage'] ?? null;
    if (!$s) throw new \RuntimeException('$testStorage not set in $GLOBALS');
    $ref = new ReflectionMethod($s, $method);
    return $ref->invoke($s, ...$args);
}
