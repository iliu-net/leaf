<?php
/**
 * spa-config.php — expose $spa_config to the SPA client
 *
 * Returns the $spa_config array (defined in config.php) as JSON.
 * Degrades gracefully to {} if $spa_config is not defined, so
 * existing deployments without the array continue to work.
 *
 * Called by router.php for GET /api/index.php/spa-config.
 */

header('Access-Control-Allow-Origin: ' . CORS_ALLOW_POLICY);
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Content-Type: application/json');
echo json_encode($spa_config ?? (object)[]);
