// QL Trading AI v2.3 — Frontend logic (Enhanced with Target PnL & Real Prices)
// ✅ Updated to use standardized API responses with { ok, data, error }
// ✅ Compatible with all browsers (no optional chaining issues)

const TWA = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
const INVISIBLE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;
const VALID_KEY_CHARS = /^[A-Za-z0-9._\-+=]+$/;
const KEY_FRAGMENT_RE = /[A-Za-z0-9][A-Za-z0-9._\-+=]{3,}[A-Za-z0-9=]?/g;
const BANNED_KEY_WORDS = new Set([
  "key", "code", "subscription", "subs", "sub", "token", "pass", "password",
  "link", "your", "this", "that", "here", "is", "for", "the", "my",
  "http", "https", "www", "click", "press", "bot", "created", "generated"
]);

const scoreToken = (token) => {
  const lower = token.toLowerCase();
  const length = token.length;
  const digitCount = (token.match(/\d/g) || []).length;
  const letterCount = (token.match(/[A-Za-z]/g) || []).length;

  let score = 0;
  if (digitCount) score += 6;
  if (/[-_]/.test(token)) score += 2;
  if (/[+=]/.test(token)) score += 1;
  if (digitCount && letterCount) score += 2;
  if (length >= 28) score += 6;
  else if (length >= 20) score += 5;
  else if (length >= 16) score += 4;
  else if (length >= 12) score += 3;
  else if (length >= 8) score += 2;
  else if (length >= 6) score += 1;

  const digitRatio = length ? digitCount / length : 0;
  if (digitRatio >= 0.5) score += 4;
  else if (digitRatio >= 0.35) score += 2;

  const upperCount = (token.match(/[A-Z]/g) || []).length;
  if (upperCount >= 4 && letterCount) score += 1;

  if (length > 32) score -= Math.min(length - 32, 12);
  if (length > 64) score -= Math.min(length - 64, 12);

  if (BANNED_KEY_WORDS.has(lower)) score -= 12;
  if (/^(key|code|token|pass)/.test(lower)) score -= 8;
  if (lower.includes("created") || lower.includes("generated")) score -= 6;
  if (lower.includes("http") || lower.includes("www") || lower.includes("tme")) score -= 15;
  if (lower.includes("telegram")) score -= 8;
  if (lower.includes("start=")) score -= 6;

  return score;
};

const sanitizeToken = (candidate = "") => {
  if (!candidate) return "";
  let token = candidate
    .replace(INVISIBLE_CHARS, "")
    .trim();
  if (!token) return "";
  token = token.replace(/^[^A-Za-z0-9]+/, "").replace(/[^A-Za-z0-9=]+$/, "");
  if (!token) return "";
  if (!VALID_KEY_CHARS.test(token)) {
    token = token.replace(/[^A-Za-z0-9._\-+=]+/g, "");
  }
  if (token.length < 4) return "";
  return token;
};

const sanitizedCollapsed = (text = "") => {
  if (!text) return "";
  const collapsed = text.replace(/[^A-Za-z0-9._\-+=]+/g, "");
  return collapsed.length >= 4 ? collapsed : "";
};

const extractKeyCandidates = (raw = "") => {
  if (!raw) return [];
  const normalized = raw.normalize("NFKC").replace(INVISIBLE_CHARS, " ").trim();
  if (!normalized) return [];
  const seen = new Map();
  const candidates = [];
  const sanitizedParts = [];

  const register = (token, boost = 0) => {
    const sanitized = sanitizeToken(token);
    if (!sanitized) return;
    const key = sanitized.toLowerCase();
    if (seen.has(key)) return;
    const score = scoreToken(sanitized) + boost;
    seen.set(key, score);
    candidates.push({ token: sanitized, score, idx: candidates.length });
  };

  const pushMatches = (text, boost = 0) => {
    if (!text) return;
    const matches = text.match(KEY_FRAGMENT_RE);
    if (matches) matches.forEach(match => register(match, boost));
  };

  pushMatches(normalized, 1);

  const startMatch = normalized.match(/start=([A-Za-z0-9._\-+=]+)/i);
  if (startMatch) register(startMatch[1], 6);

  normalized
    .split(/[\s|,;:/\\]+/)
    .map(part => part.trim())
    .filter(Boolean)
    .forEach(part => {
      const sanitizedPart = sanitizeToken(part);
      if (sanitizedPart) {
        sanitizedParts.push({
          value: sanitizedPart,
          hasDigits: /\d/.test(sanitizedPart),
          hasLetters: /[A-Za-z]/.test(sanitizedPart)
        });
      }
      const eqIndex = part.indexOf("=");
      if (eqIndex >= 0 && eqIndex < part.length - 1) {
        register(part.slice(eqIndex + 1), 5);
      }
      register(part);
      pushMatches(part);
    });

  for (let i = 0; i < sanitizedParts.length - 1; i++) {
    const first = sanitizedParts[i];
    const second = sanitizedParts[i + 1];
    const joined = first.value + second.value;
    if (joined.length >= 6 && (first.hasDigits || second.hasDigits)) {
      register(joined, first.hasDigits && second.hasDigits ? 6 : 5);
    }
  }

  for (let i = 0; i < sanitizedParts.length - 2; i++) {
    const a = sanitizedParts[i];
    const b = sanitizedParts[i + 1];
    const c = sanitizedParts[i + 2];
    const joined = a.value + b.value + c.value;
    if (joined.length >= 8 && (a.hasDigits || b.hasDigits || c.hasDigits)) {
      register(joined, 4);
    }
  }

  const collapsed = sanitizedCollapsed(normalized);
  if (collapsed) {
    const lowerCollapsed = collapsed.toLowerCase();
    const startsWithMeta = /^(key|code|token|pass)/.test(lowerCollapsed);
    register(collapsed, startsWithMeta ? -2 : 1);
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.token.length !== a.token.length) return b.token.length - a.token.length;
    return a.idx - b.idx;
  });

  return candidates.map(c => c.token);
};

