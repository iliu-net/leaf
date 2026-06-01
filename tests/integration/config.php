<?php
/**
 * config.php — Test configuration for integration tests.
 *
 * Points all storage to temp directories inside the test environment
 * so tests never touch production data. Replaces api/config.php.
 *
 * This file is placed at $ENV_DIR/api/ alongside index.php.
 * dirname(__DIR__) resolves to the test environment root.
 */

define('DATA_ROOT',           dirname(__DIR__) . '/data/');
define('NOTES_DIR',           DATA_ROOT . 'notes/');
define('CHANGELOG_FILE',      DATA_ROOT . 'changelog.jsonl');
define('HTPASSWD_FILE',       DATA_ROOT . 'users.htpasswd');
define('REFRESH_TOKENS_FILE', DATA_ROOT . 'refresh_tokens.json');
define('JWT_SECRET',          'integration_test_secret_0123456789abcdef0123456789abcdef');
define('JWT_EXPIRY',          900);
define('REFRESH_EXPIRY',      86400);
define('DELETED_NOTE_TTL_DAYS', 30);

// ── Shared code path ──────────────────────────────────────────────────────
define('LEAF_PHP_DIR', dirname(__DIR__) . '/src/php/');

// ── Storage backend ──────────────────────────────────────────────────────
require_once LEAF_PHP_DIR . 'storage.php';
require_once LEAF_PHP_DIR . 'storage/FlatFileStorage.php';
storage_set(new FlatFileStorage(DATA_ROOT, DELETED_NOTE_TTL_DAYS));

define('AUDIT_RETENTION_DAYS', 90);
define('AUDIT_LOG_IPS',       false);

// ── Audit backend ──────────────────────────────────────────────────────────
require_once LEAF_PHP_DIR . 'audit.php';
require_once LEAF_PHP_DIR . 'audit/FlatFileAudit.php';
audit_set(new FlatFileAudit(DATA_ROOT, AUDIT_LOG_IPS, AUDIT_RETENTION_DAYS));

// Cookie path — scoped to "/" for the test server (it serves from root)
define('COOKIE_PATH', '/');
// ── SPA client config ─────────────────────────────────────────────────────
$spa_config = [
    'markdown' => [
        'html' => false,
        'plugins' => [
            'abbr',
            'deflist',
            'emoji',
            'footnote',
            'inline-extras',
            'wikilinks',
            'multimdtable',
            'tasklists',
            'toc',
        ],
    ],
    'deleted_notes_ttl_days' => 7,
    'timestamp_format'      => null,
    'spellcheck' => [
        'default_lang'    => 'en-GB',
        'preferred_langs' => ['en-US', 'en-GB', 'es', 'nl'],
    ],
    'autosave' => [
        'enabled'  => true,
        'delay_ms' => 2000,
    ],
];

define('CORS_ALLOW_POLICY',   '*');
