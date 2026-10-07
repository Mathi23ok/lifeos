import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/client.js';
import { toolDefinitions, executeTool } from '../src/tools.js';

const token = 'test-' + 'x'.repeat(64);
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const client = fetchImpl => createClient({ baseUrl: 'http://localhost:8000', token, timeoutMs: 100, fetchImpl });
const dashboard = c => toolDefinitions(c).find(t => t.name === 'lifeos_dashboard');

test('all stable tools have schemas and destructive annotations', () => {
  const tools = toolDefinitions(client(async () => response({ data: {} })));
  assert.equal(tools.length, 26);
  assert.equal(new Set(tools.map(t => t.name)).size, 26);
  for (const t of tools.filter(t => /delete_(goal|task|note)$/.test(t.name))) {
    assert.match(t.description, /Permanently delete/);
    assert.equal(t.annotations.destructiveHint, true);
  }
});
test('successful tool returns structured data and uses bearer HTTP only', async () => {
  const c = client(async (url, options) => {
    assert.equal(url.pathname, '/api/v1/dashboard');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.redirect, 'error');
    return response({ data: { today: '2026-10-07' } });
  });
  assert.deepEqual((await executeTool(dashboard(c), {})).structuredContent, { data: { today: '2026-10-07' } });
});
for (const [status, code, message] of [[401, 'unauthorized', 'Invalid token'], [422, 'validation_error', 'amount must be positive']]) {
  test(`API ${status} surfaces a safe error`, async () => {
    const result = await executeTool(dashboard(client(async () => response({ error: { code, message } }, status))), {});
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).error.code, code);
  });
}
test('malformed JSON is not echoed', async () => {
  const result = await executeTool(dashboard(client(async () => new Response('Not found', { headers: { 'Content-Type': 'application/json' } }))), {});
  assert.equal(JSON.parse(result.content[0].text).error.code, 'malformed_response');
});
test('non JSON and missing data are rejected', async () => {
  for (const result of [new Response('login page'), response({})]) {
    await assert.rejects(client(async () => result).request('GET', '/dashboard'), e => e.code === 'malformed_response');
  }
});
test('timeout is bounded even when mock fetch ignores abort', async () => {
  await assert.rejects(client(() => new Promise(() => {})).request('GET', '/dashboard'), e => e.code === 'timeout');
});
test('token is redacted from malicious upstream error and content', async () => {
  const result = await executeTool(dashboard(client(async () => response({ error: { code: 'bad', message: token } }, 500))), {});
  assert.ok(!JSON.stringify(result).includes(token));
  assert.ok(!JSON.stringify(await client(async () => response({ data: { text: token } })).request('GET', '/dashboard')).includes(token));
});
test('invalid arguments are rejected before HTTP', async () => {
  let called = false;
  const c = client(async () => { called = true; return response({ data: {} }); });
  const expense = toolDefinitions(c).find(t => t.name === 'lifeos_log_expense');
  const result = await executeTool(expense, { amount: -1, category_id: 'food', date: '2026-02-30' });
  assert.equal(result.isError, true);
  assert.equal(called, false);
  const task = toolDefinitions(c).find(t => t.name === 'lifeos_create_task');
  assert.equal((await executeTool(task, { source: 'kanban', title: 'Missing board' })).isError, true);
});
test('secret opt-in, scope filters and expense arguments are forwarded', async () => {
  const calls = [];
  const tools = toolDefinitions({ request: async (...args) => { calls.push(args); return {}; } });
  await executeTool(tools.find(t => t.name === 'lifeos_get_note'), { id: 'abc', include_secret: true });
  assert.equal(calls[0][2].query.include_secret, '1');
  await executeTool(tools.find(t => t.name === 'lifeos_complete_task'), { id: 'abc', source: 'goal', goal_id: 'goal' });
  assert.equal(calls[1][2].query.goal_id, 'goal');
});
test('configuration rejects plaintext remote origins and URL credentials', () => {
  for (const baseUrl of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?x=1']) assert.throws(() => createClient({ baseUrl, token }));
  assert.throws(() => createClient({ baseUrl: 'https://example.com', token: 'short' }));
});