const state = {
  tg_id: null,
  token: null,
  user: null,
  lang: localStorage.getItem("lang") || "en",
  feedTimer: null,
  refreshTimer: null,
  musicOn: false,
  method: "usdt_trc20",
  methodAddr: ""
};

document.body.classList.add("is-gated");

const i18n = {
  en: {
    gateTitle: "QL Trading — Access",
    gateSub: "Enter your subscription key to unlock your wallet",
    confirm: "Confirm",
    buyKey: "Buy a key",
    tabWallet: "Home",
    tabStats: "Statistics",
    performance: "Performance",
    today: "Today",
    thisMonth: "This Month",
    allTime: "All Time",
    totalTrades: "Total Trades",
    tradeHistory: "Trade History",
    stats: "Stats",
    tabTrades: "Trades",
    tabWithdraw: "Withdraw",
    tabRequests: "Requests",
    tabSupport: "Support",
    noOpenTrade: "No open trade",
    withdraw: "Withdraw",
    markets: "Markets",
    support: "Support",
    day: "Day",
    month: "Month",
    subLeft: "Subscription",
    recent: "Recent activity",
    recentSub: "Wallet history",
    live: "Live feed",
    liveSub: "QL Trading feed",
    withdrawCrypto: "Withdraw (crypto only)",
    request: "Request",
    savedAddr: "* Saved address will be used for the selected method.",
    deposit: "Deposit",
    yourRequests: "Your requests",
    supportCenter: "Support Center",
    chooseMethod: "Choose withdraw method",
    cancel: "Cancel",
    myTrades: "My trades",
    save: "Save",
    settingsTitle: "Account & Settings",
    profile: "Profile",
    id: "ID",
    name: "Name",
    email: "Email",
    broker: "Broker",
    xmLinked: "Linked",
    xmNote: "Your QL Wallet is connected with XM trading infrastructure.",
    selectLanguage: "Select Language",
    close: "Close",
    marketClosed: "Market Closed (Weekend)",
    closeTradeBtn: "Close Trade"
  },
  ar: {
    gateTitle: "QL Trading — دخول",
    gateSub: "أدخل مفتاح الاشتراك لفتح محفظتك",
    confirm: "تأكيد",
    buyKey: "شراء مفتاح",
    tabWallet: "الرئيسية",
    tabStats: "الإحصائيات",
    performance: "الأداء",
    today: "اليوم",
    thisMonth: "هذا الشهر",
    allTime: "كل الوقت",
    totalTrades: "إجمالي الصفقات",
    tradeHistory: "سجل الصفقات",
    stats: "إحصائيات",
    tabTrades: "صفقاتي",
    tabWithdraw: "السحب",
    tabRequests: "الطلبات",
    tabSupport: "الدعم",
    noOpenTrade: "لا توجد صفقة مفتوحة",
    withdraw: "سحب",
    markets: "الأسواق",
    support: "الدعم",
    day: "اليوم",
    month: "الشهر",
    subLeft: "الاشتراك",
    recent: "النشاط الأخير",
    recentSub: "سجل المحفظة",
    live: "بث مباشر",
    liveSub: "تحديثات QL Trading",
    withdrawCrypto: "سحب (عملات رقمية فقط)",
    request: "طلب",
    savedAddr: "* سيتم استخدام العنوان المحفوظ للطريقة المحددة.",
    deposit: "إيداع",
    yourRequests: "طلباتك",
    supportCenter: "مركز الدعم",
    chooseMethod: "اختر طريقة السحب",
    cancel: "إلغاء",
    myTrades: "صفقاتي",
    save: "حفظ",
    settingsTitle: "الحساب والإعدادات",
    profile: "الملف الشخصي",
    id: "المعرّف",
    name: "الاسم",
    email: "البريد الإلكتروني",
    broker: "شركة التداول",
    xmLinked: "مربوط",
    xmNote: "محفظة QL مربوطة ببنية التداول الخاصة بشركة XM.",
    selectLanguage: "اختر اللغة",
    close: "إغلاق",
    marketClosed: "السوق مغلق (عطلة نهاية الأسبوع)",
    closeTradeBtn: "إغلاق الصفقة"
  },
  tr: {
    gateTitle: "QL Trading — Giriş",
    gateSub: "Cüzdanınızı açmak için abonelik anahtarınızı girin",
    confirm: "Onayla",
    buyKey: "Anahtar satın al",
    tabWallet: "Ana sayfa",
    tabStats: "İstatistikler",
    performance: "Performans",
    today: "Bugün",
    thisMonth: "Bu Ay",
    allTime: "Tüm Zamanlar",
    totalTrades: "Toplam İşlem",
    tradeHistory: "İşlem Geçmişi",
    stats: "İstatistik",
    tabTrades: "İşlemlerim",
    tabWithdraw: "Çekim",
    tabRequests: "Talepler",
    tabSupport: "Destek",
    noOpenTrade: "Açık işlem yok",
    withdraw: "Çekim",
    markets: "Piyasalar",
    support: "Destek",
    day: "Gün",
    month: "Ay",
    subLeft: "Abonelik",
    recent: "Son aktiviteler",
    recentSub: "Cüzdan geçmişi",
    live: "Canlı akış",
    liveSub: "QL Trading akışı",
    withdrawCrypto: "Çekim (sadece kripto)",
    request: "Talep",
    savedAddr: "* Kayıtlı adres seçilen yöntem için kullanılacaktır.",
    deposit: "Yatırma",
    yourRequests: "Talepleriniz",
    supportCenter: "Destek merkezi",
    chooseMethod: "Çekim yöntemini seçin",
    cancel: "İptal",
    myTrades: "İşlemlerim",
    save: "Kaydet",
    settingsTitle: "Hesap ve ayarlar",
    profile: "Profil",
    id: "ID",
    name: "İsim",
    email: "E-posta",
    broker: "Aracı kurum",
    xmLinked: "Bağlı",
    xmNote: "QL cüzdanınız XM işlem altyapısına bağlıdır.",
    selectLanguage: "Dil Seçin",
    close: "Kapat",
    marketClosed: "Piyasa Kapalı (Hafta Sonu)",
    closeTradeBtn: "İşlemi Kapat"
  },
  de: {
    gateTitle: "QL Trading — Zugang",
    gateSub: "Gib deinen Aboschlüssel ein, um deine Wallet zu öffnen",
    confirm: "Bestätigen",
    buyKey: "Schlüssel kaufen",
    tabWallet: "Start",
    tabStats: "Statistik",
    performance: "Leistung",
    today: "Heute",
    thisMonth: "Diesen Monat",
    allTime: "Gesamtzeit",
    totalTrades: "Gesamt Trades",
    tradeHistory: "Handelsverlauf",
    stats: "Statistik",
    tabTrades: "Meine Trades",
    tabWithdraw: "Auszahlung",
    tabRequests: "Anfragen",
    tabSupport: "Support",
    noOpenTrade: "Kein offener Trade",
    withdraw: "Auszahlen",
    markets: "Märkte",
    support: "Support",
    day: "Tag",
    month: "Monat",
    subLeft: "Abo",
    recent: "Letzte Aktivitäten",
    recentSub: "Wallet-Verlauf",
    live: "Live-Feed",
    liveSub: "QL Trading Feed",
    withdrawCrypto: "Auszahlung (nur Krypto)",
    request: "Anfrage",
    savedAddr: "* Die gespeicherte Adresse wird für die gewählte Methode verwendet.",
    deposit: "Einzahlung",
    yourRequests: "Deine Anfragen",
    supportCenter: "Support-Center",
    chooseMethod: "Auszahlungsmethode wählen",
    cancel: "Abbrechen",
    myTrades: "Meine Trades",
    save: "Speichern",
    settingsTitle: "Konto & Einstellungen",
    profile: "Profil",
    id: "ID",
    name: "Name",
    email: "E-Mail",
    broker: "Broker",
    xmLinked: "Verbunden",
    xmNote: "Deine QL Wallet ist mit der XM-Trading-Infrastruktur verbunden.",
    selectLanguage: "Sprache wählen",
    close: "Schließen",
    marketClosed: "Markt geschlossen (Wochenende)",
    closeTradeBtn: "Trade schließen"
  }
};

