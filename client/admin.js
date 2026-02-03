// اختصار selector
const $ = s => document.querySelector(s);

// دالة API محمية
const api = async (u, method='GET', data, token) => {
  try {
    const res = await fetch(u, {
      method,
      headers: Object.assign({'Content-Type':'application/json','x-admin-token': token||window._adm}, {}),
      body: data ? JSON.stringify(data) : undefined
    });
    const json = await res.json();
    return json;
  } catch (err) {
    console.error('API Error:', err);
    return { ok: false, error: err.message };
  }
};

// العناصر الأساسية
const loginBox = $('#login'),
      panel = $('#panel'),
      toast = $('#toast');
let token = '';

// Toast
function showToast(t){
  if(!toast) return;
  toast.textContent = t;
  toast.classList.add('show');
  setTimeout(()=>toast.classList.remove('show'),1800);
}

// تبويبات
document.querySelectorAll('.tabs .t').forEach(b=>{
  b.onclick = ()=>{
    document.querySelectorAll('.tabs .t').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('show'));
    const tab = $('#tab-'+b.dataset.tab);
    if(tab) tab.classList.add('show');
  };
});

// دخول الأدمن
$('#admBtn').onclick = async ()=>{
  try {
    token = $('#admTok').value.trim();
    if(!token) { $('#msg').textContent='أدخل التوكن من فضلك'; return; }

    const j = await api('/api/admin/stats','GET',null,token);
    if(!j.ok){ $('#msg').textContent='التوكن غير صحيح'; return; }

    window._adm = token;
    loginBox.classList.add('hidden');
    panel.classList.remove('hidden');

    await loadAll();
  } catch(err) {
    console.error(err);
    $('#msg').textContent = 'حدث خطأ، حاول مرة أخرى';
  }
};

// تحميل الكل
async function loadAll(){
  await Promise.all([loadStats(), loadUsers(), loadWds(), loadTrs()]);
}

// دالة row
function row(cols){ return `<div class="row">${cols.map(c=>`<div>${c??''}</div>`).join('')}</div>`; }

// إحصائيات
async function loadStats(){
  try {
    const j = await api('/api/admin/stats');
    if(!j.ok) return;

    $('#k-users').textContent = j.users ?? 0;
    $('#k-dep').textContent   = '$'+Number(j.deposits||0).toFixed(2);
    $('#k-wd').textContent    = '$'+Number(j.withdrawals||0).toFixed(2);
    $('#k-open').textContent  = j.open_trades ?? 0;

    const head = row(['#','النوع','القيمة','ملاحظة','وقت الإنشاء']);
    const recentRows = j.recent?.map(r=>row([
      r.id, r.type, Number(r.amount||0).toFixed(2), r.note||'', new Date(r.created_at).toLocaleString()
    ])).join('') || '';

    $('#recent').innerHTML = head + recentRows;
  } catch(err){
    console.error(err);
  }
}

// المستخدمون
$('#qbtn').onclick = loadUsers;
async function loadUsers(){
  try {
    const qv = $('#q')?.value||'';
    const j = await api('/api/admin/users?q='+encodeURIComponent(qv));
    if(!j.ok) return;

    const head = row(['ID','الاسم / TG','الرصيد','الاشتراك','إجراءات']);
    const userRows = j.items?.map(u=>row([
      u.id,
      `${u.name||'-'}<br><small>${u.tg_id||''}</small>`,
      '$'+Number(u.balance||0).toFixed(2),
      u.sub_expires_at ? new Date(u.sub_expires_at).toLocaleDateString() : '—',
      `<button data-a="add" data-id="${u.id}" class="mini">+50</button>
       <button data-a="rem" data-id="${u.id}" class="mini">-50</button>`
    ])).join('') || '';

    $('#users').innerHTML = head + userRows;

    $('#users').onclick = async (e)=>{
      try {
        const b = e.target;
        const id = b.getAttribute('data-id');
        const a = b.getAttribute('data-a');
        if(!id||!a) return;

        const delta = a==='add' ? 50 : -50;
        const res = await api(`/api/admin/users/${id}/balance`, 'POST', { delta, note:'panel adjust' });
        if(res.ok){ showToast('تم التعديل'); loadStats(); loadUsers(); }
      } catch(err){ console.error(err); }
    };
  } catch(err){ console.error(err); }
}

// السحوبات
async function loadWds(){
  try {
    const j = await api('/api/admin/withdrawals');
    if(!j.ok) return;

    const head = row(['ID','المستخدم','المبلغ','الطريقة','الحالة / إجراء']);
    const wdsRows = j.items?.map(w=>row([
      w.id, w.user_id, '$'+Number(w.amount||0).toFixed(2), w.method||'-',
      w.status==='pending'
        ? `<button data-a="ok" data-id="${w.id}" class="mini">قبول</button>
           <button data-a="no" data-id="${w.id}" class="mini">رفض</button>`
        : w.status
    ])).join('') || '';

    $('#wds').innerHTML = head + wdsRows;

    $('#wds').onclick = async (e)=>{
      try {
        const b = e.target;
        const id = b.getAttribute('data-id');
        const a = b.getAttribute('data-a');
        if(!id||!a) return;

        const url = a==='ok' ? `/api/admin/withdrawals/${id}/approve` : `/api/admin/withdrawals/${id}/reject`;
        const body = a==='no' ? { reason:'panel' } : undefined;
        const res = await api(url,'POST', body);
        if(res.ok){ showToast(a==='ok'?'تم القبول':'تم الرفض'); loadWds(); loadStats(); }
      } catch(err){ console.error(err); }
    };
  } catch(err){ console.error(err); }
}

// الصفقات
async function loadTrs(){
  try {
    const j = await api('/api/admin/trades');
    if(!j.ok) return;

    const head = row(['ID','المستخدم','الرمز','الحالة','إجراء']);
    const trsRows = j.items?.map(t=>row([
      t.id, t.user_id, t.symbol||'-', t.status,
      t.status==='open'
        ? `<button class="mini" data-a="close" data-id="${t.id}">إغلاق +20</button>`
        : (t.pnl!=null ? (Number(t.pnl)>=0?'+$'+Number(t.pnl).toFixed(2):'-$'+Math.abs(Number(t.pnl)).toFixed(2)) : '')
    ])).join('') || '';

    $('#trs').innerHTML = head + trsRows;

    $('#trs').onclick = async (e)=>{
      try {
        const b = e.target;
        const id = b.getAttribute('data-id');
        const a = b.getAttribute('data-a');
        if(a==='close'){
          const res = await api(`/api/admin/trades/${id}/close`, 'POST', { pnl:20 });
          if(res.ok){ showToast('أُغلقت الصفقة'); loadTrs(); loadStats(); }
        }
      } catch(err){ console.error(err); }
    };
  } catch(err){ console.error(err); }
}
