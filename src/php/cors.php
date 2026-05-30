<?php
/**
 * cors.php — CORS + method guard
 *
 * Bare require_once at the top of any API endpoint file, AFTER
 * http-helpers.php.  Sets CORS headers, handles OPTIONS preflight,
 * and enforces methods as specified by the headers.
 *
 * Callers that need custom CORS headers should set them BEFORE
 * requiring this file.  This file skips any header already emitted.
 */

// Polyfill for PHP < 8.4
if (!function_exists('header_exists')) {
    function header_exists(string $name): bool {
        $prefix = strtolower($name) . ':';
        foreach (headers_list() as $h) {
            if (str_starts_with(strtolower($h), $prefix)) return true;
        }
        return false;
    }
}
function _method_check(string $method) {
  $prefix = strtolower('Access-Control-Allow-Methods:');
  foreach (headers_list() as $h) {
    if (str_starts_with(strtolower($h), $prefix)) {
      $allowed = array_diff(array_map('trim', explode(',', explode(':', $h,2)[1])),['OPTIONS']);
      if (!in_array($method, $allowed)) {
	http_response_code(405);
	echo json_encode(['error' => implode(',',$allowed).' required']);
	exit;
      }
      return;
    }
  }
  // This should never happen!
  throw new \LogicException('Should never be reached');
}


if (!header_exists('Access-Control-Allow-Origin')) {
    header('Access-Control-Allow-Origin: ' . CORS_ALLOW_POLICY);
}
if (!header_exists('Access-Control-Allow-Methods')) {
    header('Access-Control-Allow-Methods: POST, OPTIONS');
}
if (!header_exists('Access-Control-Allow-Headers')) {
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
}
if (!header_exists('Content-Type')) {
    header('Content-Type: application/json');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
_method_check($_SERVER['REQUEST_METHOD']);
