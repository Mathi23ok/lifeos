<?php

declare(strict_types=1);
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/lib/state_store.php';
require_once __DIR__ . '/lib/obligations.php';
life_os_require_auth();
try {
    $store = new StateStore(life_os_db());
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    api_method(['GET', 'POST'], $method);
    if ($method === 'POST') {
        if (empty($_SESSION['state_csrf']) || !hash_equals((string) $_SESSION['state_csrf'], (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) throw new ApiException(403, 'invalid_request_token', 'Reload before saving.');
        api_json(obligation_mutate($store, api_body()));
    }
    if (isset($_GET['occurrence'])) api_json(obligation_find($store->get(OBLIGATIONS_KEY, obligations_default()), $_GET['occurrence'], finance_periods($store)));
    $start = api_date($_GET['start'] ?? substr(api_today(), 0, 7) . '-01', 'start');
    $end = api_date($_GET['end'] ?? (new DateTimeImmutable($start ?? api_today()))->modify('last day of this month')->format('Y-m-d'), 'end');
    if (!$start || !$end || $start > $end || $end > (new DateTimeImmutable(api_today()))->modify('+5 years')->format('Y-m-d') || (new DateTimeImmutable($start))->diff(new DateTimeImmutable($end))->days > 366) throw new ApiException(422, 'validation_error', 'Choose a date range of at most one year, up to five years ahead.');
    api_json(obligation_view($store->get(OBLIGATIONS_KEY, obligations_default()), finance_periods($store), $start, $end));
} catch (ApiException $error) { api_error($error->status, $error->errorCode, $error->getMessage()); }
catch (Throwable $error) { error_log('LifeOS obligations: ' . get_class($error)); api_error(503, 'obligations_unavailable', 'Unable to load or save financial commitments.'); }
