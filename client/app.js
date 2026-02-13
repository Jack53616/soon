// QL Trading AI v2.3 — Frontend logic (Enhanced with Target PnL & Real Prices)
const TWA = window.Telegram?.WebApp;
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
    closeTradeBtn: "Close Trade",
    tabInvite: "Invite",
    inviteTitle: "Invite Friends",
    inviteSub: "Share your link and earn rewards when your friends deposit!",
    yourInviteLink: "Your invite link:",
    copyLink: "Copy Link",
    share: "Share",
    rewards: "Rewards",
    totalEarnings: "Total Earnings",
    totalInvites: "Total Invites",
    rewardSystem: "Reward System",
    deposit500: "Deposit $500+",
    deposit1000: "Deposit $1,000+",
    youGet50: "+$50 for you",
    youGet100: "+$100 for you",
    yourReferrals: "Your Referrals",
    noReferralsYet: "No referrals yet. Share your link to get started!",
    waitingDeposit: "Waiting for deposit",
    copied: "Copied!"
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
    closeTradeBtn: "إغلاق الصفقة",
    tabInvite: "دعوة",
    inviteTitle: "ادعُ أصدقاءك",
    inviteSub: "شارك رابطك واكسب مكافآت عند إيداع أصدقائك!",
    yourInviteLink: "رابط الدعوة الخاص بك:",
    copyLink: "نسخ الرابط",
    share: "مشاركة",
    rewards: "المكافآت",
    totalEarnings: "إجمالي الأرباح",
    totalInvites: "عدد الدعوات",
    rewardSystem: "نظام المكافآت",
    deposit500: "إيداع $500+",
    deposit1000: "إيداع $1,000+",
    youGet50: "+$50 لك",
    youGet100: "+$100 لك",
    yourReferrals: "دعواتك",
    noReferralsYet: "لا توجد دعوات بعد. شارك رابطك لتبدأ!",
    waitingDeposit: "بانتظار الإيداع",
    copied: "تم النسخ!"
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
    closeTradeBtn: "İşlemi Kapat",
    tabInvite: "Davet",
    inviteTitle: "Arkadaşlarını Davet Et",
    inviteSub: "Bağlantını paylaş ve arkadaşların yatırım yaptığında ödül kazan!",
    yourInviteLink: "Davet bağlantınız:",
    copyLink: "Bağlantıyı Kopyala",
    share: "Paylaş",
    rewards: "Ödüller",
    totalEarnings: "Toplam Kazanç",
    totalInvites: "Toplam Davet",
    rewardSystem: "Ödül Sistemi",
    deposit500: "$500+ Yatırım",
    deposit1000: "$1,000+ Yatırım",
    youGet50: "Sana +$50",
    youGet100: "Sana +$100",
    yourReferrals: "Davetlerin",
    noReferralsYet: "Henüz davet yok. Bağlantını paylaşarak başla!",
    waitingDeposit: "Yatırım bekleniyor",
    copied: "Kopyalandı!"
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
    closeTradeBtn: "Trade schließen",
    tabInvite: "Einladen",
    inviteTitle: "Freunde einladen",
    inviteSub: "Teile deinen Link und verdiene Belohnungen, wenn deine Freunde einzahlen!",
    yourInviteLink: "Dein Einladungslink:",
    copyLink: "Link kopieren",
    share: "Teilen",
    rewards: "Belohnungen",
    totalEarnings: "Gesamteinnahmen",
    totalInvites: "Gesamteinladungen",
    rewardSystem: "Belohnungssystem",
    deposit500: "$500+ Einzahlung",
    deposit1000: "$1.000+ Einzahlung",
    youGet50: "+$50 für dich",
    youGet100: "+$100 für dich",
    yourReferrals: "Deine Einladungen",
    noReferralsYet: "Noch keine Einladungen. Teile deinen Link, um loszulegen!",
    waitingDeposit: "Warten auf Einzahlung",
    copied: "Kopiert!"
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

setTimeout(()=> { $("#splash")?.classList.add("hidden"); }, 1800);

// Check maintenance mode
async function checkMaintenance() {
  try {
    const r = await fetch("/api/settings/maintenance").then(r => r.json());
    if (r.ok && r.maintenance === true) {
      showMaintenanceScreen();
      return true;
    }
    hideMaintenanceScreen();
    return false;
  } catch (err) {
    console.log("Maintenance check failed:", err);
    return false;
  }
}

