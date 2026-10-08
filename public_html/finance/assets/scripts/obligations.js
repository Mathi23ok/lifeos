const KEY='edi_obligations_v1', PERIODS='daramd_periods_v1', LEGACY='daramd_v1';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('en-US').format(value||0);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateLabel=date=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'long'}).format(new Date(date+'T12:00:00Z'));
const parse=key=>JSON.parse(appStorage.getItem(key)||'null');
function periods(){return parse(PERIODS)||{Current:parse(LEGACY)||{categories:[],expenses:[],incomes:[]}};}
const params=new URLSearchParams(location.search);
let requested=params.get('payment'), payment=null, view=null, sequence=0, mutating=false, refreshTimer;
let month=/^\d{4}-(0[1-9]|1[0-2])/.test(params.get('due')||'')?params.get('due').slice(0,7):today().slice(0,7);
const root=document.createElement('section');root.id='obligations';root.className='obligations ledger-card';root.setAttribute('aria-labelledby','obHeading');
root.innerHTML=`<header class="ob-heading"><div><span class="eyebrow">PLAN AHEAD · PAY WITH INTENTION</span><h2 id="obHeading">Financial commitments</h2><p>Subscriptions, installments and debts — connected to your ledger and Calendar.</p></div><button id="obNew" class="btn-primary" disabled>＋ Payment plan</button></header><div class="ob-toolbar"><label>Due month <input id="obMonth" type="month" value="${month}" required></label><span class="ob-note">Gregorian month · Tehran dates · Toman</span><button id="obRefresh" class="btn-ghost">↻ Refresh</button></div><p id="obStatus" role="status" aria-live="polite">Loading commitments…</p><div class="ob-metrics" id="obMetrics"></div><div class="ob-carry" id="obCarry"></div><div class="ob-toolbar"><label>Status <select id="obFilter"><option value="all">All statuses</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="rejected">Rejected / deferred</option></select></label><label class="ob-check"><input id="obEarlier" type="checkbox" checked> Include unpaid earlier dues</label><input id="obSearch" type="search" aria-label="Search commitments" placeholder="Search name or payee"></div><div id="obList"></div><details class="ob-plans"><summary>Your payment plans</summary><div id="obPlans"></div></details><p class="ob-note">Skipping an optional subscription waives only that occurrence. A rejected debt, installment or required bill stays payable and becomes overdue after its due date. Dues do not become expenses until you record a payment.</p>`;
document.querySelector('#pageRoot .main-grid').before(root);
const planDialog=document.createElement('dialog');planDialog.id='obPlanDialog';planDialog.className='ob-dialog';planDialog.setAttribute('aria-labelledby','obPlanHeading');
planDialog.innerHTML=`<form id="obPlanForm"><header class="ob-heading"><h2 id="obPlanHeading">New payment plan</h2><button type="button" data-close aria-label="Close">✕</button></header><label>Name<input name="title" required maxlength="180" dir="auto" placeholder="Internet, loan, subscription…"></label><div class="ob-fields"><label>Type<select id="obType" name="type"><option value="recurring">Recurring payment</option><option value="installment">Installments</option><option value="debt">Debt</option></select></label><label>Payee / creditor<input name="payee" maxlength="180" dir="auto"></label></div><label class="ob-check"><input id="obOptional" name="optional" type="checkbox"> Optional subscription · this period may be skipped</label><div class="ob-fields"><label><span id="obAmountLabel">Amount per occurrence · Toman</span><input name="amount" id="obAmount" type="number" min="1" max="1000000000000" step="1" required></label><label><span id="obCountLabel">Number of payments · leave blank for ongoing</span><input name="count" id="obCount" type="number" min="1" max="600" step="1"></label></div><div class="ob-fields"><label>First due date<input name="startDate" id="obStart" type="date" min="2000-01-01" required></label><label id="obEndLabel">Last date · optional<input name="endDate" id="obEnd" type="date"></label></div><div class="ob-fields"><label>Repeat<select name="frequency" id="obFrequency"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="yearly">Yearly</option><option value="daily">Daily</option></select></label><label>Every … periods<input name="interval" id="obInterval" type="number" min="1" max="12" step="1" value="1" required></label></div><p id="obPreview" class="ob-note"></p><label>Notes<textarea name="notes" rows="2" maxlength="3000" dir="auto"></textarea></label><p class="ob-note">Debt and installment amounts are the total to repay, including any agreed charges. Payments are divided equally; the final payment includes any rounding remainder. Terms are fixed after creation to preserve historical dues.</p><p id="obPlanError" class="ob-error" role="alert"></p><footer class="ob-actions"><button type="button" data-close class="btn-ghost">Cancel</button><button class="btn-primary" id="obSavePlan">Create schedule</button></footer></form>`;
document.body.append(planDialog);
const payDialog=document.createElement('dialog');payDialog.id='obPayDialog';payDialog.className='ob-dialog';payDialog.setAttribute('aria-labelledby','obPayHeading');
payDialog.innerHTML=`<form id="obPayForm"><header class="ob-heading"><h2 id="obPayHeading">Record payment</h2><button type="button" data-close aria-label="Close">✕</button></header><p id="obPaySummary"></p><label>Ledger period<select id="obPayPeriod" required></select></label><label>Transaction<select id="obPayMode"><option value="create">Create a new expense</option><option value="link">Link an existing expense</option></select></label><label id="obCategoryLabel">Expense category<select id="obPayCategory"></select></label><label id="obExpenseLabel" hidden>Existing expense · exact amount<select id="obPayExpense"></select></label><label>Payment date<input id="obPayDate" type="date" required></label><label>Note<textarea id="obPayNote" rows="2" maxlength="1000" dir="auto"></textarea></label><p class="ob-note">A payment is recorded once. Existing expenses are linked without adding another expense. Future due dates may be paid early, but the payment date cannot be in the future.</p><p id="obPayError" class="ob-error" role="alert"></p><footer class="ob-actions"><button type="button" data-close class="btn-ghost">Cancel</button><button class="btn-primary" id="obSavePayment">Confirm payment</button></footer></form>`;
document.body.append(payDialog);
const actionDialog=document.createElement('dialog');actionDialog.id='obActionDialog';actionDialog.className='ob-dialog';actionDialog.setAttribute('aria-labelledby','obActionHeading');
actionDialog.innerHTML=`<form id="obActionForm"><header class="ob-heading"><h2 id="obActionHeading"></h2><button type="button" data-close aria-label="Close">✕</button></header><p id="obActionCopy"></p><label id="obStopLabel" hidden>Stop future dues from<input id="obStopDate" type="date"></label><label id="obActionNoteLabel">Reason / note<textarea id="obActionNote" rows="2" maxlength="1000" dir="auto"></textarea></label><p id="obActionError" class="ob-error" role="alert"></p><footer class="ob-actions"><button type="button" data-close class="btn-ghost">Cancel</button><button class="btn-primary" id="obConfirmAction">Confirm</button></footer></form>`;
document.body.append(actionDialog);
let action=null;