function t(key){
  const lang = state.lang;
  return (i18n[lang] && i18n[lang][key]) || (i18n.en[key]||key);
}

function applyI18n(){
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    el.textContent = t(el.dataset.i18n);
  });
  document.body.dir = (state.lang === "ar") ? "rtl" : "ltr";
}

function isMarketOpen(){
  const now = new Date();
  const day = now.getDay();
  return day !== 0 && day !== 6;
}

const $ = (q)=>document.querySelector(q);
const $$ = (q)=>document.querySelectorAll(q);

setTimeout(()=> { 
  var splash = $("#splash");
  if(splash) splash.classList.add("hidden"); 
}, 1800);

const cleanKeyInput = (value = "") => extractKeyCandidates(value)[0] || "";

function detectTG(){
  try{
    var initDataUnsafe = TWA && TWA.initDataUnsafe ? TWA.initDataUnsafe : null;
    var tgId = initDataUnsafe && initDataUnsafe.user ? initDataUnsafe.user.id : null;
    state.tg_id = tgId;
  }catch(e){ 
    state.tg_id = null; 
  }
}

// ✅ UPDATED: استخدام data wrapper
async function getToken(){
  if(!state.tg_id) return;
  var r = await fetch("/api/token",{
    method:"POST", 
    headers:{"Content-Type":"application/json"}, 
    body:JSON.stringify({tg_id: state.tg_id})
  }).then(r=>r.json());
  
  if(r.ok && r.data && r.data.token) {
    state.token = r.data.token;
  }
}