function showMaintenanceScreen() {
  const screen = $("#maintenanceScreen");
  if (screen) {
    screen.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
}

function hideMaintenanceScreen() {
  const screen = $("#maintenanceScreen");
  if (screen) {
    screen.classList.add("hidden");
    document.body.style.overflow = "";
  }
}

// Check maintenance on load
checkMaintenance();

// Periodic maintenance check
setInterval(checkMaintenance, 30000);

const cleanKeyInput = (value = "") => extractKeyCandidates(value)[0] || "";

function detectTG(){
  try{
    const initDataUnsafe = TWA?.initDataUnsafe;
    const tgId = initDataUnsafe?.user?.id || null;
    state.tg_id = tgId;
  }catch{ state.tg_id = null; }
}

async function getToken(){
  if(!state.tg_id) return;
  const r = await fetch("/api/token",{method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({tg_id: state.tg_id})}).then(r=>r.json());
  if(r.ok) state.token = r.token;
}

const gateBtn = $("#g-activate");
gateBtn?.addEventListener("click", async ()=>{
  if(gateBtn.disabled) return;
  const rawKey = $("#g-key").value || "";
  const candidates = extractKeyCandidates(rawKey);
  const key = candidates[0] || cleanKeyInput(rawKey);
  const name = $("#g-name").value.trim();
  const email = $("#g-email").value.trim();
  if(!key) return toast("Enter key");
  const tg_id = state.tg_id || Number(prompt("Enter Telegram ID (test):","1262317603"));
  if(!tg_id){ toast("Missing Telegram ID"); return; }
  const initData = TWA?.initData || null;
  const payload = { key, rawKey, candidates, tg_id, name, email, initData };

  const restore = gateBtn.textContent;
  gateBtn.disabled = true;
  gateBtn.textContent = "...";

  try{
    const r = await fetch("/api/activate",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    }).then(r=>r.json());
    if(!r?.ok){
      if(r?.error === 'banned'){
        showBanScreen(r?.ban_reason || 'مخالفة شروط الاستخدام');
        return;
      }
      toast(r?.error || "Invalid key");
      return;
    }
    state.user = r.user;
    localStorage.setItem("tg", r.user.tg_id);
    hydrateUser(r.user);
    unlockGate();
    $("#g-key").value = "";
    if(r.reused){ notify("🔓 Session restored"); }
    const opened = await openApp(r.user);
    localStorage.setItem("activated", "yes");

    document.body.classList.remove("is-gated");
    const gateEl = document.querySelector(".gate");
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

function toast(msg){ const el=$("#g-toast"); el.textContent=msg; setTimeout(()=> el.textContent="", 2500); }

function showGate(){
  if(state.feedTimer){ clearInterval(state.feedTimer); state.feedTimer = null; }
  if(state.refreshTimer){ clearInterval(state.refreshTimer); state.refreshTimer = null; }
  document.body.classList.add("is-gated");
  $(".gate")?.classList.remove("hidden");
  $("#app")?.classList.add("hidden");
}

function unlockGate(){
  document.body.classList.remove("is-gated");
  $(".gate")?.classList.add("hidden");
  $("#app")?.classList.remove("hidden");
}

async function openApp(user = null, { auto = false } = {}){
  if(user){
    state.user = user;
    hydrateUser(user);
  }
  if(!state.user?.tg_id){
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
  
  // Load trades FIRST and wait for it to complete
  await loadTrades();
  
  if(user){
    refreshUser();
  }
  startFeed();
  refreshOps();
  refreshRequests();
  refreshMarkets();
  startAutoRefresh();
  return true;
}

function startAutoRefresh(){
  if(state.refreshTimer) clearInterval(state.refreshTimer);
  
  // Initial load
  refreshUser();
  loadTrades();
  refreshOps();
  loadStats();
  
  state.refreshTimer = setInterval(async ()=>{
    try {
      await refreshUser();
      await loadTrades();
      await refreshOps();
      
      // Update stats every 10 seconds
      const now = Date.now();
      if (!state.lastStatsUpdate || now - state.lastStatsUpdate > 10000) {
        await loadStats();
        state.lastStatsUpdate = now;
      }
    } catch(err) {
      console.error('Auto refresh error:', err);
    }
  }, 3000);
}

$$(".seg-btn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    $$(".seg-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    $$(".tab").forEach(s=>s.classList.remove("show"));
    $(`#tab-${tab}`)?.classList.add("show");
    
    if(tab === "trades"){
      loadTrades();
    }
    if(tab === "stats"){
      loadStats();
    }
    if(tab === "invite"){
      loadReferralInfo();
    }
  });
});

$("#goWithdraw").onclick = ()=>{ document.querySelector('[data-tab="withdraw"]').click(); }
$("#goStats").onclick  = ()=>{ document.querySelector('[data-tab="stats"]').click(); }
$("#goSupport").onclick  = ()=>{ document.querySelector('[data-tab="support"]').click(); }

$("#btnLang").addEventListener("click", ()=>{
  const langSheet = document.createElement("div");
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
  
  langSheet.querySelector(".s-cancel").addEventListener("click", ()=>{
    langSheet.classList.remove("show");
    setTimeout(()=> langSheet.remove(), 300);
  });
});

const settingsPanel = $("#settingsPanel");
const settingsBackdrop = $("#settingsBackdrop");
const btnSettings = $("#btnSettings");
const spClose = $("#spClose");

function openSettings(){
  if(!settingsPanel) return;
  settingsPanel.classList.remove("hidden");
  settingsPanel.classList.add("show");
  settingsBackdrop?.classList.remove("hidden");
  settingsBackdrop?.classList.add("show");
}

function closeSettings(){
  settingsPanel?.classList.remove("show");
  settingsBackdrop?.classList.remove("show");
  setTimeout(()=>{
    settingsPanel?.classList.add("hidden");
    settingsBackdrop?.classList.add("hidden");
  },200);
}

btnSettings?.addEventListener("click", openSettings);
spClose?.addEventListener("click", closeSettings);
settingsBackdrop?.addEventListener("click", closeSettings);

const sheet = $("#sheet");
$("#pickMethod").addEventListener("click", ()=> sheet.classList.add("show"));
$("#sCancel").addEventListener("click", ()=> sheet.classList.remove("show"));
$$(".s-item").forEach(b=>{
  b.addEventListener("click", ()=>{
    state.method = b.dataset.method;
    $("#methodLabel").textContent = b.textContent;
    renderMethod();
    sheet.classList.remove("show");
  });
});

function renderMethod(){
  const map = {
    usdt_trc20: "USDT (TRC20)",
    usdt_erc20: "USDT (ERC20)",
    btc: "Bitcoin",
    eth: "Ethereum"
  };
  $("#methodLabel").textContent = map[state.method] || "USDT (TRC20)";
  
  // Update placeholder based on method
  const addrInput = $("#withdrawAddr");
  if(addrInput) {
    const placeholderText = state.lang === 'ar' ? `عنوان ${map[state.method]||'المحفظة'} الخاص بك...` : `Your ${map[state.method]||'Wallet'} address...`;
    addrInput.placeholder = placeholderText;
  }
}
renderMethod();

$("#reqWithdraw").addEventListener("click", async ()=>{
  const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
  const amount = Number($("#amount").value || 0);
  const address = $("#withdrawAddr")?.value?.trim() || '';
  
  // Validation
  if(!address) {
    return notify(state.lang === 'ar' ? "❌ أدخل عنوان المحفظة" : "❌ Enter wallet address");
  }
  
  // Validate wallet address length (26-64 characters for most crypto addresses)
  if(address.length < 26 || address.length > 64) {
    return notify(state.lang === 'ar' ? "❌ عنوان المحفظة غير صحيح (26-64 حرف)" : "❌ Invalid wallet address (26-64 characters)");
  }
  
  // Validate address format (alphanumeric only)
  if(!/^[a-zA-Z0-9]+$/.test(address)) {
    return notify(state.lang === 'ar' ? "❌ عنوان المحفظة يجب أن يحتوي على أحرف وأرقام فقط" : "❌ Address must contain only letters and numbers");
  }
  
  if(amount <= 0) {
    return notify(state.lang === 'ar' ? "❌ أدخل مبلغ صحيح" : "❌ Enter valid amount");
  }
  
  const userBalance = Number(state.user?.balance || 0);
  if(amount > userBalance) {
    return notify(state.lang === 'ar' ? "❌ الرصيد غير كافي" : "❌ Insufficient balance");
  }
  
  // Show loading state
  const btn = $("#reqWithdraw");
  const originalText = btn.textContent;
  btn.textContent = state.lang === 'ar' ? 'جاري الإرسال...' : 'Sending...';
  btn.disabled = true;
  
  try {
    const r = await fetch("/api/wallet/withdraw",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({tg_id:tg, amount, method: state.method, address})
    }).then(r=>r.json());
    
    if(!r.ok) {
      btn.textContent = originalText;
      btn.disabled = false;
      
      // Better error messages
      let errorMsg = r.error || "Error";
      if(errorMsg.includes("No saved address")) {
        errorMsg = state.lang === 'ar' ? 'احفظ عنوان المحفظة أولاً' : 'Save wallet address first';
      } else if(errorMsg.includes("Insufficient")) {
        errorMsg = state.lang === 'ar' ? 'الرصيد غير كافي' : 'Insufficient balance';
      } else if(errorMsg.includes("maintenance") || errorMsg.includes("صيانة")) {
        errorMsg = state.lang === 'ar' ? 'السحب متوقف مؤقتاً للصيانة' : 'Withdrawals paused for maintenance';
      }
      
      return notify("❌ " + errorMsg);
    }
    
    // Show success animation
    showWithdrawSuccess(amount);
    
    // Clear fields
    $("#amount").value = '';
    if($("#withdrawAddr")) $("#withdrawAddr").value = '';
    
    // Refresh data
    await refreshUser(); 
    await refreshRequests();
  } catch(err) {
    console.error('Withdraw error:', err);
    notify(state.lang === 'ar' ? '❌ خطأ في الاتصال' : '❌ Connection error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
});

// Withdraw success animation
function showWithdrawSuccess(amount) {
  const overlay = document.createElement('div');
  overlay.className = 'withdraw-success-overlay';
  overlay.innerHTML = `
    <div class="withdraw-success-content">
      <div class="withdraw-success-icon">
        <svg viewBox="0 0 24 24">
          <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="withdraw-success-title">${state.lang === 'ar' ? 'تم إرسال الطلب بنجاح!' : 'Request Sent!'}</div>
      <div class="withdraw-success-subtitle">${state.lang === 'ar' ? 'طلبك قيد المراجعة' : 'Your request is under review'}</div>
      <div class="withdraw-success-amount">$${amount.toFixed(2)}</div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // Auto close after 2.5 seconds
  setTimeout(() => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
  }, 2500);
  
  // Click to close
  overlay.onclick = () => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
  };
}

$("#whatsapp").onclick = ()=> window.open("https://wa.me/message/P6BBPSDL2CC4D1","_blank");

function hydrateUser(user){
  if(!user) return;
  const balance = Number(user.balance || 0);
  const wins = Number(user.wins || 0);
  const losses = Number(user.losses || 0);
  
  $("#balance").textContent = "$" + balance.toFixed(2);
  $("#subLeft").textContent = user.sub_expires ? new Date(user.sub_expires).toLocaleDateString() : "—";
  
  $("#pnlDay").textContent = "$" + wins.toFixed(2);
  $("#pnlMonth").textContent = "$" + (wins - losses).toFixed(2);

  const name = user.name || user.first_name || "";
  const email = user.email || "";
  const tgId = user.tg_id || user.id || "";
  const spTgId = $("#spTgId");
  const spName = $("#spName");
  const spEmail = $("#spEmail");
  if(spTgId) spTgId.textContent = tgId || "—";
  if(spName) spName.textContent = name || "—";
  if(spEmail) spEmail.textContent = email || "—";
}

// Update PnL ticker and chart based on open trades
function updatePnLDisplay(totalPnl) {
  const tickerEl = $("#ticker");
  const chartEl = $("#balanceChart");
  
  if(tickerEl) {
    const sign = totalPnl >= 0 ? "+" : "";
    tickerEl.textContent = sign + totalPnl.toFixed(2);
    tickerEl.style.color = totalPnl >= 0 ? "#00d68f" : "#ff3b63";
  }
  
  if(chartEl) {
    // Remove all state classes
    chartEl.classList.remove('profit', 'loss');
    
    // Add appropriate class based on PnL
    if(totalPnl > 0) {
      chartEl.classList.add('profit');
    } else if(totalPnl < 0) {
      chartEl.classList.add('loss');
    }
    // If totalPnl === 0, it stays neutral (no class)
  }
}

async function refreshUser(required = false){
  const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
  if(!tg){
    if(required) throw new Error("missing_tg");
    return false;
  }
  let payload = null;
  try{
    payload = await fetch(`/api/user/${tg}`).then(r=>r.json());
  }catch(err){
    if(required) throw err;
    return false;
  }
  
  // Check if user is banned
  if(payload?.error === 'banned' || payload?.banned === true){
    showBanScreen(payload.ban_reason || 'مخالفة شروط الاستخدام');
    return false;
  }
  
  if(payload?.ok){
    state.user = payload.user;
    hydrateUser(payload.user);
    return true;
  }
  if(required) throw new Error(payload?.error || "user_not_found");
  return false;
}

function showBanScreen(reason){
  const banScreen = $("#banScreen");
  const banReasonText = $("#banReasonText");
  if(banScreen){
    banScreen.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
  if(banReasonText && reason){
    banReasonText.textContent = reason;
  }
  // Hide everything else
  $("#app")?.classList.add("hidden");
  $(".gate")?.classList.add("hidden");
  $("#splash")?.classList.add("hidden");
}

async function refreshOps(){
  const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
  if(!tg) return;
  const r = await fetch(`/api/wallet/ops/${tg}`).then(r=>r.json());
  const box = $("#ops"); box.innerHTML = "";
  if(r.ok){
    r.list.forEach(o=>{
      const div = document.createElement("div");
      div.className="op";
      const amount = Number(o.amount);
      const color = amount >= 0 ? "#9df09d" : "#ff8899";
      div.innerHTML = `<span>${o.type||'op'}</span><b style="color:${color}">${amount >= 0 ? '+' : ''}$${amount.toFixed(2)}</b>`;
      box.appendChild(div);
    });
  }
}

async function refreshRequests(){
  const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
  if(!tg) return;
  const r = await fetch(`/api/wallet/requests/${tg}`).then(r=>r.json());
  const box = $("#reqList"); box.innerHTML = "";
  
  // Update stats counters
  let pending = 0, approved = 0, rejected = 0;
  
  if(r.ok && r.list.length > 0){
    r.list.forEach(req=>{
      // Count stats
      if(req.status === 'pending') pending++;
      else if(req.status === 'approved') approved++;
      else rejected++;
      
      const div = document.createElement("div");
      div.className="withdrawal-item";
      
      const statusText = {
        pending: state.lang === 'ar' ? 'قيد المراجعة' : 'Pending',
        approved: state.lang === 'ar' ? 'تم الدفع' : 'Paid',
        rejected: state.lang === 'ar' ? 'مرفوض' : 'Rejected',
        cancelled: state.lang === 'ar' ? 'ملغي' : 'Cancelled'
      };
      
      const methodNames = {
        usdt_trc20: 'USDT (TRC20)',
        usdt_erc20: 'USDT (ERC20)',
        btc: 'Bitcoin',
        eth: 'Ethereum'
      };
      
      const date = new Date(req.created_at).toLocaleDateString('ar-EG', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      
      div.innerHTML = `
        <div class="w-header">
          <span class="w-amount">$${Number(req.amount).toFixed(2)}</span>
          <span class="w-status ${req.status}">${statusText[req.status] || req.status}</span>
        </div>
        <div class="w-details">
          <span>#${req.id} • ${methodNames[req.method] || req.method}</span>
          <span>${date}</span>
        </div>
        ${req.status === 'pending' ? `
          <div class="w-actions">
            <button class="btn-cancel" data-id="${req.id}">
              ${state.lang === 'ar' ? '❌ إلغاء الطلب' : '❌ Cancel Request'}
            </button>
          </div>
        ` : ''}
      `;
      
      box.appendChild(div);
    });
    
    // Add cancel button handlers
    box.querySelectorAll('.btn-cancel').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const confirmMsg = state.lang === 'ar' ? 'هل تريد إلغاء هذا الطلب؟' : 'Cancel this request?';
        if(confirm(confirmMsg)){
          await fetch("/api/wallet/withdraw/cancel",{
            method:"POST", 
            headers:{"Content-Type":"application/json"}, 
            body:JSON.stringify({tg_id:tg, id: Number(id)})
          });
          notify(state.lang === 'ar' ? '✅ تم إلغاء الطلب' : '✅ Request cancelled');
          refreshRequests(); 
          refreshUser();
        }
      };
    });
  } else {
    const emptyText = state.lang === 'ar' ? 'لا توجد طلبات سحب' : 'No withdrawal requests';
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💳</div>
        <div class="empty-state-text">${emptyText}</div>
      </div>
    `;
  }
  
  // Update counters
  const pendingEl = $("#pendingCount");
  const approvedEl = $("#approvedCount");
  const rejectedEl = $("#rejectedCount");
  if(pendingEl) pendingEl.textContent = pending;
  if(approvedEl) approvedEl.textContent = approved;
  if(rejectedEl) rejectedEl.textContent = rejected;
}

async function loadStats(){
  const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
  if(!tg) return;
  
  try{
    const r = await fetch(`/api/stats/${tg}`).then(r=>r.json());
    if(r.ok){
      // Update stats
      const setVal = (id, val, isMoney=true) => {
        const el = $(id);
        if(el) {
          el.textContent = isMoney ? (val>=0?"+":"")+"$"+Math.abs(val).toFixed(2) : val;
          if(isMoney) el.style.color = val >= 0 ? "#9df09d" : "#ff8899";
        }
      };
      
      setVal("#statToday", r.daily.net);
      setVal("#statMonth", r.monthly.net);
      setVal("#statAll", r.allTime.net);
      setVal("#statCount", r.allTime.count, false);
      
      // Update history list
      const box = $("#historyList");
      box.innerHTML = "";
      
      if(r.history && r.history.length > 0){
        r.history.forEach(trade => {
          const div = document.createElement("div");
          div.className = "op";
          const pnl = Number(trade.pnl);
          const color = pnl >= 0 ? "#9df09d" : "#ff8899";
          const date = new Date(trade.closed_at).toLocaleDateString();
          
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
        const noHistoryText = state.lang === 'ar' ? 'لا يوجد سجل بعد' : 'No history yet';
        box.innerHTML = `<div class="op" style="justify-content:center; opacity:0.5">${noHistoryText}</div>`;
      }
    }
  }catch(err){
    console.error("Failed to load stats:", err);
  }
}

const names = ["أحمد","محمد","خالد","سارة","رامي","نور","ليلى","وسيم","حسن","طارق"];
function startFeed(){
  if(state.feedTimer) clearInterval(state.feedTimer);
  const feed = $("#feed");
  const push = (txt)=>{
    const it = document.createElement("div");
    it.className="item"; it.textContent = txt;
    feed.prepend(it);
    $("#sndNotify")?.play().catch(()=>{});
    while(feed.childElementCount>12) feed.lastChild.remove();
  };
  
  const once = ()=>{
    if(!isMarketOpen()){
      push(`📅 ${t('marketClosed')}`);
      return;
    }
    
    const r = Math.random();
    const name = names[Math.floor(Math.random()*names.length)];
    
    if(r < 0.25){
      // Withdrawal (25%)
      const v = 50+Math.floor(Math.random()*200);
      push(`🪙 ${name} سحب ${v}$ بنجاح`);
    } else if(r < 0.55){
      // Profit (30%)
      const v = 20+Math.floor(Math.random()*120);
      const m = ["Gold","BTC","ETH","Silver"][Math.floor(Math.random()*4)];
      push(`💰 ${name} ربح ${v}$ من صفقة ${m}`);
    } else if(r < 0.75){
      // Loss (20%) - NEW
      const v = 10+Math.floor(Math.random()*80);
      const m = ["Gold","BTC","ETH","Silver"][Math.floor(Math.random()*4)];
      push(`🔻 ${name} خسر ${v}$ في صفقة ${m}`);
    } else {
      // New Deposit (25%)
      const v = 150+Math.floor(Math.random()*400);
      push(`🎉 مستخدم جديد انضم وأودع ${v}$`);
    }
  };
  
  once();
  state.feedTimer = setInterval(once, 180000);
}

async function loadTrades(){
  const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
  if(!tg) return;
  
  try{
    const r = await fetch(`/api/trades/${tg}`).then(r=>r.json());
    const box = $("#tradesList");
    box.innerHTML = "";
    
    // Calculate total PnL from all open trades
    let totalPnl = 0;
    
    if(r.ok && r.trades && r.trades.length > 0){
      r.trades.forEach(trade=>{
        const div = document.createElement("div");
        div.className="op";
        
        const pnl = Number(trade.pnl || 0);
        totalPnl += pnl;
        
        const pnlColor = pnl >= 0 ? "#00d68f" : "#ff3b63";
        const pnlSign = pnl >= 0 ? "+" : "";
        
        const opened = new Date(trade.opened_at);
        const duration = trade.duration_seconds || 3600;
        const elapsed = Math.floor((Date.now() - opened.getTime()) / 1000);
        const remaining = Math.max(0, duration - elapsed);
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = remaining % 60;
        const timeStr = remaining > 0 ? `${hours}h ${minutes}m ${seconds}s` : (state.lang === 'ar' ? 'جاري الإغلاق...' : 'Closing...');
        
        const isMassTrade = trade.trade_type === 'mass';
        const tradeLabel = isMassTrade ? (state.lang === 'ar' ? '🤖 صفقة البوت' : '🤖 Bot Trade') : '';
        const progressPercent = Math.min(100, Math.round((elapsed / duration) * 100));
        
        // Progress bar color based on PnL
        const progressColor = pnl >= 0 ? '#00d68f' : '#ff3b63';
        
        div.innerHTML = `
          <div style="width:100%;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
              <div style="flex:1;">
                <div style="display:flex; align-items:center; gap:6px;">
                  <span>${trade.symbol} ${trade.direction} (${trade.lot_size})</span>
                  ${tradeLabel ? `<span style="font-size:10px; background:rgba(0,102,255,0.2); color:#3d8bff; padding:2px 6px; border-radius:10px;">${tradeLabel}</span>` : ''}
                </div>
                <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
                  <small style="opacity:0.6">⏱ ${timeStr}</small>
                  <small style="opacity:0.5;">💰 $${Number(trade.current_price || 0).toFixed(2)}</small>
                </div>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <div style="text-align:right;">
                  <b style="color:${pnlColor}; font-size:16px;">${pnlSign}$${Math.abs(pnl).toFixed(2)}</b>
                </div>
                ${!isMassTrade ? `<button class="btn-close-trade" data-trade-id="${trade.id}" data-trade-type="regular" style="padding:4px 8px; font-size:12px; background:#ff4444; color:white; border:none; border-radius:4px; cursor:pointer;">✕</button>` : ''}
              </div>
            </div>
            <!-- Progress bar -->
            <div style="width:100%; height:4px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden;">
              <div style="width:${progressPercent}%; height:100%; background:${progressColor}; border-radius:2px; transition:width 1s linear;"></div>
            </div>
          </div>
        `;
        box.appendChild(div);
      });
      
      // Add close trade handlers (only for regular trades, not mass trades)
      $$(".btn-close-trade").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          const tradeId = btn.dataset.tradeId;
          const tradeType = btn.dataset.tradeType;
          if (tradeType === 'mass') return; // Mass trades cannot be closed manually
          
          const confirmMsg = state.lang === 'ar' ? 'هل تريد إغلاق هذه الصفقة الآن؟' : 'Close this trade now?';
          if(confirm(confirmMsg)){
            try{
              const r = await fetch(`/api/trades/close/${tradeId}`, {method:"POST"}).then(r=>r.json());
              if(r.ok){
                const closedMsg = state.lang === 'ar' ? `✅ تم إغلاق الصفقة: ${r.pnl >= 0 ? '+' : ''}$${r.pnl.toFixed(2)}` : `✅ Trade closed: ${r.pnl >= 0 ? '+' : ''}$${r.pnl.toFixed(2)}`;
                notify(closedMsg);
                await refreshUser();
                await loadTrades();
                await refreshOps();
              }else{
                const errMsg = state.lang === 'ar' ? '❌ فشل إغلاق الصفقة' : '❌ Failed to close trade';
                notify(r.error || errMsg);
              }
            }catch(err){
              notify(state.lang === 'ar' ? '❌ خطأ في الاتصال' : '❌ Connection error');
            }
          }
        });
      });
      
      const tradeBadge = $("#tradeBadge");
      if(tradeBadge){
        const tradesText = state.lang === 'ar' ? `${r.trades.length} صفقة مفتوحة` : `${r.trades.length} open trade${r.trades.length > 1 ? 's' : ''}`;
        tradeBadge.textContent = tradesText;
      }
      
      // Update PnL display and chart color
      updatePnLDisplay(totalPnl);
      
    } else {
      const emptyDiv = document.createElement("div");
      emptyDiv.className="op";
      const noTradesText = state.lang === 'ar' ? 'لا توجد صفقات مفتوحة' : 'No open trades';
      emptyDiv.innerHTML = `<span style="opacity:0.5">${noTradesText}</span>`;
      box.appendChild(emptyDiv);
      
      const tradeBadge = $("#tradeBadge");
      if(tradeBadge){
        tradeBadge.textContent = t('noOpenTrade');
      }
      
      // No open trades, reset PnL display
      updatePnLDisplay(0);
    }
  }catch(err){
    console.error("Failed to load trades:", err);
    updatePnLDisplay(0);
  }
}

