<?php

declare(strict_types=1);

require_once __DIR__ . '/db.php';

function life_os_start_session(): void
{
    if (session_status() === PHP_SESSION_NONE) {
        session_name('edi_life_os');
        session_set_cookie_params([
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        ]);
        session_start();
    }
}

function life_os_username(): string
{
    return (string) life_os_credentials()['username'];
}

function life_os_credentials(): array
{
    $credentials = life_os_db()->query('SELECT username, password_hash FROM app_credentials WHERE credential_id = 1')->fetch();
    if (!is_array($credentials)) {
        throw new RuntimeException('App sign-in credentials are not initialized.');
    }
    return $credentials;
}

function life_os_credential_fingerprint(array $credentials): string
{
    return hash('sha256', $credentials['username'] . "\0" . $credentials['password_hash']);
}

function life_os_is_authenticated(): bool
{
    life_os_start_session();
    if (($_SESSION['life_os_authenticated'] ?? false) !== true) return false;

    try {
        $credentials = life_os_credentials();
        $fingerprint = life_os_credential_fingerprint($credentials);
        $sessionFingerprint = (string) ($_SESSION['life_os_fingerprint'] ?? '');
        if (hash_equals($fingerprint, $sessionFingerprint)) return true;

        // Upgrade sessions created before credentials moved from config.php to MySQL.
        $config = life_os_config();
        $legacyFingerprint = hash('sha256', $config['username'] . "\0" . $config['password']);
        if ($credentials['username'] === $config['username']
            && password_verify($config['password'], $credentials['password_hash'])
            && hash_equals($legacyFingerprint, $sessionFingerprint)) {
            $_SESSION['life_os_username'] = $credentials['username'];
            $_SESSION['life_os_fingerprint'] = $fingerprint;
            return true;
        }
    } catch (Throwable) {
    }
    return false;
}

function life_os_require_auth(): void
{
    if (!life_os_is_authenticated()) {
        $requestUri = (string) ($_SERVER['REQUEST_URI'] ?? '');
        if (str_contains((string) ($_SERVER['HTTP_ACCEPT'] ?? ''), 'application/json') || str_contains($requestUri, '/api.php') || str_contains($requestUri, '/state.php') || str_contains($requestUri, '/credentials.php')) {
            http_response_code(401);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['error' => 'Authentication required.'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $target = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        header('Location: /login.php?redirect=' . rawurlencode($target));
        exit;
    }
}

function life_os_login(string $username, string $password): bool
{
    life_os_start_session();
    $credentials = life_os_credentials();
    if (!hash_equals((string) $credentials['username'], $username) || !password_verify($password, (string) $credentials['password_hash'])) {
        return false;
    }

    session_regenerate_id(true);
    $_SESSION['life_os_authenticated'] = true;
    $_SESSION['life_os_username'] = $username;
    $_SESSION['life_os_fingerprint'] = life_os_credential_fingerprint($credentials);
    return true;
}

function life_os_logout(): void
{
    life_os_start_session();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], (bool) $params['secure'], (bool) $params['httponly']);
    }
    session_destroy();
}