var gateBtn = $("#g-activate");
if(gateBtn) {
  gateBtn.addEventListener("click", async ()=>{
    if(gateBtn.disabled) return;
    
    var gKeyEl = $("#g-key");
    var gNameEl = $("#g-name");
    var gEmailEl = $("#g-email");
    
    var rawKey = gKeyEl ? (gKeyEl.value || "") : "";
    var candidates = extractKeyCandidates(rawKey);
    var key = candidates[0] || cleanKeyInput(rawKey);
    var name = gNameEl ? gNameEl.value.trim() : "";
    var email = gEmailEl ? gEmailEl.value.trim() : "";
    
    if(!key) return toast("Enter key");
    
    var tg_id = state.tg_id || Number(prompt("Enter Telegram ID (test):","1262317603"));
    if(!tg_id){ toast("Missing Telegram ID"); return; }
    
    var initData = TWA && TWA.initData ? TWA.initData : null;
    var payload = { key: key, rawKey: rawKey, candidates: candidates, tg_id: tg_id, name: name, email: email, initData: initData };

    var restore = gateBtn.textContent;
    gateBtn.disabled = true;
    gateBtn.textContent = "...";

    try{
      var r = await fetch("/api/activate",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload)
      }).then(r=>r.json());
      
      if(!r || !r.ok){
        toast(r && r.error ? r.error : "Invalid key");
        return;
      }
      
      // ✅ UPDATED: استخدام r.data بدلاً من الوصول المباشر
      if(!r.data || !r.data.user) {
        toast("Invalid response from server");
        return;
      }
      
      state.user = r.data.user;
      localStorage.setItem("tg", r.data.user.tg_id);
      hydrateUser(r.data.user);
      unlockGate();
      
      if(gKeyEl) gKeyEl.value = "";
      
      if(r.data.reused){ 
        notify("🔓 Session restored"); 
      }
      
      var opened = await openApp(r.data.user);
      localStorage.setItem("activated", "yes");

      document.body.classList.remove("is-gated");
      var gateEl = document.querySelector(".gate");
      if(gateEl){
          gateEl.classList.add("hidden");
          gateEl.style.pointerEvents = "none";
      }

      if(!opened){
        showGate();
        toast("Unable to open wallet");
      }
    }catch(err){
      console.error("Activation failed", err);
      toast("Connection error");
    }finally{
      gateBtn.disabled = false;
      gateBtn.textContent = restore;
    }
  });
}

function toast(msg){ 
  var el = $("#g-toast");
  if(el) {
    el.textContent = msg; 
    setTimeout(()=> el.textContent="", 2500); 
  }
}

function showGate(){
  if(state.feedTimer){ clearInterval(state.feedTimer); state.feedTimer = null; }
  if(state.refreshTimer){ clearInterval(state.refreshTimer); state.refreshTimer = null; }
  document.body.classList.add("is-gated");
  var gateEl = $(".gate");
  if(gateEl) gateEl.classList.remove("hidden");
  var appEl = $("#app");
  if(appEl) appEl.classList.add("hidden");
}

function unlockGate(){
  document.body.classList.remove("is-gated");
  var gateEl = $(".gate");
  if(gateEl) gateEl.classList.add("hidden");
  var appEl = $("#app");
  if(appEl) appEl.classList.remove("hidden");
}

async function openApp(user = null, opts = {}){
  var auto = opts.auto || false;
  
  if(user){
    state.user = user;
    hydrateUser(user);
  }
  
  if(!state.user || !state.user.tg_id){
    if(!auto) toast("Please sign in again");
    showGate();
    return false;
  }
  
  if(!user){
    try{
      await refreshUser(true);
    }catch(err){
      console.warn("Failed to refresh session", err);
      state.user = null;
      localStorage.removeItem("tg");
      showGate();
      return false;
    }
  }
  
  unlockGate();
  applyI18n();
  
  if(user){
    refreshUser();
  }
  
  startFeed();
  refreshOps();
  refreshRequests();
  loadTrades();
  startAutoRefresh();
  
  return true;
}

