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

/**
 * Verify the Bearer token and return the authenticated username.
 * Exits with 401 if authentication fails.
 *
 * @return string  The authenticated username (JWT 'sub' claim)
 */
function require_auth(): string {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';

    if (!str_starts_with($header, 'Bearer ')) {
        http_response_code(401);
        echo json_encode(['error' => 'Missing or malformed Authorization header']);
        exit;
    }

    $token   = substr($header, 7);
    $payload = jwt_decode($token);

    if ($payload === false) {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid or expired token']);
        exit;
    }

    $username = $payload['sub'] ?? '';
    if ($username === '') {
        http_response_code(401);
        echo json_encode(['error' => 'Token missing subject claim']);
        exit;
    }

    return $username;
}
