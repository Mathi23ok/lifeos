import { z } from 'zod';
import { LifeOsError } from './client.js';

const id = z.string().min(1).max(128).describe('Existing LifeOS resource ID.');
const title = z.string().trim().min(1).max(200);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a real ISO date (YYYY-MM-DD).');
const priority = z.enum(['low', 'medium', 'high']);
const money = z.number().finite().positive().max(1e15).describe('Amount in Toman, matching the finance UI.');
const measure = z.object({ id: id.optional(), metric: z.string().trim().min(1).max(120), target: z.number().min(0).max(1e15).nullable().optional(), current: z.number().min(0).max(1e15).nullable().optional(), unit: z.string().max(20).optional() }).strict();
const goalTask = z.object({ id: id.optional(), title: z.string().trim().min(1).max(500), done: z.boolean().optional(), due_date: date.nullable().optional(), priority: priority.optional() }).strict();
const goalFields = { title, specific: z.string().max(20000).optional(), category: z.string().max(200).optional(), relevant: z.string().max(20000).optional(), priority: priority.optional(), deadline: date.nullable().optional(), startDate: date.nullable().optional(), notes: z.string().max(20000).optional(), status: z.enum(['active', 'archived']).optional(), measures: z.array(measure).max(100).optional(), tasks: z.array(goalTask).max(500).optional() };
const taskScope = { source: z.enum(['goal', 'kanban']).optional(), goal_id: id.optional(), board_id: id.optional() };
const taskFields = { title: z.string().trim().min(1).max(500).optional(), description: z.string().max(20000).optional(), priority: priority.optional(), due_date: date.nullable().optional(), done: z.boolean().optional(), column_id: id.optional() };
const noteFields = { title: z.string().max(500).optional(), body: z.string().max(100000).optional(), color: z.enum(['yellow', 'pink', 'blue', 'green', 'lavender', 'peach']).optional(), fontFace: z.enum(['sans', 'serif', 'mono']).optional(), fontSize: z.number().int().min(11).max(28).optional(), secret: z.boolean().optional() };
const includeSecret = z.boolean().optional().describe('Request secret notes only when server config explicitly permits it. Default false.');
const period = z.string().trim().min(1).max(120).optional().describe('Existing period name; omit for active period.');
const object = shape => z.object(shape).strict();
const encode = value => encodeURIComponent(value);
const secretQuery = args => ({ include_secret: args.include_secret ? '1' : undefined });
const splitTask = ({ id: taskId, source, goal_id, board_id, ...body }) => ({ taskId, body, query: { source, goal_id, board_id } });
const splitNote = ({ id: noteId, include_secret, ...body }) => ({ noteId, body, query: secretQuery({ include_secret }) });