function startAutoRefresh(){
  if(state.refreshTimer) clearInterval(state.refreshTimer);
  
  state.refreshTimer = setInterval(async ()=>{
    await refreshUser();
    await loadTrades();
    await refreshOps();
  }, 3000);
}

$$.call(document, ".seg-btn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    $$.call(document, ".seg-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    var tab = btn.dataset.tab;
    $$.call(document, ".tab").forEach(s=>s.classList.remove("show"));
    var tabEl = $(`#tab-${tab}`);
    if(tabEl) tabEl.classList.add("show");
    
    if(tab === "trades"){
      loadTrades();
    }
    if(tab === "stats"){
      loadStats();
    }
  });
});

var goWithdrawBtn = $("#goWithdraw");
if(goWithdrawBtn) {
  goWithdrawBtn.onclick = ()=>{ 
    var btn = document.querySelector('[data-tab="withdraw"]');
    if(btn) btn.click(); 
  };
}

var goStatsBtn = $("#goStats");
if(goStatsBtn) {
  goStatsBtn.onclick = ()=>{ 
    var btn = document.querySelector('[data-tab="stats"]');
    if(btn) btn.click(); 
  };
}

var goSupportBtn = $("#goSupport");
if(goSupportBtn) {
  goSupportBtn.onclick = ()=>{ 
    var btn = document.querySelector('[data-tab="support"]');
    if(btn) btn.click(); 
  };
}

var btnLang = $("#btnLang");
if(btnLang) {
  btnLang.addEventListener("click", ()=>{
    var langSheet = document.createElement("div");
    langSheet.className = "sheet show";
    langSheet.innerHTML = `
      <div class="handle"></div>
      <div class="s-title">${t('selectLanguage')}</div>
      <button class="s-item" data-lang="en">🇬🇧 English</button>
      <button class="s-item" data-lang="ar">🇸🇦 العربية</button>
      <button class="s-item" data-lang="tr">🇹🇷 Türkçe</button>
      <button class="s-item" data-lang="de">🇩🇪 Deutsch</button>
      <button class="s-cancel">${t('cancel')}</button>
    `;
    
    document.body.appendChild(langSheet);
    
    langSheet.querySelectorAll(".s-item").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        state.lang = btn.dataset.lang;
        localStorage.setItem("lang", state.lang);
        applyI18n();
        langSheet.classList.remove("show");
        setTimeout(()=> langSheet.remove(), 300);
      });
    });
    
    var cancelBtn = langSheet.querySelector(".s-cancel");
    if(cancelBtn) {
      cancelBtn.addEventListener("click", ()=>{
        langSheet.classList.remove("show");
        setTimeout(()=> langSheet.remove(), 300);
      });
    }
  });
}

var settingsPanel = $("#settingsPanel");
var settingsBackdrop = $("#settingsBackdrop");
var btnSettings = $("#btnSettings");
var spClose = $("#spClose");

function openSettings(){
  if(!settingsPanel) return;
  settingsPanel.classList.remove("hidden");
  settingsPanel.classList.add("show");
  if(settingsBackdrop) {
    settingsBackdrop.classList.remove("hidden");
    settingsBackdrop.classList.add("show");
  }
}

function closeSettings(){
  if(settingsPanel) settingsPanel.classList.remove("show");
  if(settingsBackdrop) settingsBackdrop.classList.remove("show");
  setTimeout(()=>{
    if(settingsPanel) settingsPanel.classList.add("hidden");
    if(settingsBackdrop) settingsBackdrop.classList.add("hidden");
  },200);
}

if(btnSettings) btnSettings.addEventListener("click", openSettings);
if(spClose) spClose.addEventListener("click", closeSettings);
if(settingsBackdrop) settingsBackdrop.addEventListener("click", closeSettings);

var sheet = $("#sheet");
var pickMethodBtn = $("#pickMethod");
if(pickMethodBtn && sheet) {
  pickMethodBtn.addEventListener("click", ()=> sheet.classList.add("show"));
}

var sCancelBtn = $("#sCancel");
if(sCancelBtn && sheet) {
  sCancelBtn.addEventListener("click", ()=> sheet.classList.remove("show"));
}

$$.call(document, ".s-item").forEach(b=>{
  b.addEventListener("click", ()=>{
    state.method = b.dataset.method;
    var methodLabel = $("#methodLabel");
    if(methodLabel) methodLabel.textContent = b.textContent;
    renderMethod();
    if(sheet) sheet.classList.remove("show");
  });
});

