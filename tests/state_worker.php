<?php

declare(strict_types=1);

$directory = $argv[1] ?? '';
if (!preg_match('/^lifeos_api_test_[a-f0-9]{12}$/D', basename($directory)) || realpath(dirname($directory)) !== realpath(sys_get_temp_dir())) throw new RuntimeException('Only a disposable fixture directory is allowed.');
require $directory . '/db.php';
require dirname(__DIR__) . '/lib/state_store.php';
$store = new StateStore(life_os_db());
for ($index = 0; $index < 25; $index++) {
    $store->mutate(['concurrency_fixture' => ['count' => 0]], function (array &$docs) {
        usleep(5000);
        $docs['concurrency_fixture']['count']++;
    });
}