export function toolDefinitions(client) {
  const call = (method, path, options) => client.request(method, path, options);
  const definitions = [];
  const add = (name, description, schema, execute, readOnly = false, destructive = false, idempotent = readOnly) => definitions.push({ name, description, schema, execute, annotations: { readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: false } });
  add('lifeos_dashboard', 'Read compact dashboard context: goals, due tasks, habits, finance and recent non-secret notes. Dates use Asia/Tehran.', object({}), () => call('GET', '/dashboard'), true);
  add('lifeos_list_goals', 'List SMART goals with their saved measures and checklist tasks.', object({}), () => call('GET', '/goals'), true);
  add('lifeos_get_goal', 'Read one SMART goal.', object({ id }), a => call('GET', `/goals/${encode(a.id)}`), true);
  add('lifeos_create_goal', 'Create a SMART goal. IDs are generated; supply ISO deadline and optional measures/tasks.', object(goalFields), a => call('POST', '/goals', { body: a }));
  add('lifeos_update_goal', 'Update supported goal fields. Supplied measures or tasks replace their lists; omitted fields are preserved.', object({ id, patch: object(Object.fromEntries(Object.entries(goalFields).map(([k, v]) => [k, v.optional()]))) }), a => call('PATCH', `/goals/${encode(a.id)}`, { body: a.patch }), false, false, true);
  add('lifeos_delete_goal', 'Permanently delete a SMART goal and all of its checklist tasks.', object({ id }), a => call('DELETE', `/goals/${encode(a.id)}`), false, true);
  add('lifeos_list_tasks', 'List normalized goal checklist tasks and Kanban cards. Optional source/container filters.', object({ ...taskScope, column_id: id.optional() }), a => call('GET', '/tasks', { query: a }), true);
  add('lifeos_get_task', 'Read a normalized task. Optional source and container IDs resolve ambiguous IDs.', object({ id, ...taskScope }), a => { const s = splitTask(a); return call('GET', `/tasks/${encode(s.taskId)}`, { query: s.query }); }, true);
  const createTask = object({ ...taskFields, title: z.string().trim().min(1).max(500), source: z.enum(['goal', 'kanban']), goal_id: id.optional(), board_id: id.optional() }).superRefine((a, ctx) => {
    if (a.source === 'goal' && (!a.goal_id || a.board_id || a.column_id || a.description !== undefined)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Goal tasks require goal_id and cannot include board_id, column_id or description.' });
    if (a.source === 'kanban' && (!a.board_id || !a.column_id || a.goal_id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Kanban tasks require board_id and column_id and cannot include goal_id.' });
  });
  add('lifeos_create_task', 'Create a goal task (goal_id) or Kanban card (board_id and column_id).', createTask, a => call('POST', '/tasks', { body: a }));
  add('lifeos_update_task', 'Update task fields. To reopen a Kanban card, set done=false and provide a non-Done column_id. Goal tasks do not support description.', object({ id, ...taskScope, patch: object(taskFields) }), a => { const s = splitTask(a); return call('PATCH', `/tasks/${encode(s.taskId)}`, { body: a.patch, query: s.query }); }, false, false, true);
  add('lifeos_complete_task', 'Complete a goal task or move a Kanban card to an existing Done/Completed/Complete column. Returns conflict if none exists.', object({ id, ...taskScope }), a => { const s = splitTask(a); return call('POST', `/tasks/${encode(s.taskId)}/complete`, { body: {}, query: s.query }); }, false, false, true);
  add('lifeos_delete_task', 'Permanently delete a goal checklist task or Kanban card. Use source and container IDs for ambiguous IDs.', object({ id, ...taskScope }), a => { const s = splitTask(a); return call('DELETE', `/tasks/${encode(s.taskId)}`, { query: s.query }); }, false, true);
  add('lifeos_list_habits', 'Read active habits.', object({}), () => call('GET', '/habits'), true);
  add('lifeos_get_today_habits', 'Read today’s active habits and completion status in Asia/Tehran.', object({}), () => call('GET', '/habits/today'), true);
  const habitArgs = object({ id: z.number().int().positive(), date: date.optional().describe('Omit for today in Asia/Tehran.') });
  add('lifeos_complete_habit', 'Mark a habit completed for a date. Idempotent; repeated calls keep it completed.', habitArgs, a => call('POST', `/habits/${a.id}/complete`, { body: { date: a.date } }), false, false, true);
  add('lifeos_uncomplete_habit', 'Remove a habit completion for a date. Idempotent.', habitArgs, a => call('DELETE', `/habits/${a.id}/complete`, { body: { date: a.date } }), false, false, true);
  add('lifeos_finance_summary', 'Read income, expenses, balance and budget totals in Toman.', object({ period }), a => call('GET', '/finance', { query: a }), true);
  add('lifeos_list_expenses', 'Read expenses in a period. Dates retain the UI month/day format.', object({ period }), a => call('GET', '/finance/expenses', { query: a }), true);
  add('lifeos_log_expense', 'Record an expense in Toman in an existing category/period. Use finance summary to find category IDs.', object({ period, category_id: id, description: z.string().max(2000).optional(), amount: money, date: date.optional() }), a => call('POST', '/finance/expenses', { body: a }));
  add('lifeos_list_incomes', 'Read income streams in a period.', object({ period }), a => call('GET', '/finance/incomes', { query: a }), true);
  add('lifeos_set_income', 'Set an income stream amount in Toman. A matching lowercased name ID updates its amount, matching the UI.', object({ period, name: title, amount: money }), a => call('POST', '/finance/incomes', { body: a }), false, false, true);
  add('lifeos_list_notes', 'List notes. Secret notes are hidden unless explicitly requested and enabled on the server.', object({ include_secret: includeSecret }), a => call('GET', '/notes', { query: secretQuery(a) }), true);
  add('lifeos_get_note', 'Read one visible note. Hidden secret-note IDs return not found.', object({ id, include_secret: includeSecret }), a => { const s = splitNote(a); return call('GET', `/notes/${encode(s.noteId)}`, { query: s.query }); }, true);
  add('lifeos_create_note', 'Create a sticky note with frontend-compatible appearance and position defaults.', object(noteFields), a => call('POST', '/notes', { body: a }));
  add('lifeos_update_note', 'Update supported note fields. Making a note secret hides its content from the response unless access is enabled and requested.', object({ id, include_secret: includeSecret, patch: object(noteFields) }), a => { const s = splitNote(a); return call('PATCH', `/notes/${encode(s.noteId)}`, { body: a.patch, query: s.query }); }, false, false, true);
  add('lifeos_delete_note', 'Permanently delete a visible note and its related connections.', object({ id, include_secret: includeSecret }), a => { const s = splitNote(a); return call('DELETE', `/notes/${encode(s.noteId)}`, { query: s.query }); }, false, true);
  return definitions;
}

export async function executeTool(definition, args) {
  const parsed = definition.schema.safeParse(args);
  if (!parsed.success) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'validation_error', message: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') } }) }] };
  try {
    const data = await definition.execute(parsed.data);
    return { content: [{ type: 'text', text: JSON.stringify({ data }) }], structuredContent: { data } };
  } catch (error) {
    const safe = error instanceof LifeOsError ? { code: error.code, message: error.message, status: error.status } : { code: 'internal_error', message: 'Unable to execute LifeOS tool.' };
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: safe }) }] };
  }
}
