/* ========================================
   QL Trading Admin Panel v3.1 - JavaScript
   Enhanced: Scheduled Mass Trades, Live User Trades, Extra Trade Users
======================================== */

const $ = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);

let state = {
  token: null,
  currentUser: null,
  withdrawFilter: 'pending',
  tradeFilter: 'open',
  currentMassTradeId: null,
  currentMassTradeStatus: null
};

// Toast notification
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// API helper
async function api(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': state.token
    }
  };
  if (body) options.body = JSON.stringify(body);
  
  try {
    const res = await fetch(endpoint, options);
    return await res.json();
  } catch (err) {
    console.error('API Error:', err);
    return { ok: false, error: err.message };
  }
}

// Login
$('#admBtn').addEventListener('click', async () => {
  const token = $('#admTok').value.trim();
  if (!token) {
    $('#msg').textContent = 'أدخل كلمة المرور';
    return;
  }
  
  state.token = token;
  
  const r = await api('/api/admin/dashboard');
  
  if (r.ok) {
    localStorage.setItem('adminToken', token);
    $('#login').classList.add('hidden');
    $('#panel').classList.remove('hidden');
    loadAll();
    toast('✅ تم تسجيل الدخول بنجاح');
  } else {
    $('#msg').textContent = '❌ كلمة المرور غير صحيحة';
    state.token = null;
  }
});

// Check saved token
const savedToken = localStorage.getItem('adminToken');
if (savedToken) {
  state.token = savedToken;
  api('/api/admin/dashboard').then(r => {
    if (r.ok) {
      $('#login').classList.add('hidden');
      $('#panel').classList.remove('hidden');
      loadAll();
    } else {
      localStorage.removeItem('adminToken');
      state.token = null;
    }
  });
}

function loadAll() {
  loadDashboard();
  loadUsers();
  loadWithdrawals();
  loadTrades();
  loadSettings();
  loadMassTrades();
  loadTodayScheduled();
  loadExtraTradeUsers();
  loadReferralStats();
}

// Logout
$('#logoutBtn')?.addEventListener('click', () => {
  localStorage.removeItem('adminToken');
  state.token = null;
  location.reload();
});

// Tab switching
$$('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    $$('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ===== DASHBOARD =====
async function loadDashboard() {
  const r = await api('/api/admin/dashboard');
  if (!r.ok) return;
  
  const d = r.data;
  $('#k-users').textContent = d.totalUsers || 0;
  $('#k-dep').textContent = `$${Number(d.totalDeposited || 0).toLocaleString()}`;
  $('#k-wd').textContent = `$${Number(d.totalWithdrawn || 0).toLocaleString()}`;
  $('#k-open').textContent = d.openTrades || 0;
  
  const recent = r.data.recentOps || [];
  $('#recent').innerHTML = `
    <div class="table-row header">
      <div>ID</div>
      <div>النوع</div>
      <div>المبلغ</div>
      <div>الملاحظة</div>
      <div>التاريخ</div>
    </div>
    ${recent.map(op => `
      <div class="table-row">
        <div>${op.user_id || '-'}</div>
        <div>${op.type || '-'}</div>
        <div>$${Number(op.amount || 0).toFixed(2)}</div>
        <div>${op.note || '-'}</div>
        <div>${new Date(op.created_at).toLocaleString('ar')}</div>
      </div>
    `).join('')}
  `;
}

// ===== USERS =====
async function loadUsers() {
  const r = await api('/api/admin/users');
  if (!r.ok) return;
  
  const users = r.data || [];
  $('#users').innerHTML = `
    <div class="table-row header">
      <div>ID</div>
      <div>الاسم</div>
      <div>الرصيد</div>
      <div>الاشتراك</div>
      <div>إجراءات</div>
    </div>
    ${users.map(u => `
      <div class="table-row" style="${u.is_banned ? 'opacity: 0.5; border-right: 3px solid var(--danger);' : ''}">
        <div>${u.id}</div>
        <div>${u.name || u.tg_id} ${u.is_banned ? '<span style="color:var(--danger);font-size:12px;">🚫 محظور</span>' : ''}</div>
        <div>$${Number(u.balance || 0).toFixed(2)}</div>
        <div>${u.sub_expires ? new Date(u.sub_expires).toLocaleDateString('ar') : 'منتهي'}</div>
        <div class="table-actions">
          <button class="mini-btn view" onclick="viewUser(${u.id})">عرض</button>
        </div>
      </div>
    `).join('')}
  `;
}

// Search User
$('#searchBtn')?.addEventListener('click', async () => {
  const query = $('#searchInput').value.trim();
  if (!query) return toast('أدخل كلمة البحث');
  
  const r = await api(`/api/admin/user/search?q=${encodeURIComponent(query)}`);
  if (r.ok && r.data) {
    showUserDetails(r.data);
  } else {
    toast('❌ لم يتم العثور على المستخدم');
  }
});

$('#searchInput')?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') $('#searchBtn').click();
});