$("#saveSLTP").onclick = ()=>{
  notify(state.lang === 'ar' ? "✅ تم حفظ وقف الخسارة/جني الربح" : "✅ SL/TP saved");
};

function notify(msg){
  const el = document.createElement("div");
  el.className="feed item";
  el.textContent = msg;
  $("#feed").prepend(el);
  $("#sndNotify")?.play().catch(()=>{});
  setTimeout(()=>{ el.remove();}, 6000);
}

// Snow effect removed - using minimal design

// Real-time trades update
let tradesUpdateInterval = null;

function startRealtimeUpdates() {
  // Update trades every 3 seconds
  if (tradesUpdateInterval) clearInterval(tradesUpdateInterval);
  tradesUpdateInterval = setInterval(async () => {
    const activeTab = document.querySelector('.tab.show');
    if (activeTab && activeTab.id === 'tab-trades') {
      await loadTrades();
    }
    // Also refresh user balance periodically
    await refreshUser();
  }, 3000);
}

function stopRealtimeUpdates() {
  if (tradesUpdateInterval) {
    clearInterval(tradesUpdateInterval);
    tradesUpdateInterval = null;
  }
}

// Prevent zoom on double tap
document.addEventListener('touchstart', function(e) {
  if (e.touches.length > 1) {
    e.preventDefault();
  }
}, { passive: false });

