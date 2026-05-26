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

@mkdir(DATA_ROOT, 0755, true);
@mkdir(NOTES_DIR, 0755, true);

$apiDir = __DIR__ . '/../../api';

@require_once $apiDir . '/jwt.php';
@require_once $apiDir . '/storage.php';
@require_once $apiDir . '/users.php';