window.viewUser = async (id) => {
  const r = await api(`/api/admin/user/${id}`);
  if (r.ok && r.data) {
    showUserDetails(r.data);
  }
};

function showUserDetails(user) {
  state.currentUser = user;
  $('#userDetails').classList.remove('hidden');
  
  $('#ud-id').textContent = user.id;
  $('#ud-tgid').textContent = user.tg_id;
  $('#ud-name').textContent = user.name || '-';
  $('#ud-email').textContent = user.email || '-';
  $('#ud-balance').textContent = `$${Number(user.balance || 0).toFixed(2)}`;
  $('#ud-sub').textContent = user.sub_expires ? new Date(user.sub_expires).toLocaleDateString('ar') : 'منتهي';
  
  if (user.is_banned) {
    $('#ud-status').innerHTML = `<span style="color:var(--danger);">🚫 محظور</span><br><small style="color:var(--muted);">السبب: ${user.ban_reason || '-'}</small>`;
    $('#banUserBtn').classList.add('hidden');
    $('#unbanUserBtn').classList.remove('hidden');
  } else {
    $('#ud-status').innerHTML = `<span style="color:var(--success);">✅ نشط</span>`;
    $('#banUserBtn').classList.remove('hidden');
    $('#unbanUserBtn').classList.add('hidden');
  }
  
  $('#userDetails').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#closeUserDetails')?.addEventListener('click', () => {
  $('#userDetails').classList.add('hidden');
  state.currentUser = null;
});

// Balance Management
$('#addBalanceBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  const amount = Number($('#balanceAmount').value);
  if (!amount || amount <= 0) return toast('أدخل مبلغ صحيح');
  
  const r = await api('/api/admin/user/balance', 'POST', { user_id: state.currentUser.id, amount, action: 'add' });
  if (r.ok) { toast('✅ تم إضافة الرصيد'); viewUser(state.currentUser.id); loadUsers(); }
  else toast('❌ ' + (r.error || 'خطأ'));
});

$('#removeBalanceBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  const amount = Number($('#balanceAmount').value);
  if (!amount || amount <= 0) return toast('أدخل مبلغ صحيح');
  
  const r = await api('/api/admin/user/balance', 'POST', { user_id: state.currentUser.id, amount, action: 'remove' });
  if (r.ok) { toast('✅ تم خصم الرصيد'); viewUser(state.currentUser.id); loadUsers(); }
  else toast('❌ ' + (r.error || 'خطأ'));
});

$('#zeroBalanceBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  if (!confirm('هل أنت متأكد من تصفير الرصيد؟')) return;
  const r = await api('/api/admin/user/balance', 'POST', { user_id: state.currentUser.id, amount: 0, action: 'zero' });
  if (r.ok) { toast('✅ تم تصفير الرصيد'); viewUser(state.currentUser.id); loadUsers(); }
  else toast('❌ ' + (r.error || 'خطأ'));
});

$('#extendSubBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  const days = Number($('#subDays').value);
  if (!days || days <= 0) return toast('أدخل عدد الأيام');
  const r = await api('/api/admin/user/subscription', 'POST', { user_id: state.currentUser.id, days });
  if (r.ok) { toast('✅ تم تمديد الاشتراك'); viewUser(state.currentUser.id); loadUsers(); }
  else toast('❌ ' + (r.error || 'خطأ'));
});

$('#addTradeBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  const pnl = Number($('#tradePnl').value);
  const hours = Number($('#tradeHours').value) || 1;
  if (pnl === undefined || pnl === null) return toast('أدخل الربح/الخسارة');
  const r = await api('/api/admin/user/trade', 'POST', { user_id: state.currentUser.id, target_pnl: pnl, duration_hours: hours });
  if (r.ok) { toast('✅ تم إضافة الصفقة (مع إشعار Telegram)'); loadTrades(); }
  else toast('❌ ' + (r.error || 'خطأ'));
});

$('#clearHistoryBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  if (!confirm('هل أنت متأكد من تصفير السجل؟')) return;
  const r = await api('/api/admin/user/clear-history', 'POST', { user_id: state.currentUser.id });
  if (r.ok) toast('✅ تم تصفير السجل');
  else toast('❌ ' + (r.error || 'خطأ'));
});

$('#clearWithdrawalsBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  if (!confirm('هل أنت متأكد من تصفير جميع طلبات السحب لهذا المستخدم؟')) return;
  const r = await api('/api/admin/withdraw/clear-user', 'POST', { user_id: state.currentUser.id });
  if (r.ok) { toast('✅ تم تصفير طلبات السحب'); loadWithdrawals(); }
  else toast('❌ ' + (r.error || 'خطأ'));
});

$('#resetWithdrawnBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  if (!confirm('هل أنت متأكد من تصفير إجمالي المسحوب؟')) return;
  const r = await api('/api/admin/user/reset-withdrawn', 'POST', { user_id: state.currentUser.id });
  if (r.ok) { toast('✅ تم تصفير إجمالي المسحوب'); viewUser(state.currentUser.id); }
  else toast('❌ ' + (r.error || 'خطأ'));
});

