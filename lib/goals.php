<?php

declare(strict_types=1);

const GOALS_KEY = 'edi_goals_v1';

function goals_status(array $goal): string
{
    if (($goal['status'] ?? '') === 'archived') return 'archived';
    $tasks = $goal['tasks'] ?? [];
    return count($tasks) > 0 && count(array_filter($tasks, fn ($task) => ($task['done'] ?? false) === true)) === count($tasks) ? 'completed' : 'active';
}

function goals_validate(array $body, array $existing = [], bool $create = false): array
{
    api_fields($body, ['title', 'specific', 'category', 'relevant', 'priority', 'deadline', 'startDate', 'notes', 'status', 'measures', 'tasks']);
    $goal = $create ? ['id' => api_uuid(), 'title' => '', 'specific' => '', 'category' => '', 'relevant' => '', 'priority' => 'medium', 'deadline' => null, 'startDate' => null, 'notes' => '', 'status' => 'active', 'measures' => [], 'tasks' => [], 'metric' => '', 'target' => null, 'unit' => '', 'createdAt' => api_now()] : $existing;
    foreach ($body as $field => $value) {
        if (in_array($field, ['title', 'specific', 'category', 'relevant', 'notes'], true)) $goal[$field] = api_text($value, $field, in_array($field, ['specific', 'relevant', 'notes'], true) ? 20000 : 200, $field === 'title');
        elseif ($field === 'priority') $goal[$field] = api_enum($value, $field, ['low', 'medium', 'high']);
        elseif ($field === 'status') $goal[$field] = api_enum($value, $field, ['active', 'archived']);
        elseif (in_array($field, ['deadline', 'startDate'], true)) $goal[$field] = api_date($value, $field);
        elseif ($field === 'measures') {
            $goal[$field] = [];
            foreach (api_list($value, $field, 100) as $measure) {
                if (!is_array($measure)) throw new ApiException(422, 'validation_error', 'Each measure must be an object.');
                api_fields($measure, ['id', 'metric', 'target', 'unit', 'current']);
                $id = isset($measure['id']) ? api_text($measure['id'], 'measure.id', 128, true) : api_uuid();
                $old = array_values(array_filter($existing['measures'] ?? [], fn ($item) => ($item['id'] ?? '') === $id))[0] ?? [];
                $entry = array_merge(['id' => $id, 'unit' => '', 'target' => null, 'current' => null], $old);
                $entry['metric'] = api_text($measure['metric'] ?? $old['metric'] ?? '', 'measure.metric', 120, true);
                if (isset($measure['unit'])) $entry['unit'] = api_text($measure['unit'], 'measure.unit', 20);
                foreach (['target', 'current'] as $numeric) if (array_key_exists($numeric, $measure)) $entry[$numeric] = $measure[$numeric] === null ? null : api_number($measure[$numeric], "measure.$numeric");
                $goal[$field][] = $entry;
            }
            $goal['metric'] = $goal['measures'][0]['metric'] ?? '';
            $goal['target'] = $goal['measures'][0]['target'] ?? null;
            $goal['unit'] = $goal['measures'][0]['unit'] ?? '';
        } elseif ($field === 'tasks') {
            $goal[$field] = [];
            foreach (api_list($value, $field) as $task) {
                if (!is_array($task)) throw new ApiException(422, 'validation_error', 'Each task must be an object.');
                api_fields($task, ['id', 'title', 'done', 'due_date', 'priority']);
                $id = isset($task['id']) ? api_text($task['id'], 'task.id', 128, true) : api_uuid();
                $old = array_values(array_filter($existing['tasks'] ?? [], fn ($item) => ($item['id'] ?? '') === $id))[0] ?? [];
                $entry = array_merge(['id' => $id, 'done' => false], $old);
                $entry['title'] = api_text($task['title'] ?? $old['title'] ?? '', 'task.title', 500, true);
                if (array_key_exists('done', $task)) $entry['done'] = api_bool($task['done'], 'task.done');
                if (array_key_exists('due_date', $task)) $entry['dueDate'] = api_date($task['due_date'], 'task.due_date');
                if (isset($task['priority'])) $entry['priority'] = api_enum($task['priority'], 'task.priority', ['low', 'medium', 'high']);
                $goal[$field][] = $entry;
            }
        }
    }
    api_text($goal['title'] ?? '', 'title', 200, true);
    foreach (['tasks', 'measures'] as $field) {
        $ids = array_column($goal[$field] ?? [], 'id');
        if (count($ids) !== count(array_unique($ids))) throw new ApiException(422, 'validation_error', "Duplicate $field ids.");
    }
    if (!empty($goal['deadline']) && !empty($goal['startDate']) && $goal['startDate'] > $goal['deadline']) throw new ApiException(422, 'validation_error', 'startDate must not follow deadline.');
    $goal['updatedAt'] = api_now();
    return $goal;
}

function goals_api(StateStore $store, string $method, ?string $id, array $body): array
{
    api_method($id === null ? ['GET', 'POST'] : ['GET', 'PATCH', 'DELETE'], $method);
    if ($method === 'GET') {
        $goals = $store->get(GOALS_KEY, ['goals' => []])['goals'];
        if ($id === null) return $goals;
        foreach ($goals as $goal) if ((string) $goal['id'] === $id) return $goal;
        throw new ApiException(404, 'not_found', 'Goal not found.');
    }
    return $store->mutate([GOALS_KEY => ['goals' => []]], function (array &$docs) use ($method, $id, $body) {
        $goals =& $docs[GOALS_KEY]['goals'];
        if ($method === 'POST') { $goal = goals_validate($body, [], true); $goals[] = $goal; return $goal; }
        foreach ($goals as $index => &$goal) {
            if ((string) $goal['id'] !== $id) continue;
            if ($method === 'DELETE') { array_splice($goals, $index, 1); return ['deleted' => true]; }
            $goal = goals_validate($body, $goal);
            return $goal;
        }
        throw new ApiException(404, 'not_found', 'Goal not found.');
    });
}
