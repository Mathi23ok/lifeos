<?php

declare(strict_types=1);

require_once __DIR__ . '/auth.php';
life_os_require_auth();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    echo json_encode(['error' => 'Method not allowed.']);
    return;
}

if (!function_exists('curl_multi_init')) {
    http_response_code(503);
    echo json_encode(['error' => 'Weather service unavailable.']);
    return;
}

// Qeshm city and a nearby sea cell east of the island. Tide values are modeled, not gauge readings.
$urls = [
    'weather' => 'https://api.open-meteo.com/v1/forecast?latitude=26.9492&longitude=56.2691&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FTehran&forecast_days=4',
    'marine' => 'https://marine-api.open-meteo.com/v1/marine?latitude=26.94&longitude=56.35&hourly=sea_level_height_msl&current=sea_level_height_msl&timezone=Asia%2FTehran&forecast_days=2&cell_selection=sea',
];

$multi = curl_multi_init();
$handles = [];
foreach ($urls as $name => $url) {
    $handle = curl_init($url);
    $options = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 12,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
        CURLOPT_USERAGENT => 'Edi Life OS weather/1.0',
    ];
    // Windows PHP often lacks a configured CA bundle; use the OS certificate store.
    if (PHP_OS_FAMILY === 'Windows' && defined('CURLSSLOPT_NATIVE_CA')) {
        $options[CURLOPT_SSL_OPTIONS] = CURLSSLOPT_NATIVE_CA;
    }
    curl_setopt_array($handle, $options);
    curl_multi_add_handle($multi, $handle);
    $handles[$name] = $handle;
}

do {
    $status = curl_multi_exec($multi, $active);
    if ($active && $status === CURLM_OK) {
        curl_multi_select($multi, 1.0);
    }
} while ($active && $status === CURLM_OK);

$result = ['weather' => null, 'marine' => null];
foreach ($handles as $name => $handle) {
    $body = curl_multi_getcontent($handle);
    if (curl_errno($handle) === 0 && curl_getinfo($handle, CURLINFO_RESPONSE_CODE) === 200 && is_string($body)) {
        $data = json_decode($body, true);
        if (is_array($data) && empty($data['error'])) {
            $result[$name] = $data;
        }
    }
    curl_multi_remove_handle($multi, $handle);
}
curl_multi_close($multi);

if ($result['weather'] === null && $result['marine'] === null) {
    http_response_code(502);
}
echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
