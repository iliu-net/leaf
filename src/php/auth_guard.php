<?php
/**
 * auth_guard.php — JWT verification guard
 *
 * Include at the top of any endpoint that requires authentication:
 *
 *   require_once __DIR__ . '/auth_guard.php';
 *   $author = require_auth();   // returns username or exits with 401
 *
 * Expects the request to carry:
 *   Authorization: Bearer <access_token>
 *
 * Returns the username from the JWT 'sub' claim.
 * Exits with HTTP 401 and a JSON error body if the token is missing,
 * invalid, or expired.
 *
 * Access tokens are short-lived (JWT_EXPIRY). The client is responsible
 * for silently refreshing via auth.php?action=refresh before expiry.
 */

require_once __DIR__ . '/jwt.php';
require_once __DIR__ . '/http-helpers.php';

/**
 * Verify the Bearer token and return the authenticated username.
 * Exits with 401 if authentication fails.
 *
 * @return string  The authenticated username (JWT 'sub' claim)
 */
function require_auth(): string {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';

    if (!str_starts_with($header, 'Bearer ')) {
        fail('Missing or malformed Authorization header', 401);
    }

    $token   = substr($header, 7);
    $payload = jwt_decode($token);

    if ($payload === false) {
        fail('Invalid or expired token', 401);
    }

    $username = $payload['sub'] ?? '';
    if ($username === '') {
        fail('Token missing subject claim', 401);
    }

    return $username;
}

/**
 * Return the authenticated username, or a default when auth is disabled.
 *
 * Checks $spa_config['auth']['enabled'] — when false, returns 'anonymous'
 * without requiring any Authorization header.  When auth is enabled (the
 * default), delegates to require_auth(), which exits with 401 on failure.
 *
 * Callers that currently use  $author = require_auth();  should switch to
 * $author = auth_username();  so deployments can disable auth via spa-config.
 *
 * @return string  The authenticated username, or 'anonymous' when auth is off.
 */
function auth_username(): string {
    global $spa_config;
    $enabled = $spa_config['auth']['enabled'] ?? true;
    if (!$enabled) return 'anonymous';
    return require_auth();
}