$('#clearTradesBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  if (!confirm('هل أنت متأكد من حذف جميع صفقات هذا المستخدم؟')) return;
  const r = await api('/api/admin/user/clear-trades', 'POST', { user_id: state.currentUser.id });
  if (r.ok) { toast('✅ تم حذف الصفقات'); loadTrades(); }
  else toast('❌ ' + (r.error || 'خطأ'));
});

// Ban/Unban
$('#banUserBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  const reason = $('#banReason').value.trim() || 'مخالفة شروط الاستخدام';
  if (!confirm(`هل أنت متأكد من حظر المستخدم #${state.currentUser.id}؟`)) return;
  const r = await api('/api/admin/user/ban', 'POST', { user_id: state.currentUser.id, banned: true, reason });
  if (r.ok) { toast('✅ تم حظر المستخدم'); viewUser(state.currentUser.id); loadUsers(); }
  else toast('❌ ' + (r.error || 'خطأ'));
});

$('#unbanUserBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  if (!confirm(`هل أنت متأكد من رفع الحظر عن المستخدم #${state.currentUser.id}؟`)) return;
  const r = await api('/api/admin/user/unban', 'POST', { user_id: state.currentUser.id });
  if (r.ok) { toast('✅ تم رفع الحظر'); viewUser(state.currentUser.id); loadUsers(); }
  else toast('❌ ' + (r.error || 'خطأ'));
});

// ===== WITHDRAWALS =====
async function loadWithdrawals() {
  const r = await api(`/api/admin/withdrawals?status=${state.withdrawFilter}`);
  if (!r.ok) return;
  
  const wds = r.data || [];
  $('#wds').innerHTML = `
    <div class="table-row header">
      <div>ID</div>
      <div>المستخدم</div>
      <div>المبلغ</div>
      <div>الطريقة</div>
      <div>الحالة</div>
      <div>إجراءات</div>
    </div>
    ${wds.map(w => `
      <div class="table-row">
        <div>${w.id}</div>
        <div>${w.user_name || w.user_id}</div>
        <div>$${Number(w.amount || 0).toFixed(2)}</div>
        <div>${w.method || '-'}</div>
        <div>${w.status === 'pending' ? '⏳ قيد الانتظار' : w.status === 'approved' ? '✅ مقبول' : '❌ مرفوض'}</div>
        <div class="table-actions">
          ${w.status === 'pending' ? `
            <button class="mini-btn view" onclick="approveWithdraw(${w.id})">قبول</button>
            <button class="mini-btn reject" onclick="rejectWithdraw(${w.id})">رفض</button>
          ` : '-'}
        </div>
      </div>
    `).join('')}
    ${wds.length === 0 ? '<div style="padding: 20px; text-align: center; color: var(--muted);">لا توجد طلبات</div>' : ''}
  `;
}

$$('#tab-wd .filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('#tab-wd .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.withdrawFilter = btn.dataset.filter;
    loadWithdrawals();
  });
});

window.approveWithdraw = async (id) => {
  if (!confirm('هل أنت متأكد من قبول طلب السحب؟')) return;
  const r = await api('/api/admin/withdraw/approve', 'POST', { request_id: id });
  if (r.ok) { toast('✅ تم قبول طلب السحب'); loadWithdrawals(); loadDashboard(); }
  else toast('❌ ' + (r.error || 'خطأ'));
};

window.rejectWithdraw = async (id) => {
  const reason = prompt('سبب الرفض (اختياري):');
  const r = await api('/api/admin/withdraw/reject', 'POST', { request_id: id, reason });
  if (r.ok) { toast('✅ تم رفض طلب السحب'); loadWithdrawals(); loadDashboard(); }
  else toast('❌ ' + (r.error || 'خطأ'));
};

// ===== TRADES =====
async function loadTrades() {
  const r = await api(`/api/admin/trades?status=${state.tradeFilter}`);
  if (!r.ok) return;
  
  const trs = r.data || [];
  $('#trs').innerHTML = `
    <div class="table-row header">
      <div>ID</div>
      <div>المستخدم</div>
      <div>الرمز</div>
      <div>الربح</div>
      <div>الحالة</div>
      <div>إجراءات</div>
    </div>
    ${trs.map(t => `
      <div class="table-row">
        <div>${t.id}</div>
        <div>${t.user_name || t.user_id}</div>
        <div>${t.symbol || 'XAUUSD'}</div>
        <div style="color: ${Number(t.pnl) >= 0 ? 'var(--success)' : 'var(--danger)'}">$${Number(t.pnl || 0).toFixed(2)}</div>
        <div>${t.status === 'open' ? '🟢 مفتوحة' : '⚫ مغلقة'}</div>
        <div class="table-actions">
          ${t.status === 'open' ? `<button class="mini-btn reject" onclick="closeTrade(${t.id})">إغلاق</button>` : '-'}
        </div>
      </div>
    `).join('')}
  `;
}

