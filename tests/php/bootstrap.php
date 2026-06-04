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

// Path to the src/php directory — used by test classes to load backends.
define('LEAF_PHP_DIR', __DIR__ . '/../../src/php/');

// Shared source files required by all tests.
@require_once LEAF_PHP_DIR . 'jwt.php';
@require_once LEAF_PHP_DIR . 'storage.php';
@require_once LEAF_PHP_DIR . 'users.php';

// ── Storage backend ───────────────────────────────────────────────────
//
// Each test class wires its own backend via createStorage().
// The old "StorageTest" (internals) and legacy tests that don't extend
// StorageContractTestBase need a default backend.  FlatFileStorage is
// always available and serves as the default.

@require_once LEAF_PHP_DIR . 'storage/FlatFileStorage.php';

// Default wiring — test classes that extend StorageContractTestBase
// will override this in their setUp().
$GLOBALS['testStorage'] = new FlatFileStorage(DATA_ROOT, DELETED_NOTE_TTL_DAYS);
storage_set($GLOBALS['testStorage']);

/**
 * Invoke a private/protected method on the concrete storage instance.
 * Used by unit tests that exercise internal building blocks
 * (resolveVersion, applyWrite, putNote, etc.).
 */
function storage_invoke(string $method, mixed ...$args): mixed
{
    $s = storage();
    if (!$s) throw new \RuntimeException('storage() not initialised');
    $ref = new ReflectionMethod($s, $method);
    return $ref->invoke($s, ...$args);
}

/** Git-stage TTL in hours (0 = immediate commit, no staging — test mode). */
define('STAGE_FLUSH_HOURS', 0);

/** Whether the active backend is GitStorage (needed by legacy tests). */
define('IS_GIT_BACKEND', getenv('TEST_STORAGE_BACKEND') === 'git');
