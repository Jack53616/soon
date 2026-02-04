/* ========================================
   QL Trading Admin Panel - JavaScript
======================================== */

const $ = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);

let state = {
  token: null,
  currentUser: null,
  withdrawFilter: 'pending',
  tradeFilter: 'open'
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
  
  // Test authentication
  const r = await api('/api/admin/dashboard');
  
  if (r.ok) {
    localStorage.setItem('adminToken', token);
    $('#login').classList.add('hidden');
    $('#panel').classList.remove('hidden');
    loadDashboard();
    loadUsers();
    loadWithdrawals();
    loadTrades();
    loadSettings();
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
      loadDashboard();
      loadUsers();
      loadWithdrawals();
      loadTrades();
      loadSettings();
    } else {
      localStorage.removeItem('adminToken');
      state.token = null;
    }
  });
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

// Load Dashboard
async function loadDashboard() {
  const r = await api('/api/admin/dashboard');
  if (!r.ok) return;
  
  const d = r.data;
  $('#k-users').textContent = d.totalUsers || 0;
  $('#k-dep').textContent = `$${Number(d.totalDeposited || 0).toLocaleString()}`;
  $('#k-wd').textContent = `$${Number(d.totalWithdrawn || 0).toLocaleString()}`;
  $('#k-open').textContent = d.openTrades || 0;
  
  // Recent activity
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

// Load Users
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
      <div class="table-row">
        <div>${u.id}</div>
        <div>${u.name || u.tg_id}</div>
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

// View User
window.viewUser = async (id) => {
  const r = await api(`/api/admin/user/${id}`);
  if (r.ok && r.data) {
    showUserDetails(r.data);
  }
};

// Show User Details
function showUserDetails(user) {
  state.currentUser = user;
  $('#userDetails').classList.remove('hidden');
  
  $('#ud-id').textContent = user.id;
  $('#ud-tgid').textContent = user.tg_id;
  $('#ud-name').textContent = user.name || '-';
  $('#ud-email').textContent = user.email || '-';
  $('#ud-balance').textContent = `$${Number(user.balance || 0).toFixed(2)}`;
  $('#ud-sub').textContent = user.sub_expires ? new Date(user.sub_expires).toLocaleDateString('ar') : 'منتهي';
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
  
  const r = await api('/api/admin/user/balance', 'POST', {
    user_id: state.currentUser.id,
    amount: amount,
    action: 'add'
  });
  
  if (r.ok) {
    toast('✅ تم إضافة الرصيد');
    viewUser(state.currentUser.id);
    loadUsers();
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

$('#removeBalanceBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  const amount = Number($('#balanceAmount').value);
  if (!amount || amount <= 0) return toast('أدخل مبلغ صحيح');
  
  const r = await api('/api/admin/user/balance', 'POST', {
    user_id: state.currentUser.id,
    amount: amount,
    action: 'remove'
  });
  
  if (r.ok) {
    toast('✅ تم خصم الرصيد');
    viewUser(state.currentUser.id);
    loadUsers();
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

$('#zeroBalanceBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  if (!confirm('هل أنت متأكد من تصفير الرصيد؟')) return;
  
  const r = await api('/api/admin/user/balance', 'POST', {
    user_id: state.currentUser.id,
    amount: 0,
    action: 'zero'
  });
  
  if (r.ok) {
    toast('✅ تم تصفير الرصيد');
    viewUser(state.currentUser.id);
    loadUsers();
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

// Extend Subscription
$('#extendSubBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  const days = Number($('#subDays').value);
  if (!days || days <= 0) return toast('أدخل عدد الأيام');
  
  const r = await api('/api/admin/user/subscription', 'POST', {
    user_id: state.currentUser.id,
    days: days
  });
  
  if (r.ok) {
    toast('✅ تم تمديد الاشتراك');
    viewUser(state.currentUser.id);
    loadUsers();
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

// Add Trade
$('#addTradeBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  const pnl = Number($('#tradePnl').value);
  const hours = Number($('#tradeHours').value) || 1;
  
  if (pnl === undefined || pnl === null) return toast('أدخل الربح/الخسارة');
  
  const r = await api('/api/admin/user/trade', 'POST', {
    user_id: state.currentUser.id,
    target_pnl: pnl,
    duration_hours: hours
  });
  
  if (r.ok) {
    toast('✅ تم إضافة الصفقة');
    loadTrades();
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

// Clear History
$('#clearHistoryBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  if (!confirm('هل أنت متأكد من تصفير السجل؟')) return;
  
  const r = await api('/api/admin/user/clear-history', 'POST', {
    user_id: state.currentUser.id
  });
  
  if (r.ok) {
    toast('✅ تم تصفير السجل');
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

// Ban User
$('#banUserBtn')?.addEventListener('click', async () => {
  if (!state.currentUser) return;
  if (!confirm('هل أنت متأكد من حظر المستخدم؟')) return;
  
  const r = await api('/api/admin/user/ban', 'POST', {
    user_id: state.currentUser.id
  });
  
  if (r.ok) {
    toast('✅ تم حظر المستخدم');
    loadUsers();
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

// Load Withdrawals
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
        <div><span class="status-badge ${w.status === 'approved' ? 'enabled' : w.status === 'rejected' ? 'disabled' : ''}">${getStatusText(w.status)}</span></div>
        <div class="table-actions">
          ${w.status === 'pending' ? `
            <button class="mini-btn approve" onclick="approveWithdraw(${w.id})">قبول</button>
            <button class="mini-btn reject" onclick="rejectWithdraw(${w.id})">رفض</button>
          ` : '-'}
        </div>
      </div>
    `).join('')}
  `;
}

function getStatusText(status) {
  const map = {
    pending: '⏳ قيد الانتظار',
    approved: '✅ مقبول',
    rejected: '❌ مرفوض',
    cancelled: '🚫 ملغي'
  };
  return map[status] || status;
}

// Withdrawal filter buttons
$$('#tab-wd .filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('#tab-wd .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.withdrawFilter = btn.dataset.filter;
    loadWithdrawals();
  });
});

// Approve/Reject Withdrawal
window.approveWithdraw = async (id) => {
  const r = await api('/api/admin/withdraw/approve', 'POST', { request_id: id });
  if (r.ok) {
    toast('✅ تم قبول طلب السحب');
    loadWithdrawals();
    loadDashboard();
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
};

window.rejectWithdraw = async (id) => {
  const reason = prompt('سبب الرفض (اختياري):');
  const r = await api('/api/admin/withdraw/reject', 'POST', { request_id: id, reason });
  if (r.ok) {
    toast('✅ تم رفض طلب السحب');
    loadWithdrawals();
    loadDashboard();
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
};

// Load Trades
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
          ${t.status === 'open' ? `
            <button class="mini-btn reject" onclick="closeTrade(${t.id})">إغلاق</button>
          ` : '-'}
        </div>
      </div>
    `).join('')}
  `;
}

// Trade filter buttons
$$('#tab-tr .filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('#tab-tr .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.tradeFilter = btn.dataset.filter;
    loadTrades();
  });
});

// Close Trade
window.closeTrade = async (id) => {
  if (!confirm('هل أنت متأكد من إغلاق الصفقة؟')) return;
  
  const r = await api('/api/admin/trade/close', 'POST', { trade_id: id });
  if (r.ok) {
    toast('✅ تم إغلاق الصفقة');
    loadTrades();
    loadDashboard();
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
};

// Load Settings
async function loadSettings() {
  // Withdrawal status
  const wdStatus = await api('/api/admin/settings/withdrawal');
  if (wdStatus.ok) {
    const enabled = wdStatus.enabled !== false;
    $('#withdrawStatus').textContent = enabled ? '✅ مفعّل' : '❌ متوقف';
    $('#withdrawStatus').className = `status-badge ${enabled ? 'enabled' : 'disabled'}`;
  }
  
  // Maintenance status
  const mStatus = await api('/api/admin/settings/maintenance');
  if (mStatus.ok) {
    const enabled = mStatus.enabled === true;
    $('#maintenanceStatus').textContent = enabled ? '🛠️ مفعّل' : '✅ غير مفعّل';
    $('#maintenanceStatus').className = `status-badge ${enabled ? 'disabled' : 'enabled'}`;
  }
}

// Toggle Withdrawal
$('#toggleWithdraw')?.addEventListener('click', async () => {
  const r = await api('/api/admin/settings/withdrawal/toggle', 'POST');
  if (r.ok) {
    toast('✅ تم تغيير حالة السحب');
    loadSettings();
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

// Toggle Maintenance
$('#toggleMaintenance')?.addEventListener('click', async () => {
  const r = await api('/api/admin/settings/maintenance/toggle', 'POST');
  if (r.ok) {
    toast('✅ تم تغيير حالة الصيانة');
    loadSettings();
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

// Create Subscription Key
$('#createKeyBtn')?.addEventListener('click', async () => {
  const code = $('#newKeyCode').value.trim();
  const days = Number($('#newKeyDays').value) || 30;
  
  if (!code) return toast('أدخل كود المفتاح');
  
  const r = await api('/api/admin/key/create', 'POST', { code, days });
  if (r.ok) {
    toast('✅ تم إنشاء المفتاح');
    $('#newKeyCode').value = '';
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

// Broadcast Message
$('#broadcastBtn')?.addEventListener('click', async () => {
  const msg = $('#broadcastMsg').value.trim();
  if (!msg) return toast('أدخل نص الرسالة');
  
  if (!confirm('هل أنت متأكد من إرسال الرسالة للجميع؟')) return;
  
  const r = await api('/api/admin/broadcast', 'POST', { message: msg });
  if (r.ok) {
    toast('✅ تم إرسال الرسالة');
    $('#broadcastMsg').value = '';
  } else {
    toast('❌ ' + (r.error || 'خطأ'));
  }
});

// Auto refresh
setInterval(() => {
  if (state.token && !$('#panel').classList.contains('hidden')) {
    loadDashboard();
    loadWithdrawals();
    loadTrades();
  }
}, 30000);
