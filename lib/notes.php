<?php

declare(strict_types=1);

const NOTES_KEY = 'edi_notes_v1';

function notes_visible(array $note, bool $includeSecret, bool $allowSecret): bool
{
    return ($note['secret'] ?? false) !== true || ($includeSecret && $allowSecret);
}

function notes_validate(array $body, array $existing = [], bool $create = false): array
{
    api_fields($body, ['title', 'body', 'color', 'fontFace', 'fontSize', 'secret']);
    $note = $create ? ['id' => api_uuid(), 'title' => '', 'body' => '', 'color' => 'yellow', 'fontFace' => 'sans', 'fontSize' => 14, 'secret' => false, 'x' => 80, 'y' => 80, 'w' => 220, 'h' => 200, 'z' => 1] : $existing;
    foreach ($body as $field => $value) {
        if ($field === 'title' || $field === 'body') $note[$field] = api_text($value, $field, $field === 'body' ? 100000 : 500);
        elseif ($field === 'color') $note[$field] = api_enum($value, $field, ['yellow', 'pink', 'blue', 'green', 'lavender', 'peach']);
        elseif ($field === 'fontFace') $note[$field] = api_enum($value, $field, ['sans', 'serif', 'mono']);
        elseif ($field === 'secret') $note[$field] = api_bool($value, $field);
        elseif ($field === 'fontSize') {
            if (!is_int($value) || $value < 11 || $value > 28) throw new ApiException(422, 'validation_error', 'fontSize must be an integer between 11 and 28.');
            $note[$field] = $value;
        }
    }
    $note['updated'] = api_now();
    return $note;
}

function notes_api(StateStore $store, string $method, ?string $id, array $body, bool $includeSecret, bool $allowSecret): array
{
    api_method($id === null ? ['GET', 'POST'] : ['GET', 'PATCH', 'DELETE'], $method);
    if ($includeSecret && !$allowSecret) throw new ApiException(403, 'secret_notes_disabled', 'Secret-note API access is disabled.');
    $visible = fn ($note) => notes_visible($note, $includeSecret, $allowSecret);
    if ($method === 'GET') {
        $notes = array_values(array_filter($store->get(NOTES_KEY, ['notes' => [], 'connections' => []])['notes'], $visible));
        if ($id === null) return $notes;
        foreach ($notes as $note) if ((string) $note['id'] === $id) return $note;
        throw new ApiException(404, 'not_found', 'Note not found.');
    }
    return $store->mutate([NOTES_KEY => ['notes' => [], 'connections' => []]], function (array &$docs) use ($method, $id, $body, $visible) {
        $document =& $docs[NOTES_KEY];
        if ($method === 'POST') {
            $note = notes_validate($body, [], true);
            $note['z'] = max(array_merge([0], array_column($document['notes'], 'z'))) + 1;
            $document['notes'][] = $note;
            return $visible($note) ? $note : ['id' => $note['id'], 'secret' => true];
        }
        foreach ($document['notes'] as $index => &$note) if ((string) $note['id'] === $id && $visible($note)) {
            if ($method === 'DELETE') {
                array_splice($document['notes'], $index, 1);
                $document['connections'] = array_values(array_filter($document['connections'], fn ($link) => ($link['a'] ?? '') !== $id && ($link['b'] ?? '') !== $id));
                return ['deleted' => true];
            }
            $note = notes_validate($body, $note);
            return $visible($note) ? $note : ['id' => $note['id'], 'secret' => true];
        }
        throw new ApiException(404, 'not_found', 'Note not found.');
    });
}