function renderMethod(){
  var map = {
    usdt_trc20: "USDT (TRC20)",
    usdt_erc20: "USDT (ERC20)",
    btc: "Bitcoin",
    eth: "Ethereum"
  };
  
  var methodLabel = $("#methodLabel");
  if(methodLabel) {
    methodLabel.textContent = map[state.method] || "USDT (TRC20)";
  }
  
  var methodView = $("#methodView");
  if(methodView) {
    methodView.innerHTML = `
      <div class="muted">Saved address:</div>
      <input id="addr" class="input" placeholder="Your ${map[state.method]||'Wallet'} address..."/>
      <button id="saveAddr" class="btn">Save</button>
    `;
    
    var saveAddrBtn = $("#saveAddr");
    if(saveAddrBtn) {
      saveAddrBtn.onclick = async ()=>{
        var addrEl = $("#addr");
        var address = addrEl ? addrEl.value.trim() : "";
        var tg = state.user && state.user.tg_id ? state.user.tg_id : Number(localStorage.getItem("tg"));
        await fetch("/api/withdraw/method",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({tg_id:tg, method:state.method, address:address})
        });
        notify("✅ Address saved");
      };
    }
  }
}
renderMethod();

var reqWithdrawBtn = $("#reqWithdraw");
if(reqWithdrawBtn) {
  reqWithdrawBtn.addEventListener("click", async ()=>{
    var tg = state.user && state.user.tg_id ? state.user.tg_id : Number(localStorage.getItem("tg"));
    var amountInput = $("#amount");
    var amount = amountInput ? Number(amountInput.value || 0) : 0;
    
    if(amount<=0) return notify("Enter amount");
    
    var r = await fetch("/api/withdraw",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({tg_id:tg, amount:amount, method: state.method})
    }).then(r=>r.json());
    
    if(!r.ok) return notify("❌ "+(r.error||"Error"));
    
    notify("✅ Request sent");
    refreshUser(); 
    refreshRequests();
  });
}

var whatsappBtn = $("#whatsapp");
if(whatsappBtn) {
  whatsappBtn.onclick = ()=> {
    window.open("https://wa.me/message/P6BBPSDL2CC4D1","_blank");
  };
}

function hydrateUser(user){
  if(!user) return;
  
  var balance = Number(user.balance || 0);
  var wins = Number(user.wins || 0);
  var losses = Number(user.losses || 0);
  
  var balanceEl = $("#balance");
  if(balanceEl) {
    balanceEl.textContent = "$" + balance.toFixed(2);
  }
  
  var subLeftEl = $("#subLeft");
  if(subLeftEl) {
    subLeftEl.textContent = user.sub_expires 
      ? new Date(user.sub_expires).toLocaleDateString() 
      : "—";
  }
  
  var pnlDayEl = $("#pnlDay");
  if(pnlDayEl) {
    pnlDayEl.textContent = "$" + wins.toFixed(2);
  }
  
  var pnlMonthEl = $("#pnlMonth");
  if(pnlMonthEl) {
    pnlMonthEl.textContent = "$" + (wins - losses).toFixed(2);
  }

  var tickerEl = $("#ticker");
  if(tickerEl){
    tickerEl.textContent = "+0.00";
    tickerEl.style.color = "#9df09d";
  }

  var name = user.name || user.first_name || "";
  var email = user.email || "";
  var tgId = user.tg_id || user.id || "";
  
  var spTgId = $("#spTgId");
  var spName = $("#spName");
  var spEmail = $("#spEmail");
  
  if(spTgId) spTgId.textContent = tgId || "—";
  if(spName) spName.textContent = name || "—";
  if(spEmail) spEmail.textContent = email || "—";
}

// ✅ UPDATED: استخدام payload.data.user
async function refreshUser(required = false){
  var tg = state.user && state.user.tg_id ? state.user.tg_id : Number(localStorage.getItem("tg"));
  
  if(!tg){
    if(required) throw new Error("missing_tg");
    return false;
  }
  
  var payload = null;
  
  try{
    payload = await fetch(`/api/user/${tg}`).then(r=>r.json());
  }catch(err){
    if(required) throw err;
    return false;
  }
  
  if(payload && payload.ok && payload.data && payload.data.user){
    state.user = payload.data.user;
    hydrateUser(payload.data.user);
    return true;
  }
  
  if(required) throw new Error(payload && payload.error ? payload.error : "user_not_found");
  return false;
}

// ✅ UPDATED: استخدام r.data.list
async function refreshOps(){
  var tg = state.user && state.user.tg_id ? state.user.tg_id : Number(localStorage.getItem("tg"));
  if(!tg) return;
  
  var r = await fetch(`/api/ops/${tg}`).then(r=>r.json());
  var box = $("#ops"); 
  
  if(!box) return;
  
  box.innerHTML = "";
  
  if(r.ok && r.data && r.data.list){
    r.data.list.forEach(o=>{
      var div = document.createElement("div");
      div.className="op";
      var amount = Number(o.amount);
      var color = amount >= 0 ? "#9df09d" : "#ff8899";
      div.innerHTML = `<span>${o.type||'op'}</span><b style="color:${color}">${amount >= 0 ? '+' : ''}$${amount.toFixed(2)}</b>`;
      box.appendChild(div);
    });
  }
}

