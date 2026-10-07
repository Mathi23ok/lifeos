// Connections live separately; source workspaces remain the owners of their records.
export const KEY = 'edi_growth_v1';
export const dimensions = [
  {id:'spirituality', name:'Religion & Spirituality', icon:'✧', color:'#b69ce0', hint:'Faith, meaning and a grounded inner life.'},
  {id:'health', name:'Health', icon:'♡', color:'#39e6ad', hint:'Care for your body, energy and wellbeing.'},
  {id:'relationships', name:'Relationships & Family', icon:'◎', color:'#e9918c', hint:'Be present for the people who matter.'},
  {id:'finance', name:'Finance', icon:'↗', color:'#f3c969', hint:'Build security and make intentional money decisions.'},
  {id:'self-growth', name:'Self Growth', icon:'◈', color:'#7da5ee', hint:'Learn, create and become more capable.'},
  {id:'rest', name:'Fun & Rest', icon:'☼', color:'#6bc6ce', hint:'Make space for joy, recovery and curiosity.'}
];
export const array = value => Array.isArray(value) ? value : [];
export function read(key, fallback = {}) {
  const raw = appStorage.getItem(key);
  if (!raw) return fallback;
  // A corrupt document must not silently become a blank editable document.
  return JSON.parse(raw);
}
export function documentState() {
  const doc = read(KEY, {version:1, plans:[], reviews:[]});
  if (!doc || typeof doc !== 'object' || doc.version!==1 || !Array.isArray(doc.plans) || !Array.isArray(doc.reviews) || doc.plans.some(p=>!p || typeof p.id!=='string' || !dimensions.some(d=>d.id===p.dimensionId)) || doc.reviews.some(r=>!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date))) throw Error('Growth data could not be read. Reload before editing.');
  return doc;
}
export const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Tehran', year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function addDays(day, count) { const date = new Date(day+'T12:00:00Z'); date.setUTCDate(date.getUTCDate()+count); return date.toISOString().slice(0,10); }
export function sources() {
  const goals = array(read('edi_goals_v1').goals);
  const tasks = goals.flatMap(goal => array(goal.tasks).map(task => ({...task, key:JSON.stringify(['goal',String(goal.id),String(task.id)]), page:'goals', goalId:goal.id, group:goal.title, archived:goal.status==='archived'})));
  for (const board of array(read('kanban_boards_v1').boards)) for (const column of array(board.columns)) for (const card of array(column.cards)) {
    tasks.push({...card, key:JSON.stringify(['kanban',String(card.id)]), page:'kanban', boardId:board.id, cardId:card.id, group:board.name+' / '+column.name, done:!!card.completed || /^(done|complete|completed)$/i.test((column.name||'').trim())});
  }
  return {goals,tasks};
}
export async function habitData() {
  const end=today(), start=addDays(end,-6);
  const responses = await Promise.all([
    fetch('/habittify/api.php?route=habits', {cache:'no-store',redirect:'error'}),
    fetch(`/habittify/api.php?route=logs&start=${start}&end=${end}`, {cache:'no-store',redirect:'error'})
  ]);
  if (responses.some(r=>!r.ok)) throw Error('Habits unavailable. Refresh to retry.');
  const [h,l] = await Promise.all(responses.map(r=>r.json()));
  if (!Array.isArray(h.habits) || !l.logs || typeof l.logs!=='object') throw Error('Invalid habit response.');
  return {habits:h.habits, logs:l.logs};
}
export function goalProgress(goal) {
  const tasks=array(goal.tasks), measures=array(goal.measures).length ? goal.measures : [{target:goal.target,current:goal.current}];
  const ratios=measures.filter(m=>Number(m.target)>0 && m.current!==null && m.current!==undefined && Number.isFinite(Number(m.current))).map(m=>Math.max(0,Math.min(100,Number(m.current)/Number(m.target)*100)));
  const parts=[];
  if (ratios.length) parts.push(ratios.reduce((a,b)=>a+b,0)/ratios.length);
  if (tasks.length) parts.push(tasks.filter(t=>t.done).length/tasks.length*100);
  return parts.length ? Math.round(parts.reduce((a,b)=>a+b,0)/parts.length) : null;
}
export function summary(plans, source, habit) {
  const goalIds=new Set(plans.flatMap(p=>array(p.goalIds)).map(String));
  const habitIds=new Set(plans.flatMap(p=>array(p.habitIds)).map(String));
  const taskKeys=new Set(plans.flatMap(p=>array(p.taskKeys)));
  const goals=source.goals.filter(g=>goalIds.has(String(g.id)) && g.status!=='archived');
  for (const task of source.tasks) if (task.page==='goals' && goalIds.has(String(task.goalId)) && !task.archived) taskKeys.add(task.key);
  const tasks=source.tasks.filter(t=>taskKeys.has(t.key) && !t.archived);
  const habits=habit ? habit.habits.filter(h=>habitIds.has(String(h.id))) : [];
  const percentages=goals.map(goalProgress).filter(p=>p!==null);
  let eligible=0, completed=0;
  for (const h of habits) for (let i=0;i<7;i++) {
    const day=addDays(today(),-i);
    const date=h.created_at ? new Date(/Z$|[+-]\d\d:\d\d$/.test(h.created_at)?h.created_at:h.created_at.replace(' ','T')+'Z') : null;
    const created=date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(date) : null;
    if (created && day<created) continue;
    eligible++; if (array(habit.logs[day]).map(String).includes(String(h.id))) completed++;
  }
  const missing= [...goalIds].filter(id=>!source.goals.some(g=>String(g.id)===id)).length + [...taskKeys].filter(key=>!source.tasks.some(t=>t.key===key)).length + (habit ? [...habitIds].filter(id=>!habit.habits.some(h=>String(h.id)===id)).length : 0);
  return {goals,tasks,habits,goalPct:percentages.length?Math.round(percentages.reduce((a,b)=>a+b,0)/percentages.length):null,habitPct:eligible?Math.round(completed/eligible*100):null,taskPct:tasks.length?Math.round(tasks.filter(t=>t.done).length/tasks.length*100):null,done:tasks.filter(t=>t.done).length,eligible,completed,missing,habitLinks:habitIds.size};
}
export const cadenceDays={weekly:7,monthly:30,quarterly:90};
export function nextReview(doc, cadence) {
  const last=doc.reviews.filter(r=>r.cadence===cadence).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
  return last ? addDays(last.date,cadenceDays[cadence]) : today();
}
