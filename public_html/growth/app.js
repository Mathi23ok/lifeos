import {KEY, dimensions, array, documentState, sources, habitData, summary, goalProgress, today, nextReview} from '../assets/growth-model.js';
import {createReviewStepper} from './review-stepper.js?v=1';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const percent=value=>value===null?'Not measured':`${value}%`;
const prettyDate=value=>value && !Number.isNaN(new Date(value+'T12:00:00Z').getTime())?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z')):'No target date';
let selected=dimensions.some(d=>d.id===location.hash.slice(1))?location.hash.slice(1):'spirituality';
let doc, source, habit=null, editing=null, baseline=null, refreshSequence=0, refreshing=false;
let reviewSaving=false;
const reviewStepper=createReviewStepper($('reviewDialog'),dimensions);
for (const id of ['addPlan','reviewBtn','refresh']) $(id).disabled=true;
const activePlans=id=>doc.plans.filter(p=>p.dimensionId===id && p.status!=='archived');
const snapshot=s=>({goalPct:s.goalPct,habitPct:s.habitPct,taskPct:s.taskPct,habitAvailable:!!habit,goals:s.goals.length,habits:s.habits.length,tasks:s.tasks.length,done:s.done,completed:s.completed,eligible:s.eligible});
function navigate(page, item={}) {
  const message={type:'growth-open',page,goalId:item.goalId,boardId:item.boardId,cardId:item.cardId};
  if (parent!==window) parent.postMessage(message,location.origin);
  else {
    const url=new URL(`../${page}/index.html`,location.href);
    if(item.goalId)url.searchParams.set('goal',item.goalId);
    if(item.boardId)url.searchParams.set('board',item.boardId);
    if(item.cardId)url.searchParams.set('card',item.cardId);
    location.href=url.href;
  }
}
function metric(label,value) {return `<div class="metric"><span>${label}</span><strong>${percent(value)}</strong></div><div class="track"><span style="width:${value??0}%"></span></div>`;}
function render() {
  try {doc=documentState();source=sources();} catch(error){$('status').textContent=error.message;$('addPlan').disabled=true;$('reviewBtn').disabled=true;return;}
  $('addPlan').disabled=false;$('reviewBtn').disabled=false;
  $('cadences').innerHTML=['weekly','monthly','quarterly'].map(c=>{const next=nextReview(doc,c),due=next<=today();return `<button class="cadence" data-review="${c}"><span><strong>${c[0].toUpperCase()+c.slice(1)} review</strong><small>${due?'A moment to reconnect with your direction':`Next: ${prettyDate(next)}`}</small></span><span class="due">${due?'Due · Start →':'→'}</span></button>`;}).join('');
  $('dimensions').innerHTML=dimensions.map(d=>{
    const plans=activePlans(d.id),s=summary(plans,source,habit);
    return `<button class="dimension" data-dimension="${d.id}" style="--tone:${d.color}" aria-pressed="${d.id===selected}"><span class="dimension-top"><span class="dimension-icon" aria-hidden="true">${d.icon}</span><small>${plans.length} long-term · ${s.goals.length} SMART</small></span><h2>${d.name}</h2><p>${d.hint}</p>${metric('SMART progress',s.goalPct)}<div class="metric"><span>Habits · 7 days</span><strong>${habit?percent(s.habitPct):'Unavailable'}</strong></div><div class="metric"><span>Tasks completed</span><strong>${s.done} / ${s.tasks.length}</strong></div></button>`;
  }).join('');
  const dimension=dimensions.find(d=>d.id===selected);
  $('dimensionTitle').textContent=dimension.name;$('dimensionHint').textContent=dimension.hint;
  const plans=doc.plans.filter(p=>p.dimensionId===selected);
  $('plans').innerHTML=plans.length?plans.map(p=>{
    const s=summary([p],source,habit);
    const goalLinks=s.goals.map(g=>`<button data-goal="${esc(g.id)}" dir="auto">${esc(g.title)} · ${goalProgress(g,habit)===null?'No measures':goalProgress(g,habit)+'%'}${g.deadline&&g.deadline<today()&&array(g.tasks).some(t=>!t.done)?' · overdue':''}</button>`).join('');
    const taskLinks=s.tasks.map(t=>`<button data-task="${esc(t.key)}" dir="auto">${t.done?'✓ ':''}${esc(t.title)}${t.dueDate?' · '+esc(prettyDate(t.dueDate)):''}</button>`).join('');
    const habitLinks=s.habits.map(h=>`<button data-page="habittify" dir="auto">${esc(h.name)}</button>`).join('');
    return `<article class="plan"><header class="section-head"><div><h3 dir="auto">${esc(p.title)}</h3><span class="meta">${esc(p.status||'active')} · ${esc(prettyDate(p.targetDate))} · SMART ${percent(s.goalPct)}</span></div><button data-edit="${esc(p.id)}">Edit connections</button></header>${p.why?`<p dir="auto">${esc(p.why)}</p>`:''}<div class="link-group"><h4>SMART goals</h4><div class="links">${goalLinks||'<span class="meta">No active goals linked.</span>'}<button data-page="goals">＋ Manage goals</button></div></div><div class="link-group"><h4>Supporting habits</h4><div class="links">${habitLinks||`<span class="meta">${habit?'No active habits linked.':'Habits unavailable; saved links are retained.'}</span>`}<button data-page="habittify">＋ Manage habits</button></div></div><div class="link-group"><h4>Related tasks · ${s.done} of ${s.tasks.length} done</h4><div class="links">${taskLinks||'<span class="meta">Link cards or a goal with checklist items.</span>'}<button data-page="kanban">＋ Open Kanban</button></div></div>${s.missing?`<p class="warning">${s.missing} saved connection(s) are missing or no longer active. Edit connections to review them.</p>`:''}</article>`;
  }).join(''):'<div class="empty">Start with one meaningful long-term goal. Connect your current SMART goals, habits and tasks to give your daily effort a direction.</div>';
  $('history').innerHTML=doc.reviews.length?[...doc.reviews].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(r=>`<details class="history-entry"><summary><strong>${esc(r.cadence)} review</strong><span class="meta">${esc(prettyDate(r.date))}</span></summary><div class="review-notes">${dimensions.map(d=>{const n=r.notes?.[d.id]||{},s=r.snapshot?.[d.id]||{};return `<article class="review-note"><h3>${d.name}</h3><small>SMART ${percent(s.goalPct??null)} · Habits ${percent(s.habitPct??null)} · Tasks ${s.done??0}/${s.tasks??0}</small><p dir="auto">${esc(n.reflection||'No reflection recorded.')}</p>${n.next?`<p dir="auto"><strong>Next step:</strong> ${esc(n.next)}</p>`:''}</article>`;}).join('')}</div></details>`).join(''):'<div class="empty">Your first review starts here. Capture wins, obstacles and a practical next step for each dimension.</div>';
}
async function refresh() {
  const sequence=++refreshSequence;refreshing=true;$('refresh').disabled=true;
  try {await appStorage.sync();render();const next=await habitData();if(sequence!==refreshSequence)return;habit=next;$('status').textContent='';}
  catch(error){if(sequence!==refreshSequence)return;habit=null;$('status').textContent=error.message||'Unable to refresh. Please retry.';}
  finally{if(sequence===refreshSequence){refreshing=false;$('refresh').disabled=false;render();}}
}
function picker(name,title,items,selectedIds,disabled=false) {
  const ids=new Set(array(selectedIds).map(String));
  const missing=[...ids].filter(id=>!items.some(i=>String(i.id)===id));
  return `<fieldset><legend>${title}</legend><input type="search" class="picker-search" placeholder="Search ${title.toLowerCase()}" aria-label="Search ${title}" ${disabled?'disabled':''}><div class="picker-list">${items.map(i=>`<label data-search="${esc((i.title+' '+(i.group||'')).toLowerCase())}"><input type="checkbox" name="${name}" value="${esc(i.id)}" ${ids.has(String(i.id))?'checked':''} ${disabled?'disabled':''}><span dir="auto">${esc(i.title)}${i.group?`<small>${esc(i.group)}</small>`:''}</span></label>`).join('')}${missing.map(id=>`<label data-search="unavailable"><input type="checkbox" name="${name}" value="${esc(id)}" checked ${disabled?'disabled':''}><span>Unavailable record<small>Retained connection. Uncheck to unlink.</small></span></label>`).join('')}${!items.length&&!missing.length?'<p class="help">No records available. Use the original workspace to add them.</p>':''}</div></fieldset>`;
}
function openPlan(id=null) {
  editing=doc.plans.find(p=>p.id===id)||null;baseline=appStorage.getItem(KEY);
  $('planHeading').textContent=editing?'Edit long-term goal':'New long-term goal';
  $('planDimension').innerHTML=dimensions.map(d=>`<option value="${d.id}">${d.name}</option>`).join('');
  $('planDimension').value=editing?.dimensionId||selected;
  $('planTitle').value=editing?.title||'';$('planWhy').value=editing?.why||'';$('planDate').value=editing?.targetDate||'';$('planState').value=editing?.status||'active';
  $('pickers').innerHTML=picker('goalIds','SMART goals',source.goals.map(g=>({id:String(g.id),title:g.title,group:g.status==='archived'?'Archived':g.category})),editing?.goalIds)+picker('habitIds','Habits',habit?.habits.map(h=>({id:String(h.id),title:h.name,group:h.category}))||[],editing?.habitIds,!habit)+picker('taskKeys','Tasks',source.tasks.map(t=>({id:t.key,title:t.title,group:t.group+(t.done?' · done':'')+(t.archived?' · archived':'' )})),editing?.taskKeys);
  $('planError').textContent='';$('planDialog').showModal();$('planTitle').focus();
}
function openReview(cadence='weekly') {
  baseline=appStorage.getItem(KEY);
  const reviews=[...doc.reviews].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  reviewStepper.open({cadence,habitAvailable:!!habit,lastDate:reviews[0]?prettyDate(reviews[0].date):null,stats:Object.fromEntries(dimensions.map(d=>[d.id,summary(activePlans(d.id),source,habit)])),previous:Object.fromEntries(dimensions.map(d=>[d.id,reviews.find(r=>r.notes?.[d.id]?.next)?.notes[d.id].next||'']))});
}
async function persist(next) {
  if (appStorage.getItem(KEY)!==baseline) throw Error('Your growth workspace changed while this form was open. Close and reopen it to use the latest connections.');
  const value=JSON.stringify(next);
  await appStorage.mutateItem(KEY,async ({csrf,revision})=>{
    if(appStorage.getItem(KEY)!==baseline)throw Error('Growth data changed. Reopen this form before saving.');
    const response=await fetch('/state.php',{method:'PUT',redirect:'error',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({key:KEY,value,revision})});
    const result=await response.json();
    if(!response.ok||!result.ok){const error=Error(result.error||'Unable to save. Please retry.');error.stateConflict=response.status===409;throw error;}
    return {value,revision:result.revision};
  });
  render();$('status').textContent='Saved to your growth workspace.';
}
$('planForm').onsubmit=async event=>{
  event.preventDefault();if(!$('planTitle').value.trim()){$('planError').textContent='Enter a goal title.';return;}
  $('savePlan').disabled=true;
  try {
    const current=documentState(),form=new FormData(event.target),now=new Date().toISOString();
    const plan={...editing,id:editing?.id||crypto.randomUUID(),dimensionId:$('planDimension').value,title:$('planTitle').value.trim(),why:$('planWhy').value.trim(),targetDate:$('planDate').value||null,status:$('planState').value,goalIds:form.getAll('goalIds'),habitIds:habit?form.getAll('habitIds'):array(editing?.habitIds),taskKeys:form.getAll('taskKeys'),createdAt:editing?.createdAt||now,updatedAt:now};
    const next={...current,plans:editing?current.plans.map(p=>p.id===editing.id?plan:p):[...current.plans,plan]};
    await persist(next);selected=plan.dimensionId;location.hash=selected;render();$('planDialog').close();
  }catch(error){$('planError').textContent=error.message;}finally{$('savePlan').disabled=false;}
};
$('reviewForm').onsubmit=async event=>{
  event.preventDefault();
  if(reviewSaving)return;
  if(!reviewStepper.isSummary()){reviewStepper.next();return;}
  reviewSaving=true;$('saveReview').disabled=true;reviewStepper.setBusy(true);
  try {
    // Capture current source activity, rather than the values at form opening.
    await appStorage.sync();
    try {habit=await habitData();} catch {habit=null;}
    const current=documentState(),form=new FormData(event.target),notes={},values={};
    for(const d of dimensions){notes[d.id]={reflection:String(form.get('reflection-'+d.id)||'').trim(),next:String(form.get('next-'+d.id)||'').trim()};values[d.id]=snapshot(summary(current.plans.filter(p=>p.dimensionId===d.id&&p.status!=='archived'),sources(),habit));}
    if(!Object.values(notes).some(n=>n.reflection||n.next))throw Error('Add a reflection or next step before completing your review.');
    await persist({...current,reviews:[...current.reviews,{id:crypto.randomUUID(),cadence:$('cadence').value,date:today(),createdAt:new Date().toISOString(),notes,snapshot:values}]});reviewStepper.clearDraft();$('reviewDialog').close();
  }catch(error){$('reviewError').textContent=error.message;}finally{reviewSaving=false;$('saveReview').disabled=false;reviewStepper.setBusy(false);}
};
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-close')&&!(button.closest('dialog').id==='reviewDialog'?reviewSaving:$('savePlan').disabled))button.closest('dialog').close();
  if(button.dataset.dimension){selected=button.dataset.dimension;location.hash=selected;render();}
  if(button.dataset.review)openReview(button.dataset.review);
  if(button.dataset.edit)openPlan(button.dataset.edit);
  if(button.dataset.page)navigate(button.dataset.page);
  if(button.dataset.goal)navigate('goals',{goalId:button.dataset.goal});
  if(button.dataset.task){const task=source.tasks.find(t=>t.key===button.dataset.task);if(task)navigate(task.page,task);}
});
document.addEventListener('input',event=>{if(!event.target.matches('.picker-search'))return;const q=event.target.value.toLowerCase();for(const row of event.target.closest('fieldset').querySelectorAll('[data-search]'))row.hidden=!row.dataset.search.includes(q);});
for (const dialog of [$('planDialog'),$('reviewDialog')]) dialog.addEventListener('cancel',event=>{if(dialog.id==='reviewDialog'?reviewSaving:$('savePlan').disabled)event.preventDefault();});
$('addPlan').onclick=()=>openPlan();$('reviewBtn').onclick=()=>openReview();$('refresh').onclick=refresh;
addEventListener('hashchange',()=>{if(dimensions.some(d=>d.id===location.hash.slice(1))){selected=location.hash.slice(1);render();}});
addEventListener('app-storage-change',render);
addEventListener('message',e=>{if(e.origin===location.origin&&e.source===parent&&e.data?.type==='growth-refresh'&&!refreshing)refresh();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!refreshing)refresh();});
try {await window.appStorageReady;render();await refresh();}
catch(error){$('status').textContent='Unable to load your workspace. Reload to retry.';for(const id of ['addPlan','reviewBtn','refresh'])$(id).disabled=true;}