function render(){
  if(!view)return;
  const t=view.totals;
  $('obMetrics').innerHTML=[['This month’s commitments',t.committed,'Scheduled dues less optional skips'],['Paid',t.paid,'Verified against linked expenses'],['Remaining',t.remaining,'Unpaid dues in this month'],['Optional skips',t.skipped,'Excluded from commitments']].map(([name,value,hint])=>`<article><span>${name}</span><strong>${money(value)} <small>Toman</small></strong><p>${hint}</p></article>`).join('');
  $('obCarry').textContent=`Earlier unpaid dues: ${money(t.carryOver)} Toman · Overdue in this month: ${money(t.overdue)} Toman · Total still payable through month end: ${money(t.carryOver+t.remaining)} Toman`;
  const filter=$('obFilter').value,q=$('obSearch').value.toLowerCase();
  const list=view.occurrences.filter(o=>($('obEarlier').checked||o.date>=view.start)&&(filter==='all'||o.status===filter)&&(`${o.title} ${o.payee}`.toLowerCase().includes(q)));
  $('obList').innerHTML=list.length?list.map(o=>{
    const label=o.paymentIssue?'Payment needs reconciliation':o.status==='paid'?'Paid':o.skipped?'Rejected · skipped':o.status==='rejected'?(o.overdue?'Rejected · overdue':'Rejected · still payable'):o.overdue?'Pending · overdue':'Pending';
    return `<article class="ob-row ${o.id===requested?'ob-selected':''}" data-id="${esc(o.id)}"><div class="ob-date"><strong>${esc(dateLabel(o.date))}</strong><small>${o.date.slice(0,4)}${o.date<view.start?' · earlier due':''}</small></div><div class="ob-info"><h3 dir="auto">${esc(o.title)}</h3><span>${esc(o.type)}${o.count?' · payment '+(o.index+1)+' of '+o.count:''}${o.payee?' · '+esc(o.payee):''}${o.optional?' · optional':''}</span><span class="ob-badge ${o.status==='paid'?'paid':o.overdue||o.paymentIssue?'late':''}">${label}</span>${o.decision.note?`<p dir="auto">${esc(o.decision.note)}</p>`:''}${o.decision.status==='paid'?`<small>Ledger: ${esc(o.decision.period)} · ${esc(o.decision.paymentDate)}</small>`:''}</div><strong class="ob-value">${money(o.amount)} <small>Toman</small></strong><div class="ob-actions">${o.decision.status==='paid'?`<button data-action="undo" data-occurrence="${esc(o.id)}" class="btn-ghost">Undo payment</button><button data-ledger="${esc(o.decision.period)}" data-expense="${esc(o.decision.expenseId)}" class="btn-ghost">View expense</button>`:`<button data-pay="${esc(o.id)}" class="btn-primary">Pay</button>${o.status==='rejected'?`<button data-action="restore" data-occurrence="${esc(o.id)}" class="btn-ghost">Restore pending</button>`:`<button data-action="reject" data-occurrence="${esc(o.id)}" class="btn-ghost">${o.optional?'Skip this period':'Defer payment'}</button>`}`}</div></article>`;
  }).join(''):'<div class="ob-empty">No commitments match this view. Add a payment plan or choose another month.</div>';
  $('obPlans').innerHTML=view.plans.length?view.plans.map(p=>`<article class="ob-plan"><div><h3 dir="auto">${esc(p.title)}</h3><p>${esc(p.type)} · every ${p.interval} ${esc(p.frequency)} period(s) · from ${p.startDate} · ${p.count?p.count+' payments':'ongoing'}${p.endDate?' · ends '+p.endDate:''}${p.cancelFrom?' · stopped from '+p.cancelFrom:''}</p>${p.totalAmount?`<p>Total principal and agreed charges: ${money(p.totalAmount)} Toman</p>`:`<p>${money(p.amount)} Toman per due date</p>`}${p.progress?`<p>${p.progress.paidCount}/${p.count} paid · ${money(p.progress.paid)} Toman repaid · ${money(p.progress.remaining)} Toman remaining on the full debt</p>`:''}${p.notes?`<p dir="auto">${esc(p.notes)}</p>`:''}</div>${p.type==='recurring'&&!p.cancelFrom?`<button class="btn-ghost" data-cancel="${esc(p.id)}">Stop future dues</button>`:''}</article>`).join(''):'<p class="ob-note">No payment plans yet.</p>';
  if(view.history?.length)$('obPlans').insertAdjacentHTML('beforeend','<h3>Recent payment changes</h3>'+[...view.history].reverse().map(h=>`<p class="ob-note">${esc(new Date(h.at).toLocaleString('en-GB',{timeZone:'Asia/Tehran'}))} · ${esc(h.action)} · ${esc(view.plans.find(p=>h.occurrenceId.startsWith(p.id+':'))?.title||'Payment')} · ${esc(h.from)} → ${esc(h.to)}${h.note?' · '+esc(h.note):''}</p>`).join(''));
  $('obNew').disabled=mutating;
  if(mutating)root.querySelectorAll('button').forEach(b=>b.disabled=true);
}
async function refresh(){
  const token=++sequence;$('obRefresh').disabled=true;
  try{
    const first=month+'-01',last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
    await appStorage.sync();
    const response=await fetch(`/finance-obligations.php?start=${first}&end=${last}`,{cache:'no-store',redirect:'error'}),result=await response.json();
    if(!response.ok)throw Error(result.error?.message||'Unable to load commitments.');
    if(token!==sequence)return;view=result.data;render();$('obStatus').textContent='';
    if(requested){const row=[...root.querySelectorAll('[data-id]')].find(r=>r.dataset.id===requested);row?.scrollIntoView({block:'center',behavior:'auto'});requested=null;}
  }catch(error){if(token===sequence)$('obStatus').textContent=error.message;}
  finally{if(token===sequence)$('obRefresh').disabled=mutating;}
}
async function mutate(payload){
  mutating=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);
  for(const dialog of [planDialog,payDialog,actionDialog])dialog.querySelector('form').inert=true;
  const keys=['pay','undo'].includes(payload.action)?[KEY,PERIODS,LEGACY]:[KEY];
  try{
    await appStorage.mutateItems(keys,async({csrf,revisions})=>{
      const response=await fetch('/finance-obligations.php',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({...payload,revisions})});
      const result=await response.json();
      if(!response.ok){const error=Error(result.error?.message||'Unable to save payment.');error.stateConflict=response.status===409&&result.error?.code==='state_conflict';throw error;}
      return result.data;
    });
    await refresh();
  }finally{mutating=false;for(const dialog of [planDialog,payDialog,actionDialog])dialog.querySelector('form').inert=false;render();$('obRefresh').disabled=false;}
}
function planFields(){
  const recurring=$('obType').value==='recurring';
  $('obOptional').disabled=!recurring;if(!recurring)$('obOptional').checked=false;
  $('obAmountLabel').textContent=recurring?'Amount per occurrence · Toman':'Total amount to repay · Toman';
  $('obCountLabel').textContent=recurring?'Number of payments · blank for ongoing':'Number of payments';$('obCount').required=!recurring;
  $('obEndLabel').hidden=!recurring;$('obEnd').disabled=!recurring;
  const count=Number($('obCount').value),amount=Number($('obAmount').value);
  $('obPreview').textContent=!recurring&&count>0&&amount>=count?`${count} payments: ${money(Math.floor(amount/count))} Toman each; final payment ${money(Math.floor(amount/count)+amount%count)} Toman.`:recurring?'Dates are generated from the first due date. End-of-month dates retain their original anchor.':'Enter the full debt amount and a payment count to divide the schedule.';
}
function paymentOptions(){
  const p=periods()[$('obPayPeriod').value]||{},link=$('obPayMode').value==='link';
  $('obCategoryLabel').hidden=link;$('obExpenseLabel').hidden=!link;$('obPayCategory').required=!link;$('obPayExpense').required=link;
  $('obPayCategory').innerHTML=(p.categories||[]).map(c=>`<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('');
  const decisions=parse(KEY)?.decisions||{};
  const used=new Set(Object.values(decisions).filter(d=>d.status==='paid'&&d.period===$('obPayPeriod').value).map(d=>String(d.expenseId)));
  const choices=(p.expenses||[]).filter(e=>Number(e.amount)===payment.amount&&!used.has(String(e.id)));
  $('obPayExpense').innerHTML='<option value="">Choose an expense</option>'+choices.map(e=>`<option value="${esc(e.id)}">${esc(e.date)} · ${esc(e.desc||'Expense')} · ${money(e.amount)}</option>`).join('');
}
function openPay(id){
  payment=view.occurrences.find(o=>o.id===id);if(!payment)return;
  $('obPaySummary').textContent=`${payment.title} · ${money(payment.amount)} Toman · due ${dateLabel(payment.date)}`;
  $('obPayPeriod').innerHTML=Object.keys(periods()).map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
  const active=appStorage.getItem('daramd_active_period_v1');if(periods()[active])$('obPayPeriod').value=active;
  $('obPayMode').value='create';$('obPayDate').value=today();$('obPayDate').max=today();$('obPayNote').value='';$('obPayError').textContent='';paymentOptions();payDialog.showModal();
}
function openAction(name,id){
  action={action:name,...(name==='cancel'?{planId:id}:{occurrenceId:id})};
  const item=view.occurrences.find(o=>o.id===id);
  $('obActionHeading').textContent={cancel:'Stop future dues',undo:'Undo payment',reject:item?.optional?'Skip this subscription period':'Defer this payment',restore:'Restore pending payment'}[name];
  $('obActionCopy').textContent=name==='cancel'?'The schedule stops from the selected date. Earlier unpaid dues and recorded payment decisions remain.':name==='undo'?'An unchanged expense created by this payment will be removed. Existing linked expenses and expenses edited since payment are retained and only unlinked. The due becomes pending again.':name==='reject'?(item?.optional?'Only this occurrence is excluded from commitments. The next subscription occurrence remains scheduled.':'This amount remains owed. Deferring does not erase the debt or move its due date; it becomes overdue after the original due date.'):'This occurrence becomes pending and payable again.';
  $('obStopLabel').hidden=name!=='cancel';$('obStopDate').required=name==='cancel';$('obStopDate').value=today();$('obStopDate').min=today();$('obActionNoteLabel').hidden=name==='cancel'||name==='undo';$('obActionNote').value='';$('obActionError').textContent='';actionDialog.showModal();
}
$('obNew').onclick=()=>{$('obPlanForm').reset();$('obStart').value=today();$('obPlanError').textContent='';planFields();planDialog.showModal();};
$('obType').onchange=()=>{if($('obType').value!=='recurring'&&!$('obCount').value)$('obCount').value=$('obType').value==='debt'?1:6;planFields();};
for(const id of ['obAmount','obCount'])$(id).oninput=planFields;
$('obPlanForm').onsubmit=async event=>{
  event.preventDefault();$('obSavePlan').disabled=true;
  try{
    const form=new FormData(event.target),recurring=$('obType').value==='recurring';
    const plan={title:form.get('title').trim(),payee:form.get('payee').trim(),type:form.get('type'),optional:$('obOptional').checked&&recurring,amount:recurring?Number(form.get('amount')):0,totalAmount:recurring?null:Number(form.get('amount')),count:form.get('count')?Number(form.get('count')):null,startDate:form.get('startDate'),endDate:recurring?(form.get('endDate')||null):null,frequency:form.get('frequency'),interval:Number(form.get('interval')),notes:form.get('notes').trim()};
    await mutate({action:'create',plan});planDialog.close();
  }catch(error){$('obPlanError').textContent=error.message;}finally{$('obSavePlan').disabled=false;}
};
$('obPayForm').onsubmit=async event=>{
  event.preventDefault();$('obSavePayment').disabled=true;
  try{await mutate({action:'pay',occurrenceId:payment.id,period:$('obPayPeriod').value,categoryId:$('obPayMode').value==='create'?$('obPayCategory').value:'',expenseId:$('obPayMode').value==='link'?$('obPayExpense').value:'',paymentDate:$('obPayDate').value,note:$('obPayNote').value.trim()});payDialog.close();}
  catch(error){$('obPayError').textContent=error.message;}finally{$('obSavePayment').disabled=false;}
};
$('obActionForm').onsubmit=async event=>{
  event.preventDefault();$('obConfirmAction').disabled=true;
  try{await mutate({...action,...(action.action==='cancel'?{cancelFrom:$('obStopDate').value}:{note:$('obActionNote').value.trim()})});actionDialog.close();}
  catch(error){$('obActionError').textContent=error.message;}finally{$('obConfirmAction').disabled=false;}
};
$('obPayPeriod').onchange=paymentOptions;$('obPayMode').onchange=paymentOptions;
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||mutating)return;
  if(button.hasAttribute('data-close')&&button.closest('.ob-dialog'))button.closest('dialog').close();
  if(button.dataset.pay)openPay(button.dataset.pay);
  if(button.dataset.action)openAction(button.dataset.action,button.dataset.occurrence);
  if(button.dataset.cancel)openAction('cancel',button.dataset.cancel);
  if(button.dataset.ledger){window.switchPeriod?.(button.dataset.ledger);const row=[...document.querySelectorAll('[data-expense-id]')].find(r=>r.dataset.expenseId===button.dataset.expense);document.querySelectorAll('.ob-expense-highlight').forEach(r=>r.classList.remove('ob-expense-highlight'));row?.classList.add('ob-expense-highlight');(row||$('txTable'))?.scrollIntoView({block:'center'});}
});
for(const dialog of [planDialog,payDialog,actionDialog])dialog.addEventListener('cancel',event=>{if(mutating)event.preventDefault();});
$('obMonth').onchange=()=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test($('obMonth').value)){month=$('obMonth').value;refresh();}};
$('obRefresh').onclick=refresh;$('obFilter').onchange=render;$('obEarlier').onchange=render;$('obSearch').oninput=render;
addEventListener('app-storage-change',()=>{if(!mutating){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,200);}});
addEventListener('finance-open-payment',async event=>{
  const id=event.detail?.id;if(!id||mutating)return;
  try{const response=await fetch('/finance-obligations.php?occurrence='+encodeURIComponent(id),{cache:'no-store',redirect:'error'}),result=await response.json();if(!response.ok)throw Error(result.error?.message||'Unable to open payment.');requested=id;month=result.data.date.slice(0,7);$('obMonth').value=month;$('obFilter').value='all';$('obEarlier').checked=true;$('obSearch').value='';await refresh();}
  catch(error){$('obStatus').textContent=error.message;}
});
addEventListener('message',event=>{if(event.origin===location.origin&&event.source===parent&&event.data?.type==='finance-refresh')refresh();});
setInterval(()=>{if(document.visibilityState==='visible'&&!window.frameElement?.hidden&&!mutating)refresh();},60000);
try{await window.appStorageReady;await refresh();}catch{$('obStatus').textContent='Unable to load commitments. Reload to retry.';}