$$('#tab-tr .filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('#tab-tr .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.tradeFilter = btn.dataset.filter;
    loadTrades();
  });
});

window.closeTrade = async (id) => {
  if (!confirm('هل أنت متأكد من إغلاق الصفقة؟')) return;
  const r = await api('/api/admin/trade/close', 'POST', { trade_id: id });
  if (r.ok) { toast('✅ تم إغلاق الصفقة'); loadTrades(); loadDashboard(); }
  else toast('❌ ' + (r.error || 'خطأ'));
};

// ===== TODAY'S SCHEDULED TRADES =====
async function loadTodayScheduled() {
  const r = await api('/api/admin/mass-trade/today');
  if (!r.ok) return;
  
  const trades = r.data || [];
  const container = $('#todayScheduled');
  
  if (trades.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--muted);">
        <div style="font-size: 40px; margin-bottom: 12px;">📅</div>
        <p>لم يتم إنشاء صفقات اليوم بعد</p>
        <p style="font-size: 13px;">اضغط "إنشاء صفقات اليوم" لإنشاء 3 صفقات مجدولة</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = trades.map(t => {
    const statusColor = t.status === 'pending' ? '#f0ad4e' : t.status === 'open' ? '#00d68f' : '#666';
    const statusIcon = t.status === 'pending' ? '⏳' : t.status === 'open' ? '🟢' : '⚫';
    const statusText = t.status === 'pending' ? 'معلّقة - بانتظار النسبة' : t.status === 'open' ? 'مفتوحة - صفقات حية' : 'مغلقة';
    const timeLabel = t.scheduled_time === '14:00' ? '🌤️ 2:00 ظهراً' : t.scheduled_time === '18:00' ? '🌆 6:00 مساءً' : '🌙 9:30 ليلاً';
    
    return `
      <div class="today-trade-card glass" style="border-right: 4px solid ${statusColor};">
        <div class="today-trade-header">
          <div class="today-trade-time">${timeLabel}</div>
          <div class="today-trade-status" style="color: ${statusColor};">${statusIcon} ${statusText}</div>
        </div>
        <div class="today-trade-info">
          <span>${t.symbol || 'XAUUSD'} ${t.direction || 'BUY'}</span>
          <span style="color: var(--muted); font-size: 12px;">${t.note || ''}</span>
          ${t.percentage ? `<span style="color: ${Number(t.percentage) >= 0 ? 'var(--success)' : 'var(--danger)'}; font-weight: 700;">${Number(t.percentage) >= 0 ? '+' : ''}${t.percentage}%</span>` : ''}
          <span style="color: var(--muted); font-size: 12px;">مشاركون: ${t.participants_count || 0}</span>
        </div>
        <div class="today-trade-actions">
          ${t.status === 'pending' ? `
            <button class="mini-btn view" onclick="openMassActionModal(${t.id}, 'pending')">تفعيل</button>
          ` : t.status === 'open' ? `
            <button class="mini-btn reject" onclick="openMassActionModal(${t.id}, 'open')">إدارة</button>
          ` : `
            <button class="mini-btn" onclick="viewMassTradeDetails(${t.id})" style="background: rgba(255,255,255,0.1);">تفاصيل</button>
          `}
        </div>
      </div>
    `;
  }).join('');
}