let lastTouchEnd = 0;
document.addEventListener('touchend', function(e) {
  const now = Date.now();
  if (now - lastTouchEnd <= 300) {
    e.preventDefault();
  }
  lastTouchEnd = now;
}, { passive: false });

// ===== REFERRAL SYSTEM =====
async function loadReferralInfo() {
  const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
  if (!tg) return;
  try {
    const r = await fetch(`/api/referral/${tg}`).then(r => r.json());
    if (r.ok) {
      const botUsername = window.__BOT_USERNAME || 'QL_Trading_Bot';
      const refLink = `https://t.me/${botUsername}?start=ref_${r.referral_code}`;
      const refLinkEl = $("#referralLink");
      if (refLinkEl) refLinkEl.textContent = refLink;
      
      const refEarnings = $("#refEarnings");
      if (refEarnings) refEarnings.textContent = `$${Number(r.referral_earnings || 0).toFixed(0)}`;
      
      const refCount = $("#refCount");
      if (refCount) refCount.textContent = r.referrals?.length || 0;
      
      // Render referrals list
      const listEl = $("#referralsList");
      if (listEl && r.referrals && r.referrals.length > 0) {
        const locale = state.lang === 'ar' ? 'ar' : (state.lang === 'tr' ? 'tr' : (state.lang === 'de' ? 'de' : 'en'));
        listEl.innerHTML = r.referrals.map(ref => {
          const statusIcon = ref.status === 'credited' ? '✅' : '⏳';
          const statusText = ref.status === 'credited' ? `+$${ref.bonus_amount}` : t('waitingDeposit');
          const name = ref.referred_name || `User ${String(ref.referred_tg_id).slice(-4)}`;
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
            <div>
              <div style="font-size:13px;color:#eee;">👤 ${name}</div>
              <div style="font-size:11px;color:#666;">${new Date(ref.created_at).toLocaleDateString(locale)}</div>
            </div>
            <div style="font-size:12px;color:${ref.status === 'credited' ? '#00d68f' : '#f0ad4e'};font-weight:600;">${statusIcon} ${statusText}</div>
          </div>`;
        }).join('');
      } else if (listEl) {
        listEl.innerHTML = `<div style="text-align:center;padding:20px;color:#666;">${t('noReferralsYet')}</div>`;
      }
      
      // Store link for copy/share
      window.__refLink = refLink;
    }
  } catch (e) {
    console.error('Referral load error:', e);
  }
}

// Copy referral link
$("#copyRefLinkBtn")?.addEventListener("click", () => {
  const link = window.__refLink || $("#referralLink")?.textContent;
  if (link && link !== 'Loading...') {
    navigator.clipboard?.writeText(link).then(() => {
      const btn = $("#copyRefLinkBtn");
      const orig = btn.innerHTML;
      btn.innerHTML = `✅ ${t('copied')}`;
      btn.style.background = '#00b377';
      setTimeout(() => { btn.innerHTML = orig; btn.style.background = 'linear-gradient(135deg,#00d68f,#00b377)'; }, 2000);
    }).catch(() => {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      const btn = $("#copyRefLinkBtn");
      btn.innerHTML = `✅ ${t('copied')}`;
      setTimeout(() => { btn.innerHTML = `📋 <span>${t('copyLink')}</span>`; }, 2000);
    });
  }
});

// Share referral link
$("#shareRefLinkBtn")?.addEventListener("click", () => {
  const link = window.__refLink || $("#referralLink")?.textContent;
  if (link && link !== 'Loading...') {
    const shareTexts = {
      ar: '💰 انضم لمنصة QL Trading AI وابدأ التداول الذكي!',
      en: '💰 Join QL Trading AI and start smart trading!',
      tr: '💰 QL Trading AI\'ye katıl ve akıllı ticarete başla!',
      de: '💰 Tritt QL Trading AI bei und starte smartes Trading!'
    };
    const shareMsg = shareTexts[state.lang] || shareTexts.en;
    const shareText = `${shareMsg}\n\n🚀 ${link}`;
    if (TWA?.openTelegramLink) {
      TWA.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareMsg)}`);
    } else if (navigator.share) {
      navigator.share({ title: 'QL Trading AI', text: shareText }).catch(() => {});
    } else {
      window.open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareMsg)}`, '_blank');
    }
  }
});

(async function(){
  detectTG();

  if (localStorage.getItem("activated") === "yes") {
    document.body.classList.remove("is-gated");
    const g = document.querySelector(".gate");
    if(g){
        g.classList.add("hidden");
        g.style.pointerEvents = "none";
    }
    // Start real-time updates when logged in
    startRealtimeUpdates();
  }

  await getToken();
  applyI18n();

  const old = localStorage.getItem("tg");
  if(old){
    state.user = { tg_id: Number(old) };
    const opened = await openApp(null, { auto: true });
    if(!opened) {
      showGate();
    } else {
      startRealtimeUpdates();
    }
  }else{
    showGate();
  }
})();
