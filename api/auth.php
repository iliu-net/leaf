<?php
/**
 * auth.php — authentication endpoints
 *
 * POST ?action=login    ← {username, password}
 *                       → {ok, token, username, expires}
 *                       + Set-Cookie: refresh_token (httpOnly)
 *
 * POST ?action=refresh  (refresh_token cookie sent automatically)
 *                       → {ok, token, username, expires}
 *
 * POST ?action=logout   (refresh_token cookie sent automatically)
 *                       → {ok: true}
 *                       + clears refresh_token cookie
 *
 * Access tokens (JWT):
 *   - Short-lived (JWT_EXPIRY, default 15 min)
 *   - Stored in JS memory only — never in localStorage/cookies
 *   - Verified by auth_guard.php on every sync.php request
 *
 * Refresh tokens:
 *   - Long-lived (REFRESH_EXPIRY, default 30 days)
 *   - Stored in httpOnly + Secure + SameSite=Strict cookie
 *   - Kept server-side in REFRESH_TOKENS_FILE
 *   - Invalidated on logout
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/jwt.php';
require_once __DIR__ . '/users.php';

header('Access-Control-Allow-Origin: ' . CORS_ALLOW_POLICY);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'POST required']); exit; }

$action = $_GET['action'] ?? '';

// ── Refresh token store helpers ───────────────────────────────────────────

/**
 * Load all stored refresh tokens from the JSON file.
 *
 * @return array<string, array{user: string, expires: int}>  Map of token => metadata
 */
function load_refresh_tokens(): array {
    if (!file_exists(REFRESH_TOKENS_FILE)) return [];
    $data = json_decode(file_get_contents(REFRESH_TOKENS_FILE), true);
    return is_array($data) ? $data : [];
}

/**
 * Persist refresh tokens to the JSON file atomically.
 *
 * Automatically prunes expired tokens before writing to keep the file small.
 *
 * @param array<string, array{user: string, expires: int}> $tokens  Map of token => metadata
 * @return void
 */
function save_refresh_tokens(array $tokens): void {
    // Prune expired tokens on every write to keep the file small
    $now    = time();
    $tokens = array_filter($tokens, fn($t) => ($t['expires'] ?? 0) > $now);
    $tmp    = REFRESH_TOKENS_FILE . '.tmp.' . getmypid();
    file_put_contents($tmp, json_encode($tokens, JSON_PRETTY_PRINT));
    rename($tmp, REFRESH_TOKENS_FILE);
}

/**
 * Generate a cryptographically secure random refresh token.
 *
 * @return string  64-character hex string
 */
function generate_refresh_token(): string {
    return bin2hex(random_bytes(32));   // 64 hex chars, cryptographically random
}

/**
 * Set the httpOnly refresh token cookie on the response.
 *
 * Uses SameSite=Strict and Secure when served over HTTPS.
 *
 * @param string $token  The refresh token value
 * @return void
 */
function set_refresh_cookie(string $token): void {
    $secure   = isset($_SERVER['HTTPS']);
    $expires  = time() + REFRESH_EXPIRY;
    // Use raw setcookie for SameSite=Strict support on older PHP
    header(sprintf(
        'Set-Cookie: refresh_token=%s; Path=/; Expires=%s; HttpOnly; SameSite=Strict%s',
        rawurlencode($token),
        gmdate('D, d M Y H:i:s T', $expires),
        $secure ? '; Secure' : ''
    ));
}

/**
 * Clear the refresh token cookie by setting an expired value.
 *
 * @return void
 */
function clear_refresh_cookie(): void {
    header('Set-Cookie: refresh_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict');
}

/**
 * Read the refresh token from the incoming request cookie.
 *
 * @return string  The raw refresh token value, or empty string if absent
 */
function get_refresh_token_from_cookie(): string {
    return $_COOKIE['refresh_token'] ?? '';
}

/**
 * Send a JSON response and terminate execution.
 *
 * @param mixed $data  Data to encode as JSON
 * @param int   $code  HTTP status code (default 200)
 * @return never
 */
function respond(mixed $data, int $code = 200): never {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

/**
 * Create a signed JWT access token for the given user.
 *
 * @param string $username  The authenticated username (stored in JWT 'sub' claim)
 * @return array{token: string, username: string, expires: int}  Token bundle
 */
function issue_access_token(string $username): array {
    $expires = time() + JWT_EXPIRY;
    $token   = jwt_encode(['sub' => $username, 'exp' => $expires]);
    return ['token' => $token, 'username' => $username, 'expires' => $expires];
}

// ── POST ?action=login ────────────────────────────────────────────────────

if ($action === 'login') {
    $body     = json_decode(file_get_contents('php://input'), true) ?? [];
    $username = trim($body['username'] ?? '');
    $password = $body['password'] ?? '';

    $valid = validate_user($username, $password);
    if (!$valid) {
        // Constant-time response to avoid user enumeration via timing
        sleep(random_int(7, 12));
        respond(['error' => 'Invalid username or password'], 401);
    }

    // Issue access token
    $access = issue_access_token($valid);

    // Issue refresh token and persist it
    $refresh_token = generate_refresh_token();
    $tokens        = load_refresh_tokens();
    $tokens[$refresh_token] = [
        'user'    => $valid,
        'expires' => time() + REFRESH_EXPIRY,
    ];
    save_refresh_tokens($tokens);
    set_refresh_cookie($refresh_token);

    respond(['ok' => true, ...$access]);
}

// ── POST ?action=refresh ──────────────────────────────────────────────────

if ($action === 'refresh') {
    $refresh_token = get_refresh_token_from_cookie();
    if ($refresh_token === '') respond(['error' => 'No refresh token'], 401);

    $tokens = load_refresh_tokens();
    $entry  = $tokens[$refresh_token] ?? null;

    if (!$entry || ($entry['expires'] ?? 0) < time()) {
        clear_refresh_cookie();
        respond(['error' => 'Refresh token expired or invalid'], 401);
    }

    $username = $entry['user'];

    // Rotate: issue a new refresh token, invalidate the old one
    unset($tokens[$refresh_token]);
    $new_refresh = generate_refresh_token();
    $tokens[$new_refresh] = [
        'user'    => $username,
        'expires' => time() + REFRESH_EXPIRY,
    ];
    save_refresh_tokens($tokens);
    set_refresh_cookie($new_refresh);

    // Issue new access token
    $access = issue_access_token($username);
    respond(['ok' => true, ...$access]);
}

// ── POST ?action=logout ───────────────────────────────────────────────────

if ($action === 'logout') {
    $refresh_token = get_refresh_token_from_cookie();

    if ($refresh_token !== '') {
        $tokens = load_refresh_tokens();
        unset($tokens[$refresh_token]);
        save_refresh_tokens($tokens);
    }

    clear_refresh_cookie();
    respond(['ok' => true]);
}

respond(['error' => 'Unknown action'], 404);