// Create Daily Scheduled Trades
$('#createDailyBtn')?.addEventListener('click', async () => {
  const r = await api('/api/admin/mass-trade/create-daily', 'POST');
  if (r.ok) {
    toast(`✅ ${r.message}`);
    loadTodayScheduled();
    loadMassTrades();
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

// ===== MASS TRADES =====
async function loadMassTrades() {
  const r = await api('/api/admin/mass-trades');
  if (!r.ok) return;
  
  const trades = r.data || [];
  $('#massTrades').innerHTML = `
    <div class="table-row header" style="grid-template-columns: 50px 90px 80px 80px 100px 100px 120px 150px;">
      <div>ID</div>
      <div>الرمز</div>
      <div>الاتجاه</div>
      <div>النسبة</div>
      <div>المشاركون</div>
      <div>الوقت</div>
      <div>الحالة</div>
      <div>إجراءات</div>
    </div>
    ${trades.map(t => {
      const statusColor = t.status === 'pending' ? '#f0ad4e' : t.status === 'open' ? '#00d68f' : '#666';
      const statusIcon = t.status === 'pending' ? '⏳' : t.status === 'open' ? '🟢' : '⚫';
      const statusText = t.status === 'pending' ? 'معلّقة' : t.status === 'open' ? 'مفتوحة' : 'مغلقة';
      
      return `
        <div class="table-row" style="grid-template-columns: 50px 90px 80px 80px 100px 100px 120px 150px;">
          <div>${t.id}</div>
          <div>${t.symbol || 'XAUUSD'}</div>
          <div>${t.direction || 'BUY'}</div>
          <div style="color: ${Number(t.percentage) >= 0 ? 'var(--success)' : 'var(--danger)'}">${t.percentage ? (Number(t.percentage) >= 0 ? '+' : '') + t.percentage + '%' : '-'}</div>
          <div>${t.participants_count || 0}</div>
          <div>${t.scheduled_time || '-'}</div>
          <div style="color: ${statusColor};">${statusIcon} ${statusText}</div>
          <div class="table-actions">
            ${t.status === 'pending' ? `
              <button class="mini-btn view" onclick="openMassActionModal(${t.id}, 'pending')">تفعيل</button>
            ` : t.status === 'open' ? `
              <button class="mini-btn reject" onclick="openMassActionModal(${t.id}, 'open')">إدارة</button>
            ` : `
              <button class="mini-btn" onclick="viewMassTradeDetails(${t.id})" style="background: rgba(255,255,255,0.1);">تفاصيل</button>
            `}
          </div>
        </div>
      `;
    }).join('')}
    ${trades.length === 0 ? '<div style="padding: 20px; text-align: center; color: var(--muted);">لا توجد صفقات جماعية</div>' : ''}
  `;
}

// Open Mass Trade (manual)
$('#openMassTradeBtn')?.addEventListener('click', async () => {
  const symbol = $('#massSymbol').value;
  const direction = $('#massDirection').value;
  const note = $('#massNote').value.trim();
  
  if (!confirm('هل أنت متأكد من فتح صفقة جماعية جديدة (معلّقة)؟')) return;
  
  const r = await api('/api/admin/mass-trade/open', 'POST', { symbol, direction, note });
  if (r.ok) {
    toast(`✅ تم إنشاء صفقة جماعية معلّقة`);
    loadMassTrades();
    loadTodayScheduled();
    $('#massNote').value = '';
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

// Open Mass Action Modal
window.openMassActionModal = async (id, status) => {
  state.currentMassTradeId = id;
  state.currentMassTradeStatus = status;
  
  $('#massActionId').textContent = id;
  $('#massActionModal').classList.remove('hidden');
  
  // Show/hide sections based on status
  if (status === 'pending') {
    $('#activateSection').classList.remove('hidden');
    $('#closeSection').classList.add('hidden');
    $('#legacyCloseSection').classList.remove('hidden');
    $('#userTradesList').classList.add('hidden');
    $('#massActionTitle').innerHTML = `🚀 تفعيل صفقة جماعية #<span id="massActionId">${id}</span>`;
  } else if (status === 'open') {
    $('#activateSection').classList.add('hidden');
    $('#closeSection').classList.remove('hidden');
    $('#legacyCloseSection').classList.add('hidden');
    $('#userTradesList').classList.remove('hidden');
    $('#massActionTitle').innerHTML = `🟢 إدارة صفقة جماعية مفتوحة #<span id="massActionId">${id}</span>`;
    
    // Load user trades
    loadMassTradeUserTrades(id);
  }
  
  // Reset inputs
  $('#activatePercentage').value = '';
  $('#massPercentage').value = '';
  $('#overrideUserId').value = '';
  $('#overridePercentage').value = '';
  $('#overridesList').innerHTML = '';
  
  $('#massActionModal').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

$('#closeMassActionModal')?.addEventListener('click', () => {
  $('#massActionModal').classList.add('hidden');
  state.currentMassTradeId = null;
  state.currentMassTradeStatus = null;
});

// Activate Mass Trade (new system - creates live trades for users)
$('#activateMassTradeBtn')?.addEventListener('click', async () => {
  if (!state.currentMassTradeId) return;
  const percentage = Number($('#activatePercentage').value);
  
  if (isNaN(percentage)) return toast('أدخل النسبة المئوية');
  if (!confirm(`هل أنت متأكد من تفعيل الصفقة الجماعية بنسبة ${percentage >= 0 ? '+' : ''}${percentage}%؟\n\nسيتم:\n- إنشاء صفقة حية لكل مستخدم (مدة ساعة)\n- إرسال إشعار تلغرام لكل مستخدم\n- عرض حركة أسعار حية`)) return;
  
  toast('⏳ جاري التفعيل...');
  
  const r = await api('/api/admin/mass-trade/activate', 'POST', {
    mass_trade_id: state.currentMassTradeId,
    percentage
  });
  
  if (r.ok) {
    toast(`✅ تم التفعيل! ${r.data.participants} مستخدم - نسبة ${percentage}%`);
    $('#massActionModal').classList.add('hidden');
    state.currentMassTradeId = null;
    loadMassTrades();
    loadTodayScheduled();
    loadDashboard();
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

// Force Close Mass Trade (for open trades)
$('#forceCloseMassTradeBtn')?.addEventListener('click', async () => {
  if (!state.currentMassTradeId) return;
  if (!confirm('هل أنت متأكد من إغلاق جميع صفقات المستخدمين فوراً؟')) return;
  
  toast('⏳ جاري الإغلاق...');
  
  const r = await api('/api/admin/mass-trade/close', 'POST', {
    mass_trade_id: state.currentMassTradeId
  });
  
  if (r.ok) {
    toast(`✅ تم الإغلاق - ${r.data.affected} مستخدم تأثر`);
    $('#massActionModal').classList.add('hidden');
    state.currentMassTradeId = null;
    loadMassTrades();
    loadTodayScheduled();
    loadDashboard();
    loadUsers();
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

// Legacy Close Mass Trade (direct percentage application)
$('#closeMassTradeBtn')?.addEventListener('click', async () => {
  if (!state.currentMassTradeId) return;
  const percentage = Number($('#massPercentage').value);
  
  if (isNaN(percentage)) return toast('أدخل النسبة المئوية');
  if (!confirm(`هل أنت متأكد من الإغلاق الفوري بنسبة ${percentage >= 0 ? '+' : ''}${percentage}%؟\nسيتم تحديث أرصدة جميع المستخدمين مباشرة.`)) return;
  
  toast('⏳ جاري الإغلاق...');
  
  const r = await api('/api/admin/mass-trade/close', 'POST', {
    mass_trade_id: state.currentMassTradeId,
    percentage
  });
  
  if (r.ok) {
    toast(`✅ تم الإغلاق - ${r.data.affected} مستخدم تأثر - إجمالي PnL: $${r.data.totalPnl}`);
    $('#massActionModal').classList.add('hidden');
    state.currentMassTradeId = null;
    loadMassTrades();
    loadTodayScheduled();
    loadDashboard();
    loadUsers();
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

// Set Override
$('#setOverrideBtn')?.addEventListener('click', async () => {
  if (!state.currentMassTradeId) return;
  const userId = Number($('#overrideUserId').value);
  const percentage = Number($('#overridePercentage').value);
  
  if (!userId) return toast('أدخل User ID');
  if (isNaN(percentage)) return toast('أدخل النسبة');
  
  const r = await api('/api/admin/mass-trade/override', 'POST', {
    mass_trade_id: state.currentMassTradeId,
    user_id: userId,
    custom_percentage: percentage
  });
  
  if (r.ok) {
    toast(`✅ تم تعيين نسبة مخصصة ${percentage}% للمستخدم #${userId}`);
    const list = $('#overridesList');
    list.innerHTML += `<div style="padding: 8px; background: rgba(0,102,255,0.1); border-radius: 8px; margin-bottom: 4px; font-size: 13px;">
      المستخدم #${userId}: <strong style="color: ${percentage >= 0 ? 'var(--success)' : 'var(--danger)'}">${percentage >= 0 ? '+' : ''}${percentage}%</strong>
    </div>`;
    $('#overrideUserId').value = '';
    $('#overridePercentage').value = '';
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

// Load Mass Trade User Trades (for open mass trades)
async function loadMassTradeUserTrades(massTradeId) {
  const r = await api(`/api/admin/mass-trade/${massTradeId}`);
  if (!r.ok) return;
  
  const { userTrades } = r.data;
  
  if (!userTrades || userTrades.length === 0) {
    $('#userTradesTable').innerHTML = '<div style="padding: 16px; text-align: center; color: var(--muted);">لا توجد صفقات حية</div>';
    return;
  }
  
  $('#userTradesTable').innerHTML = `
    <div class="table-row header" style="grid-template-columns: 50px 1fr 80px 100px 80px;">
      <div>ID</div>
      <div>المستخدم</div>
      <div>الاتجاه</div>
      <div>الربح الحالي</div>
      <div>الحالة</div>
    </div>
    ${userTrades.map(ut => `
      <div class="table-row" style="grid-template-columns: 50px 1fr 80px 100px 80px;">
        <div>${ut.user_id}</div>
        <div>${ut.name || ut.tg_id}</div>
        <div>${ut.direction}</div>
        <div style="color: ${Number(ut.pnl) >= 0 ? 'var(--success)' : 'var(--danger)'}">
          ${Number(ut.pnl) >= 0 ? '+' : ''}$${Number(ut.pnl || 0).toFixed(2)}
        </div>
        <div style="color: ${ut.status === 'open' ? 'var(--success)' : 'var(--muted)'};">
          ${ut.status === 'open' ? '🟢' : '⚫'} ${ut.status}
        </div>
      </div>
    `).join('')}
  `;
}

// View Mass Trade Details
window.viewMassTradeDetails = async (id) => {
  const r = await api(`/api/admin/mass-trade/${id}`);
  if (!r.ok) return toast('❌ خطأ في تحميل التفاصيل');
  
  const { trade, participants, overrides, userTrades } = r.data;
  
  let detailsHtml = `<div class="card glass" style="border: 2px solid var(--accent); margin-top: 16px;">
    <div class="card-header">
      <h3>📊 تفاصيل الصفقة الجماعية #${trade.id}</h3>
      <button class="btn-small" onclick="document.getElementById('massTradeDetailsView').remove()">✕</button>
    </div>
    <div class="user-info">
      <div class="user-row"><span class="label">الرمز:</span><span class="value">${trade.symbol}</span></div>
      <div class="user-row"><span class="label">الاتجاه:</span><span class="value">${trade.direction}</span></div>
      <div class="user-row"><span class="label">النسبة:</span><span class="value" style="color: ${Number(trade.percentage) >= 0 ? 'var(--success)' : 'var(--danger)'}">${trade.percentage ? (Number(trade.percentage) >= 0 ? '+' : '') + trade.percentage + '%' : '-'}</span></div>
      <div class="user-row"><span class="label">المشاركون:</span><span class="value">${trade.participants_count}</span></div>
      <div class="user-row"><span class="label">الوقت المجدول:</span><span class="value">${trade.scheduled_time || '-'}</span></div>
      <div class="user-row"><span class="label">تاريخ الفتح:</span><span class="value">${new Date(trade.created_at).toLocaleString('ar')}</span></div>
      <div class="user-row"><span class="label">تاريخ الإغلاق:</span><span class="value">${trade.closed_at ? new Date(trade.closed_at).toLocaleString('ar') : '-'}</span></div>
    </div>`;
  
  if (participants && participants.length > 0) {
    detailsHtml += `<h4 style="margin: 16px 0 8px; color: var(--accent-light);">👥 المشاركون (${participants.length})</h4>
    <div class="table-container">
      <div class="table-row header" style="grid-template-columns: 50px 1fr 100px 100px 100px 80px;">
        <div>ID</div>
        <div>الاسم</div>
        <div>الرصيد قبل</div>
        <div>الرصيد بعد</div>
        <div>الربح/الخسارة</div>
        <div>النسبة</div>
      </div>
      ${participants.map(p => `
        <div class="table-row" style="grid-template-columns: 50px 1fr 100px 100px 100px 80px;">
          <div>${p.user_id}</div>
          <div>${p.name || p.tg_id}</div>
          <div>$${Number(p.balance_before || 0).toFixed(2)}</div>
          <div>$${Number(p.balance_after || 0).toFixed(2)}</div>
          <div style="color: ${Number(p.pnl_amount) >= 0 ? 'var(--success)' : 'var(--danger)'}">${Number(p.pnl_amount) >= 0 ? '+' : ''}$${Number(p.pnl_amount || 0).toFixed(2)}</div>
          <div>${Number(p.percentage_applied) >= 0 ? '+' : ''}${p.percentage_applied || 0}%</div>
        </div>
      `).join('')}
    </div>`;
  }
  
  detailsHtml += '</div>';
  
  const existing = document.getElementById('massTradeDetailsView');
  if (existing) existing.remove();
  
  const div = document.createElement('div');
  div.id = 'massTradeDetailsView';
  div.innerHTML = detailsHtml;
  $('#massTrades').parentElement.after(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ===== EXTRA TRADE USERS =====
async function loadExtraTradeUsers() {
  const r = await api('/api/admin/extra-trade-users');
  if (!r.ok) return;
  
  const users = r.data || [];
  
  if (users.length === 0) {
    $('#extraUsersList').innerHTML = '<div style="padding: 16px; text-align: center; color: var(--muted);">لا يوجد مستخدمون بصفقات إضافية</div>';
    return;
  }
  
  $('#extraUsersList').innerHTML = `
    <div class="table-row header" style="grid-template-columns: 50px 1fr 100px 100px 100px 80px;">
      <div>ID</div>
      <div>الاسم</div>
      <div>الرصيد</div>
      <div>صفقات/يوم</div>
      <div>ملاحظة</div>
      <div>إجراء</div>
    </div>
    ${users.map(u => `
      <div class="table-row" style="grid-template-columns: 50px 1fr 100px 100px 100px 80px;">
        <div>${u.user_id}</div>
        <div>${u.name || u.tg_id}</div>
        <div>$${Number(u.balance || 0).toFixed(2)}</div>
        <div>${u.extra_trades_per_day}</div>
        <div>${u.note || '-'}</div>
        <div class="table-actions">
          <button class="mini-btn reject" onclick="removeExtraUser(${u.user_id})">حذف</button>
        </div>
      </div>
    `).join('')}
  `;
}

$('#addExtraUserBtn')?.addEventListener('click', async () => {
  const userId = Number($('#extraUserId').value);
  const count = Number($('#extraTradesCount').value) || 1;
  const note = $('#extraNote').value.trim();
  
  if (!userId) return toast('أدخل User ID');
  
  const r = await api('/api/admin/extra-trade-user/add', 'POST', {
    user_id: userId,
    extra_trades_per_day: count,
    note
  });
  
  if (r.ok) {
    toast(`✅ تم إضافة المستخدم #${userId} لقائمة الصفقات الإضافية`);
    loadExtraTradeUsers();
    $('#extraUserId').value = '';
    $('#extraNote').value = '';
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

window.removeExtraUser = async (userId) => {
  if (!confirm(`هل أنت متأكد من حذف المستخدم #${userId} من قائمة الصفقات الإضافية؟`)) return;
  
  const r = await api('/api/admin/extra-trade-user/remove', 'POST', { user_id: userId });
  if (r.ok) {
    toast('✅ تم الحذف');
    loadExtraTradeUsers();
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
};

// ===== REFERRALS =====
async function loadReferralStats() {
  const r = await api('/api/admin/referrals/stats');
  if (!r.ok) return;
  
  const d = r.data;
  $('#k-refs-total').textContent = d.total || 0;
  $('#k-refs-credited').textContent = d.credited || 0;
  $('#k-refs-paid').textContent = `$${Number(d.totalPaid || 0).toLocaleString()}`;
  $('#k-refs-pending').textContent = d.pending || 0;
  
  const referrers = d.topReferrers || [];
  $('#topReferrers').innerHTML = `
    <div class="table-row header" style="grid-template-columns: 50px 1fr 100px 100px 100px;">
      <div>#</div>
      <div>الاسم</div>
      <div>Telegram ID</div>
      <div>عدد الدعوات</div>
      <div>الأرباح</div>
    </div>
    ${referrers.map((r, i) => `
      <div class="table-row" style="grid-template-columns: 50px 1fr 100px 100px 100px;">
        <div>${i + 1}</div>
        <div>${r.name || '-'}</div>
        <div>${r.tg_id}</div>
        <div>${r.ref_count}</div>
        <div style="color: var(--success);">$${Number(r.earnings || 0).toFixed(2)}</div>
      </div>
    `).join('')}
    ${referrers.length === 0 ? '<div style="padding: 20px; text-align: center; color: var(--muted);">لا توجد دعوات بعد</div>' : ''}
  `;
}

// ===== SETTINGS =====
async function loadSettings() {
  const wdStatus = await api('/api/admin/settings/withdrawal');
  if (wdStatus.ok) {
    const enabled = wdStatus.enabled !== false;
    $('#withdrawStatus').textContent = enabled ? '✅ مفعّل' : '❌ متوقف';
    $('#withdrawStatus').className = `status-badge ${enabled ? 'enabled' : 'disabled'}`;
  }
  
  const mStatus = await api('/api/admin/settings/maintenance');
  if (mStatus.ok) {
    const enabled = mStatus.enabled === true;
    $('#maintenanceStatus').textContent = enabled ? '🛠️ مفعّل' : '✅ غير مفعّل';
    $('#maintenanceStatus').className = `status-badge ${enabled ? 'disabled' : 'enabled'}`;
  }
}

$('#toggleWithdraw')?.addEventListener('click', async () => {
  const r = await api('/api/admin/settings/withdrawal/toggle', 'POST');
  if (r.ok) { toast('✅ تم تغيير حالة السحب'); loadSettings(); }
  else toast('❌ ' + (r.error || 'خطأ'));
});

$('#toggleMaintenance')?.addEventListener('click', async () => {
  const r = await api('/api/admin/settings/maintenance/toggle', 'POST');
  if (r.ok) { toast('✅ تم تغيير حالة الصيانة'); loadSettings(); }
  else toast('❌ ' + (r.error || 'خطأ'));
});

$('#createKeyBtn')?.addEventListener('click', async () => {
  const code = $('#newKeyCode').value.trim();
  const days = Number($('#newKeyDays').value) || 30;
  if (!code) return toast('أدخل كود المفتاح');
  const r = await api('/api/admin/key/create', 'POST', { code, days });
  if (r.ok) { toast('✅ تم إنشاء المفتاح'); $('#newKeyCode').value = ''; }
  else toast('❌ ' + (r.error || 'خطأ'));
});

$('#broadcastBtn')?.addEventListener('click', async () => {
  const title = $('#broadcastTitle')?.value?.trim() || '';
  const msg = $('#broadcastMsg').value.trim();
  if (!msg) return toast('أدخل نص الرسالة');
  if (!confirm('هل أنت متأكد من إرسال الرسالة للجميع عبر Telegram؟')) return;
  toast('⏳ جاري الإرسال...');
  const r = await api('/api/admin/broadcast', 'POST', { message: msg, title });
  if (r.ok) {
    toast(`✅ تم الإرسال - ${r.sent} نجح / ${r.failed} فشل`);
    $('#broadcastMsg').value = '';
    if ($('#broadcastTitle')) $('#broadcastTitle').value = '';
  } else toast('❌ ' + (r.error || 'خطأ'));
});

$('#clearAllWithdrawalsBtn')?.addEventListener('click', async () => {
  if (!confirm('⚠️ هل أنت متأكد من تصفير جميع طلبات السحب في النظام؟')) return;
  const r = await api('/api/admin/withdraw/clear-all', 'POST');
  if (r.ok) { toast('✅ تم تصفير جميع طلبات السحب'); loadWithdrawals(); loadDashboard(); }
  else toast('❌ ' + (r.error || 'خطأ'));
});

// Auto refresh every 30 seconds
setInterval(() => {
  if (state.token && !$('#panel').classList.contains('hidden')) {
    loadDashboard();
    loadWithdrawals();
    loadTrades();
    loadMassTrades();
    loadTodayScheduled();
  }
}, 30000);
