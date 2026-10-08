<?php

// Docker configuration: every value comes from the container environment.
// The API token is read separately from LIFEOS_API_TOKEN by api_auth.php.
$env = static fn (string $name, string $default = ''): string => (string) (getenv($name) ?: $default);

return [
    'db_host' => $env('LIFEOS_DB_HOST', 'db'),
    'db_port' => (int) $env('LIFEOS_DB_PORT', '3306'),
    'db_name' => $env('LIFEOS_DB_NAME', 'lifeos'),
    'db_user' => $env('LIFEOS_DB_USER', 'lifeos'),
    'db_password' => $env('LIFEOS_DB_PASSWORD'),
    'username' => $env('LIFEOS_USERNAME'),
    'password' => $env('LIFEOS_PASSWORD'),
    'api_allow_secret_notes' => $env('LIFEOS_API_ALLOW_SECRET_NOTES') === 'true',
];
