<?php

declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/api_auth.php';
require_once __DIR__ . '/lib/api_router.php';

try {
    $config = life_os_config();
    api_require_auth($config);
    $path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH) ?: '';
    if (!str_starts_with($path, '/api/v1/')) throw new ApiException(404, 'not_found', 'API route not found.');
    $path = rawurldecode(substr($path, strlen('/api/v1/')));
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    [$data, $status] = api_dispatch(life_os_db(), $method, $path, api_body(), $_GET, $config);
    api_json($data, $status);
} catch (ApiException $error) {
    api_error($error->status, $error->errorCode, $error->getMessage(), $error->details);
} catch (PDOException $error) {
    error_log('LifeOS API database failure (' . $error->getCode() . ').');
    api_error(503, 'database_unavailable', 'Database unavailable.');
} catch (Throwable $error) {
    // Do not log request headers, bodies, config values or SQL parameters.
    error_log('LifeOS API internal failure: ' . get_class($error));
    api_error(500, 'internal_error', 'Unable to process this request.');
}
