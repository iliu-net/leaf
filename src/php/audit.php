<?php

/**
 * audit.php — audit log wiring
 *
 * This file provides the global accessor for the audit backend.  The actual
 * implementation is selected in each instance's api/config.php via audit_set().
 *
 * Usage:
 *   audit()->log('AUTH_LOGIN', ['user' => $username]);
 *   audit()->purge('sync');
 */

require_once __DIR__ . '/audit/AuditInterface.php';

$_audit = null;

/**
 * Set the global audit backend instance.
 *
 * Called once during bootstrap (api/config.php).
 * Must be called before any audit()->log() or audit()->purge() call.
 */
function audit_set(AuditInterface $a): void
{
    global $_audit;
    $_audit = $a;
}

/**
 * Get the global audit backend instance.
 *
 * @throws \RuntimeException if audit_set() was not called during bootstrap
 */
function audit(): AuditInterface
{
    global $_audit;
    if (!$_audit) {
        throw new \RuntimeException(
            'Audit backend not initialised — call audit_set() during bootstrap'
        );
    }
    return $_audit;
}
