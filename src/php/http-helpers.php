<?php
/**
 * http-helpers.php — unified JSON response functions
 *
 * Defines respond() and fail().  Require this once in any endpoint
 * that produces JSON responses.
 */

/**
 * Send a JSON response and terminate execution.
 *
 * @param mixed $data  Data to encode as JSON
 * @param int   $code  HTTP status code (default 200)
 * @return never
 */
function respond(mixed $data, int $code = 200): never {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Send a JSON error response and terminate execution.
 *
 * @param string $msg   Error message
 * @param int    $code  HTTP status code (default 400)
 * @return never
 */
function fail(string $msg, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}