// ✅ UPDATED: استخدام r.data.list
async function refreshRequests(){
  var tg = state.user && state.user.tg_id ? state.user.tg_id : Number(localStorage.getItem("tg"));
  if(!tg) return;
  
  var r = await fetch(`/api/requests/${tg}`).then(r=>r.json());
  var box = $("#reqList"); 
  
  if(!box) return;
  
  box.innerHTML = "";
  
  if(r.ok && r.data && r.data.list){
    r.data.list.forEach(req=>{
      var div = document.createElement("div");
      div.className="op";
      div.innerHTML = `<span>#${req.id} — ${req.method} — ${req.status}</span><b>$${Number(req.amount).toFixed(2)}</b>`;
      
      if(req.status==="pending"){
        var b = document.createElement("button");
        b.className="btn"; 
        b.style.marginLeft="8px"; 
        b.textContent="Cancel";
        b.onclick = async ()=>{
          var tg = state.user && state.user.tg_id ? state.user.tg_id : Number(localStorage.getItem("tg"));
          await fetch("/api/withdraw/cancel",{
            method:"POST", 
            headers:{"Content-Type":"application/json"}, 
            body:JSON.stringify({tg_id:tg, id:req.id})
          });
          refreshRequests(); 
          refreshUser();
        };
        div.appendChild(b);
      }
      box.appendChild(div);
    });
  }
}

// ✅ UPDATED: استخدام r.data بدلاً من الوصول المباشر
async function loadStats(){
  var tg = state.user && state.user.tg_id ? state.user.tg_id : Number(localStorage.getItem("tg"));
  if(!tg) return;
  
  try{
    var r = await fetch(`/api/stats/${tg}`).then(r=>r.json());
    
    if(r.ok && r.data){
      var setVal = function(id, val, isMoney){
        if(isMoney === undefined) isMoney = true;
        var el = $(id);
        if(el) {
          el.textContent = isMoney 
            ? (val>=0?"+":"")+"$"+Math.abs(val).toFixed(2) 
            : val;
          if(isMoney) el.style.color = val >= 0 ? "#9df09d" : "#ff8899";
        }
      };
      
      // ✅ استخدام r.data.daily بدلاً من r.daily
      setVal("#statToday", r.data.daily && r.data.daily.net ? r.data.daily.net : 0);
      setVal("#statMonth", r.data.monthly && r.data.monthly.net ? r.data.monthly.net : 0);
      setVal("#statAll", r.data.allTime && r.data.allTime.net ? r.data.allTime.net : 0);
      setVal("#statCount", r.data.allTime && r.data.allTime.count ? r.data.allTime.count : 0, false);
      
      var box = $("#historyList");
      if(box) {
        box.innerHTML = "";
        
        // ✅ استخدام r.data.history بدلاً من r.history
        if(r.data.history && r.data.history.length > 0){
          r.data.history.forEach(trade => {
            var div = document.createElement("div");
            div.className = "op";
            var pnl = Number(trade.pnl);
            var color = pnl >= 0 ? "#9df09d" : "#ff8899";
            var date = new Date(trade.closed_at).toLocaleDateString();
            
            div.innerHTML = `
              <div style="display:flex; justify-content:space-between; width:100%">
                <div>
                  <span>${trade.symbol} ${trade.direction}</span>
                  <small>${date} • ${trade.close_reason}</small>
                </div>
                <b style="color:${color}">${pnl>=0?'+':''}$${Math.abs(pnl).toFixed(2)}</b>
              </div>
            `;
            box.appendChild(div);
          });
        } else {
          box.innerHTML = `<div class="op" style="justify-content:center; opacity:0.5">No history yet</div>`;
        }
      }
    }
  }catch(err){
    console.error("Failed to load stats:", err);
  }
}

var names = ["أحمد","محمد","خالد","سارة","رامي","نور","ليلى","وسيم","حسن","طارق"];

function startFeed(){
  if(state.feedTimer) clearInterval(state.feedTimer);
  
  var feed = $("#feed");
  if(!feed) return;
  
  var push = function(txt){
    var it = document.createElement("div");
    it.className="item"; 
    it.textContent = txt;
    feed.prepend(it);
    var sndNotify = $("#sndNotify");
    if(sndNotify) {
      sndNotify.play().catch(()=>{});
    }
    while(feed.childElementCount>12) feed.lastChild.remove();
  };
  
  var once = function(){
    if(!isMarketOpen()){
      push(`📅 ${t('marketClosed')}`);
      return;
    }
    
    var r = Math.random();
    var name = names[Math.floor(Math.random()*names.length)];
    
    if(r < 0.25){
      var v = 50+Math.floor(Math.random()*200);
      push(`🪙 ${name} سحب ${v}$ بنجاح`);
    } else if(r < 0.55){
      var v = 20+Math.floor(Math.random()*120);
      var m = ["Gold","BTC","ETH","Silver"][Math.floor(Math.random()*4)];
      push(`💰 ${name} ربح ${v}$ من صفقة ${m}`);
    } else if(r < 0.75){
      var v = 10+Math.floor(Math.random()*80);
      var m = ["Gold","BTC","ETH","Silver"][Math.floor(Math.random()*4)];
      push(`🔻 ${name} خسر ${v}$ في صفقة ${m}`);
    } else {
      var v = 150+Math.floor(Math.random()*400);
      push(`🎉 مستخدم جديد انضم وأودع ${v}$`);
    }
  };
  
  once();
  state.feedTimer = setInterval(once, 180000);
}

