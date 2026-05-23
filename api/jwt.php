<?php
/**
 * jwt.php — minimal JWT (JSON Web Token) implementation
 *
 * Supports HS256 (HMAC-SHA256) only — sufficient for symmetric auth
 * where the same server both issues and verifies tokens.
 *
 * No external library required. Uses only PHP core functions:
 *   hash_hmac(), base64_encode(), json_encode(), json_decode()
 *
 * Usage:
 *   $token   = jwt_encode(['sub' => 'alice', 'exp' => time() + 900]);
 *   $payload = jwt_decode($token);   // false if invalid or expired
 */

require_once __DIR__ . '/config.php';

// ── Helpers ───────────────────────────────────────────────────────────────

function base64url_encode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function base64url_decode(string $data): string|false {
    $padded = str_pad(strtr($data, '-_', '+/'), strlen($data) % 4 === 0 ? strlen($data) : strlen($data) + 4 - strlen($data) % 4, '=');
    return base64_decode($padded);
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Issue a signed JWT.
 *
 * @param  array  $payload  Claims to include. 'iat' and 'exp' are set
 *                          automatically if not provided.
 * @param  int    $expiry   Seconds until expiry (default: JWT_EXPIRY from config)
 * @return string           Signed JWT string
 */
function jwt_encode(array $payload, int $expiry = JWT_EXPIRY): string {
    $now = time();

    $payload['iat'] ??= $now;
    $payload['exp'] ??= $now + $expiry;

    $header  = base64url_encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $body    = base64url_encode(json_encode($payload));
    $sig     = base64url_encode(hash_hmac('sha256', "$header.$body", JWT_SECRET, true));

    return "$header.$body.$sig";
}

/**
 * Verify and decode a JWT.
 *
 * @param  string       $token  The JWT string
 * @return array|false          Payload array, or false if invalid/expired
 */
function jwt_decode(string $token): array|false {
    $parts = explode('.', $token);
    if (count($parts) !== 3) return false;

    [$header, $body, $sig] = $parts;

    // Verify signature
    $expected = base64url_encode(hash_hmac('sha256', "$header.$body", JWT_SECRET, true));
    if (!hash_equals($expected, $sig)) return false;

    // Decode payload
    $payload = json_decode(base64url_decode($body), true);
    if (!is_array($payload)) return false;

    // Check expiry
    if (isset($payload['exp']) && $payload['exp'] < time()) return false;

    return $payload;
}