// ✅ UPDATED: استخدام r.data.trades بدلاً من r.trades
async function loadTrades(){
  var tg = state.user && state.user.tg_id ? state.user.tg_id : Number(localStorage.getItem("tg"));
  if(!tg) return;
  
  try{
    var r = await fetch(`/api/trades/${tg}`).then(r=>r.json());
    var box = $("#tradesList");
    
    if(!box) return;
    
    box.innerHTML = "";
    
    // ✅ استخدام r.data.trades
    if(r.ok && r.data && r.data.trades && r.data.trades.length > 0){
      r.data.trades.forEach(trade=>{
        var div = document.createElement("div");
        div.className="op";
        
        var pnl = Number(trade.pnl || 0);
        var target = Number(trade.target_pnl || 0);
        var pnlColor = pnl >= 0 ? "#9df09d" : "#ff8899";
        var pnlSign = pnl >= 0 ? "+" : "";
        
        var opened = new Date(trade.opened_at);
        var duration = trade.duration_seconds || 3600;
        var elapsed = Math.floor((Date.now() - opened.getTime()) / 1000);
        var remaining = Math.max(0, duration - elapsed);
        var hours = Math.floor(remaining / 3600);
        var minutes = Math.floor((remaining % 3600) / 60);
        var timeStr = `${hours}h ${minutes}m`;
        
        div.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; width:100%; gap:8px;">
            <div style="flex:1;">
              <div>${trade.symbol} ${trade.direction} (${trade.lot_size})</div>
              <small style="opacity:0.6">⏱ ${timeStr}</small>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <b style="color:${pnlColor}">${pnlSign}$${pnl.toFixed(2)}</b>
              <button class="btn-close-trade" data-trade-id="${trade.id}" style="padding:4px 8px; font-size:12px; background:#ff4444; color:white; border:none; border-radius:4px; cursor:pointer;">✕</button>
            </div>
          </div>
        `;
        box.appendChild(div);
      });
      
      // Add close trade handlers
      $$.call(document, ".btn-close-trade").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          var tradeId = btn.dataset.tradeId;
          if(confirm("Close this trade now?")){
            try{
              var closeRes = await fetch(`/api/trades/close/${tradeId}`, {
                method:"POST"
              }).then(r=>r.json());
              
              // ✅ استخدام closeRes.data.pnl بدلاً من closeRes.pnl
              if(closeRes.ok && closeRes.data && closeRes.data.pnl !== undefined){
                var closedPnl = closeRes.data.pnl || 0;
                notify(`✅ Trade closed: ${closedPnl >= 0 ? '+' : ''}$${closedPnl.toFixed(2)}`);
                await refreshUser();
                await loadTrades();
                await refreshOps();
              }else{
                notify("❌ " + (closeRes.error || "Failed to close trade"));
              }
            }catch(err){
              notify("❌ Connection error");
            }
          }
        });
      });
      
      var tradeBadge = $("#tradeBadge");
      if(tradeBadge){
        tradeBadge.textContent = `${r.data.trades.length} open trade${r.data.trades.length > 1 ? 's' : ''}`;
      }
    } else {
      var emptyDiv = document.createElement("div");
      emptyDiv.className="op";
      emptyDiv.innerHTML = `<span style="opacity:0.5">No open trades</span>`;
      box.appendChild(emptyDiv);
      
      var tradeBadge = $("#tradeBadge");
      if(tradeBadge){
        tradeBadge.textContent = t('noOpenTrade');
      }
    }
  }catch(err){
    console.error("Failed to load trades:", err);
  }
}

var saveSLTPBtn = $("#saveSLTP");
if(saveSLTPBtn) {
  saveSLTPBtn.onclick = ()=>{
    notify("✅ SL/TP saved");
  };
}

function notify(msg){
  var feed = $("#feed");
  if(!feed) return;
  
  var el = document.createElement("div");
  el.className="feed item";
  el.textContent = msg;
  feed.prepend(el);
  var sndNotify = $("#sndNotify");
  if(sndNotify) {
    sndNotify.play().catch(()=>{});
  }
  setTimeout(()=>{ el.remove();}, 6000);
}

// ✅ App initialization
(async function(){
  detectTG();

  if (localStorage.getItem("activated") === "yes") {
    document.body.classList.remove("is-gated");
    var g = document.querySelector(".gate");
    if(g){
        g.classList.add("hidden");
        g.style.pointerEvents = "none";
    }
  }

  await getToken();
  applyI18n();

  var old = localStorage.getItem("tg");
  if(old){
    state.user = { tg_id: Number(old) };
    var opened = await openApp(null, { auto: true });
    if(!opened) showGate();
  }else{
    showGate();
  }
})();
