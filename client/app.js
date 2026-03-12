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
    tradeCommission: "Trade Commission",
    daysOnPlatform: "Days on Platform",
    rewardSystem: "Reward System",
    deposit500: "Deposit $500+",
    deposit1000: "Deposit $1,000+",
    youGet50: "+$50 for you",
    youGet100: "+$100 for you",
    yourReferrals: "Your Referrals",
    noReferralsYet: "No referrals yet. Share your link to get started!",
    waitingDeposit: "Waiting for deposit",
    copied: "Copied!",
    accountStatus: "Account Status",
    rank: "Rank",
    statusLabel: "Status",
    active: "Active",
    tradeProfit: "Referral trade profit",
    youGet5pct: "+5% commission",
    pendingReview: "Under Review",
    paid: "Paid",
    cancelledRejected: "Cancelled/Rejected",
    withdrawalHistory: "Withdrawal History",
    rewardTap: "Tap to open & win!",
    rewardCollect: "Collect Reward",
    rewardCongrats: "Congratulations! You won a reward!"
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
    tradeCommission: "عمولة الصفقات",
    daysOnPlatform: "أيام على المنصة",
    rewardSystem: "نظام المكافآت",
    deposit500: "إيداع $500+",
    deposit1000: "إيداع $1,000+",
    youGet50: "+$50 لك",
    youGet100: "+$100 لك",
    yourReferrals: "دعواتك",
    noReferralsYet: "لا توجد دعوات بعد. شارك رابطك لتبدأ!",
    waitingDeposit: "بانتظار الإيداع",
    copied: "تم النسخ!",
    accountStatus: "حالة الحساب",
    rank: "الرتبة",
    statusLabel: "الحالة",
    active: "نشط",
    tradeProfit: "أرباح صفقات الإحالة",
    youGet5pct: "+5% عمولة",
    pendingReview: "قيد المراجعة",
    paid: "تم الدفع",
    cancelledRejected: "ملغي/مرفوض",
    withdrawalHistory: "سجل السحب",
    rewardTap: "اضغط لفتح الصندوق واربح!",
    rewardCollect: "استلم المكافأة",
    rewardCongrats: "مبروك! ربحت مكافأة!"
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
    tradeCommission: "İşlem Komisyonu",
    daysOnPlatform: "Platformdaki Günler",
    rewardSystem: "Ödül Sistemi",
    deposit500: "$500+ Yatırım",
    deposit1000: "$1,000+ Yatırım",
    youGet50: "Sana +$50",
    youGet100: "Sana +$100",
    yourReferrals: "Davetlerin",
    noReferralsYet: "Henüz davet yok. Bağlantını paylaşarak başla!",
    waitingDeposit: "Yatırım bekleniyor",
    copied: "Kopyalandı!",
    accountStatus: "Hesap Durumu",
    rank: "Rütbe",
    statusLabel: "Durum",
    active: "Aktif",
    tradeProfit: "Davet işlem kârı",
    youGet5pct: "+%5 komisyon",
    pendingReview: "İnceleniyor",
    paid: "Ödendi",
    cancelledRejected: "İptal/Reddedildi",
    withdrawalHistory: "Çekim Geçmişi",
    rewardTap: "Açmak ve kazanmak için dokun!",
    rewardCollect: "Ödülü Topla",
    rewardCongrats: "Tebrikler! Bir ödül kazandın!"
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
    tradeCommission: "Handelsprovision",
    daysOnPlatform: "Tage auf der Plattform",
    rewardSystem: "Belohnungssystem",
    deposit500: "$500+ Einzahlung",
    deposit1000: "$1.000+ Einzahlung",
    youGet50: "+$50 für dich",
    youGet100: "+$100 für dich",
    yourReferrals: "Deine Einladungen",
    noReferralsYet: "Noch keine Einladungen. Teile deinen Link, um loszulegen!",
    waitingDeposit: "Warten auf Einzahlung",
    copied: "Kopiert!",
    accountStatus: "Kontostatus",
    rank: "Rang",
    statusLabel: "Status",
    active: "Aktiv",
    tradeProfit: "Empfehlungs-Handelsgewinn",
    youGet5pct: "+5% Provision",
    pendingReview: "In Prüfung",
    paid: "Bezahlt",
    cancelledRejected: "Storniert/Abgelehnt",
    withdrawalHistory: "Auszahlungsverlauf",
    rewardTap: "Tippe zum Öffnen & Gewinnen!",
    rewardCollect: "Belohnung einsammeln",
    rewardCongrats: "Herzlichen Glückwunsch! Du hast eine Belohnung gewonnen!"
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
    const tgParam = state.tg_id ? `?tg_id=${state.tg_id}` : '';
    const r = await fetch(`/api/settings/maintenance${tgParam}`).then(r => r.json());
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
  state.maintenanceMode = true;
}

function hideMaintenanceScreen() {
  const screen = $("#maintenanceScreen");
  if (screen) {
    screen.classList.add("hidden");
    document.body.style.overflow = "";
  }
  state.maintenanceMode = false;
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
  const tg_username = TWA?.initDataUnsafe?.user?.username || null;
  const payload = { key, rawKey, candidates, tg_id, name, email, initData, tg_username };

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
    // Save session token for device management
    if (r.user.session_token) {
      localStorage.setItem("session_token", r.user.session_token);
    }
    localStorage.setItem("login_ts", String(Date.now()));
    hydrateUser(r.user);
    unlockGate();
    $("#g-key").value = "";
    if(r.reused){ notify("🔐 Session restored"); }
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
  
  // Validate session token (device management)
  try {
    const savedToken = localStorage.getItem('session_token');
    const tgId = state.user?.tg_id || localStorage.getItem('tg');
    if (tgId && savedToken) {
      const sessCheck = await fetch(`/api/session/validate?tg_id=${tgId}&token=${savedToken}`).then(r => r.json());
      if (sessCheck.ok && !sessCheck.valid) {
        // Session invalidated by admin (logout)
        state.user = null;
        localStorage.removeItem('tg');
        localStorage.removeItem('session_token');
        localStorage.removeItem('activated');
        showGate();
        toast(state.lang === 'ar' ? 'تم تسجيل خروجك من قبل الإدارة' : 'Session expired. Please sign in again.');
        return false;
      }
    }
  } catch(e) { /* fail open */ }
  
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
  loadTrades(true);
  refreshOps();
  loadStats();
  
  state.refreshTimer = setInterval(async ()=>{
    try {
      await refreshUser();
      // loadTrades is handled by startRealtimeUpdates — no need to call here
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
  }, 5000);
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

// ===== Withdraw Confirmation Modal (Shows fee details) =====
function showWithdrawConfirm(tg, amount, method, address, feeData) {
  const isAr = state.lang === 'ar';
  const isTr = state.lang === 'tr';
  const isDe = state.lang === 'de';

  const overlay = document.createElement('div');
  overlay.id = 'withdrawConfirmOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);';

  const methodNames = { usdt_trc20: 'USDT (TRC20)', usdt_erc20: 'USDT (ERC20)', btc: 'Bitcoin', eth: 'Ethereum' };
  const methodName = methodNames[method] || 'USDT (TRC20)';
  const shortAddr = address.length > 16 ? address.slice(0,8) + '...' + address.slice(-6) : address;

  // Fee display
  const totalFee = feeData ? feeData.totalFee : 0;
  const netAmount = feeData ? feeData.netAmount : amount;
  const feeRate = feeData ? feeData.feeRate : 0;
  const extraFee = feeData ? feeData.extraFee : 0;
  const baseFee = feeData ? feeData.baseFee : 0;
  const turkeyTax = feeData ? (feeData.turkeyTax || 0) : 0;
  const turkeyTaxRate = feeData ? (feeData.turkeyTaxRate || 0) : 0;

  const labels = {
    title: isAr ? 'تأكيد طلب السحب' : isTr ? 'Çekim Onayı' : isDe ? 'Auszahlung bestätigen' : 'Confirm Withdrawal',
    review: isAr ? 'يرجى مراجعة التفاصيل' : isTr ? 'Lütfen detayları inceleyin' : isDe ? 'Bitte überprüfen Sie die Details' : 'Please review the details',
    withdrawAmount: isAr ? 'مبلغ السحب' : isTr ? 'Çekim Tutarı' : isDe ? 'Auszahlungsbetrag' : 'Withdrawal Amount',
    methodLabel: isAr ? 'الطريقة' : isTr ? 'Yöntem' : isDe ? 'Methode' : 'Method',
    addressLabel: isAr ? 'العنوان' : isTr ? 'Adres' : isDe ? 'Adresse' : 'Address',
    feeLabel: isAr ? 'رسوم السحب' : isTr ? 'Çekim Ücreti' : isDe ? 'Gebühr' : 'Withdrawal Fee',
    extraFeeLabel: isAr ? 'رسوم إضافية (3% لكل $100)' : isTr ? 'Ek ücret (her $100 için %3)' : isDe ? 'Zusatzgebühr (3% pro $100)' : 'Extra fee (3% per $100)',
    turkeyTaxLabel: isAr ? 'خصم من دولة تركيا (4%)' : isTr ? 'Türkiye vergi kesintisi (%4)' : isDe ? 'Türkei-Steuerabzug (4%)' : 'Turkey tax deduction (4%)',
    youReceive: isAr ? 'المبلغ المستلم' : isTr ? 'Alacağınız tutar' : isDe ? 'Sie erhalten' : 'You Receive',
    status: isAr ? 'الحالة' : isTr ? 'Durum' : isDe ? 'Status' : 'Status',
    underReview: isAr ? 'قيد المراجعة' : isTr ? 'İnceleniyor' : isDe ? 'In Prüfung' : 'Under Review',
    reviewNote: isAr ? 'سيتم مراجعة طلبك وتحويل المبلغ خلال 24 ساعة' : isTr ? 'Talebiniz 24 saat içinde incelenecek ve işlenecektir' : isDe ? 'Ihre Anfrage wird innerhalb von 24 Stunden bearbeitet' : 'Your request will be reviewed and processed within 24 hours',
    confirm: isAr ? 'تأكيد السحب' : isTr ? 'Onayla' : isDe ? 'Bestätigen' : 'Confirm',
    cancel: isAr ? 'إلغاء' : isTr ? 'İptal' : isDe ? 'Abbrechen' : 'Cancel'
  };

  overlay.innerHTML = `
    <div style="background:linear-gradient(145deg,#0d0d0d,#1a1a1a);border:1px solid rgba(255,215,0,0.15);border-radius:20px;padding:32px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="width:56px;height:56px;margin:0 auto 12px;background:linear-gradient(135deg,rgba(255,215,0,0.15),rgba(184,134,11,0.15));border-radius:50%;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,215,0,0.2);">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FFD700" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
        </div>
        <div style="font-size:18px;font-weight:700;color:#FFD700;">${labels.title}</div>
        <div style="font-size:12px;color:#888;margin-top:4px;">${labels.review}</div>
      </div>
      <div style="background:rgba(255,215,0,0.03);border:1px solid rgba(255,215,0,0.08);border-radius:14px;padding:16px;margin-bottom:20px;">
        <div style="text-align:center;margin-bottom:16px;">
          <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">${labels.withdrawAmount}</div>
          <div style="font-size:32px;font-weight:800;color:#FFD700;margin-top:4px;">$${amount.toFixed(2)}</div>
        </div>
        <div style="border-top:1px solid rgba(255,215,0,0.08);padding-top:12px;">
          <div style="display:flex;justify-content:space-between;padding:6px 0;">
            <span style="color:#888;font-size:12px;">${labels.methodLabel}</span>
            <span style="color:#e0e0e0;font-size:12px;font-weight:600;">${methodName}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;">
            <span style="color:#888;font-size:12px;">${labels.addressLabel}</span>
            <span style="color:#e0e0e0;font-size:12px;font-family:monospace;">${shortAddr}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid rgba(255,59,99,0.1);margin-top:6px;padding-top:10px;">
            <span style="color:#ff8899;font-size:12px;">${labels.feeLabel} (${feeRate}%)</span>
            <span style="color:#ff8899;font-size:12px;font-weight:600;">-$${baseFee.toFixed(2)}</span>
          </div>
          ${extraFee > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 0;">
            <span style="color:#ff8899;font-size:12px;">${labels.extraFeeLabel}</span>
            <span style="color:#ff8899;font-size:12px;font-weight:600;">-$${extraFee.toFixed(2)}</span>
          </div>` : ''}
          ${turkeyTax > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 0;">
            <span style="color:#ff6b6b;font-size:12px;">🇹🇷 ${labels.turkeyTaxLabel}</span>
            <span style="color:#ff6b6b;font-size:12px;font-weight:600;">-$${turkeyTax.toFixed(2)}</span>
          </div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid rgba(0,214,143,0.15);margin-top:6px;">
            <span style="color:#00d68f;font-size:13px;font-weight:700;">${labels.youReceive}</span>
            <span style="color:#00d68f;font-size:16px;font-weight:800;">$${netAmount.toFixed(2)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;">
            <span style="color:#888;font-size:12px;">${labels.status}</span>
            <span style="color:#FFD700;font-size:12px;font-weight:600;">${labels.underReview}</span>
          </div>
        </div>
      </div>
      <div style="background:rgba(255,215,0,0.05);border-radius:10px;padding:10px 14px;margin-bottom:20px;font-size:11px;color:#B8860B;text-align:center;">
        ${labels.reviewNote}
      </div>
      <div style="display:flex;gap:10px;">
        <button id="confirmWithdrawBtn" style="flex:1;padding:14px;background:linear-gradient(135deg,#FFD700,#B8860B);border:none;border-radius:10px;color:#000;font-size:15px;font-weight:700;cursor:pointer;transition:all 0.2s;">
          ✅ ${labels.confirm}
        </button>
        <button id="cancelWithdrawBtn" style="flex:1;padding:14px;background:transparent;border:1px solid rgba(255,215,0,0.2);border-radius:10px;color:#888;font-size:15px;cursor:pointer;transition:all 0.2s;">
          ${labels.cancel}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.getElementById('cancelWithdrawBtn').onclick = () => overlay.remove();

  document.getElementById('confirmWithdrawBtn').onclick = async () => {
    const confirmBtn = document.getElementById('confirmWithdrawBtn');
    confirmBtn.textContent = isAr ? 'جاري الإرسال...' : 'Sending...';
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '0.6';

    try {
      const r = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tg_id: tg, amount, method, address })
      }).then(r => r.json());

      overlay.remove();

      if (!r.ok) {
        let errorMsg = r.error || "Error";
        if (errorMsg.includes("No saved address")) errorMsg = isAr ? 'احفظ عنوان المحفظة أولاً' : 'Save wallet address first';
        else if (errorMsg.includes("Insufficient")) errorMsg = isAr ? 'الرصيد غير كافي' : 'Insufficient balance';
        else if (errorMsg.includes("maintenance") || errorMsg.includes("توقيف")) errorMsg = isAr ? 'السحب متوقف مؤقتاً' : 'Withdrawals paused';
        else if (errorMsg.includes("أقل من الحد") || errorMsg.includes("below minimum")) errorMsg = isAr ? 'المبلغ أقل من الحد الأدنى' : 'Amount below minimum';
        return notify("❌ " + errorMsg);
      }

      showWithdrawSuccess(amount);
      $("#amount").value = '';
      if ($("#withdrawAddr")) $("#withdrawAddr").value = '';
      await refreshUser();
      await refreshRequests();
    } catch (err) {
      overlay.remove();
      notify(isAr ? '❌ خطأ في الاتصال' : '❌ Connection error');
    }
  };
}

$("#reqWithdraw").addEventListener("click", async () => {
  const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
  const amount = Number($("#amount").value || 0);
  const address = $("#withdrawAddr")?.value?.trim() || '';
  const isAr = state.lang === 'ar';
  const isTr = state.lang === 'tr';
  const isDe = state.lang === 'de';

  if (!address) return notify(isAr ? "❌ أدخل عنوان المحفظة" : isTr ? "❌ Cüzdan adresini girin" : isDe ? "❌ Wallet-Adresse eingeben" : "❌ Enter wallet address");
  if (address.length < 26 || address.length > 64) return notify(isAr ? "❌ عنوان المحفظة غير صحيح (26-64 حرف)" : isTr ? "❌ Geçersiz cüzdan adresi (26-64 karakter)" : isDe ? "❌ Ungültige Wallet-Adresse (26-64 Zeichen)" : "❌ Invalid wallet address (26-64 characters)");
  if (!/^[a-zA-Z0-9]+$/.test(address)) return notify(isAr ? "❌ عنوان المحفظة يجب أن يحتوي على أحرف وأرقام فقط" : isTr ? "❌ Adres sadece harf ve rakam içermelidir" : isDe ? "❌ Adresse darf nur Buchstaben und Zahlen enthalten" : "❌ Address must contain only letters and numbers");
  if (amount <= 0) return notify(isAr ? "❌ أدخل مبلغ صحيح" : isTr ? "❌ Geçerli bir tutar girin" : isDe ? "❌ Gültigen Betrag eingeben" : "❌ Enter valid amount");

  const userBalance = Number(state.user?.balance || 0);
  if (amount > userBalance) return notify(isAr ? "❌ الرصيد غير كافي" : isTr ? "❌ Yetersiz bakiye" : isDe ? "❌ Unzureichendes Guthaben" : "❌ Insufficient balance");

  // Fetch fee preview first
  try {
    const feeRes = await fetch(`/api/wallet/withdraw/fee-preview?tg_id=${tg}&amount=${amount}`).then(r => r.json());
    if (feeRes.ok) {
      showWithdrawConfirm(tg, amount, state.method, address, feeRes);
    } else {
      showWithdrawConfirm(tg, amount, state.method, address, null);
    }
  } catch(e) {
    showWithdrawConfirm(tg, amount, state.method, address, null);
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
  
  $("#balance").textContent = "$" + balance.toFixed(2);
  $("#subLeft").textContent = user.sub_expires ? new Date(user.sub_expires).toLocaleDateString() : "—";
  
  // pnlDay and pnlMonth are updated by loadHomeStats() from real API data
  // Only set them here if stats haven't loaded yet
  if (!state.homeStatsLoaded) {
    $("#pnlDay").textContent = "$0.00";
    $("#pnlMonth").textContent = "$0.00";
  }

  const name = user.name || user.first_name || "";
  const email = user.email || "";
  const tgId = user.tg_id || user.id || "";
  const spTgId = $("#spTgId");
  const spName = $("#spName");
  const spEmail = $("#spEmail");
  if(spTgId) spTgId.textContent = tgId || "—";
  if(spName) spName.textContent = name || "—";
  if(spEmail) spEmail.textContent = email || "—";

  // ===== Rank Display (uses display_rank from server, translated to user's language) =====
  const rankTranslations = {
    'عضو':       { en: 'Member',      ar: 'عضو',       tr: 'Üye',          de: 'Mitglied',     icon: '👤', color: '#ffd700' },
    'وكيل':      { en: 'Agent',       ar: 'وكيل',      tr: 'Temsilci',     de: 'Agent',        icon: '🏅', color: '#58a6ff' },
    'وكيل ذهبي': { en: 'Gold Agent',  ar: 'وكيل ذهبي', tr: 'Altın Temsilci', de: 'Gold Agent', icon: '🥇', color: '#ffd700' },
    'شريك':      { en: 'Partner',     ar: 'شريك',      tr: 'Ortak',        de: 'Partner',      icon: '💎', color: '#a371f7' },
    'Member':     { en: 'Member',      ar: 'عضو',       tr: 'Üye',          de: 'Mitglied',     icon: '👤', color: '#ffd700' },
    'Agent':      { en: 'Agent',       ar: 'وكيل',      tr: 'Temsilci',     de: 'Agent',        icon: '🏅', color: '#58a6ff' },
    'Gold Agent': { en: 'Gold Agent',  ar: 'وكيل ذهبي', tr: 'Altın Temsilci', de: 'Gold Agent', icon: '🥇', color: '#ffd700' },
    'Partner':    { en: 'Partner',     ar: 'شريك',      tr: 'Ortak',        de: 'Partner',      icon: '💎', color: '#a371f7' }
  };
  // Server sends display_rank which handles custom_rank + referral count logic
  const serverRank = user.display_rank || (Number(user.referral_count || 0) >= 5 ? 'وكيل' : 'عضو');
  const rankInfo = rankTranslations[serverRank] || rankTranslations['عضو'];
  const translatedRank = rankInfo[state.lang] || rankInfo.en;
  const rankColor = rankInfo.color;
  const rankIcon = rankInfo.icon;
  const rankBadge = $("#userRankBadge");
  const spRank = $("#spUserRank");
  if(rankBadge) rankBadge.innerHTML = `<span style="position:relative;top:-1px;margin-right:4px;">${rankIcon}</span> ${translatedRank}`;
  if(spRank){ spRank.innerHTML = `${rankIcon} ${translatedRank}`; spRank.style.color = rankColor; }

  // Show referral trade commission
  const refCommEl = $("#refTradeCommission");
  if(refCommEl) refCommEl.textContent = `$${Number(user.referral_trade_commission || 0).toFixed(2)}`;

  // Days on platform
  const spDays = $("#spDaysOnPlatform");
  if(spDays && user.created_at) {
    const days = Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000);
    const daysLabels = { ar: `${days} يوم`, tr: `${days} gün`, de: `${days} Tage`, en: `${days} days` };
    spDays.textContent = daysLabels[state.lang] || daysLabels.en;
  }

  // Country/Flag feature removed

  // Trigger reward check hook
  if (window._rewardHydrateHook) window._rewardHydrateHook(user);
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
    // Check force logout
    const user = payload.user;
    const loginTime = Number(localStorage.getItem("login_ts") || 0);
    const forceLogoutAt = Number(user.force_logout_at_ts || 0);
    const globalForceLogout = Number(user.global_force_logout_at_ts || 0);
    const maxForceLogout = Math.max(forceLogoutAt, globalForceLogout);
    
    if(maxForceLogout > 0 && loginTime < maxForceLogout){
      // Force logout - clear everything and show gate
      state.user = null;
      localStorage.removeItem("tg");
      localStorage.removeItem("activated");
      localStorage.removeItem("login_ts");
      showGate();
      toast("تم تسجيل خروجك من جميع الأجهزة");
      return false;
    }
    
    state.user = user;
    hydrateUser(user);
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

// Load stats for both home page and stats tab
async function loadStats(){
  const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
  if(!tg) return;
  
  try{
    const r = await fetch(`/api/stats/${tg}`).then(r=>r.json());
    if(r.ok){
      // Helper to set stat values
      const setVal = (id, val, isMoney=true) => {
        const el = $(id);
        if(el) {
          el.textContent = isMoney ? (val>=0?"+":"")+ "$"+Math.abs(val).toFixed(2) : val;
          if(isMoney) el.style.color = val >= 0 ? "#9df09d" : "#ff8899";
        }
      };
      
      // Update Stats tab
      setVal("#statToday", r.daily.net);
      setVal("#statMonth", r.monthly.net);
      setVal("#statAll", r.allTime.net);
      setVal("#statCount", r.allTime.count, false);
      
      // Update Home page Day/Month cards with REAL data
      const pnlDayEl = $("#pnlDay");
      const pnlMonthEl = $("#pnlMonth");
      if(pnlDayEl) {
        const dNet = r.daily.net;
        pnlDayEl.textContent = (dNet >= 0 ? "+" : "") + "$" + Math.abs(dNet).toFixed(2);
        pnlDayEl.style.color = dNet >= 0 ? "#9df09d" : "#ff8899";
      }
      if(pnlMonthEl) {
        const mNet = r.monthly.net;
        pnlMonthEl.textContent = (mNet >= 0 ? "+" : "") + "$" + Math.abs(mNet).toFixed(2);
        pnlMonthEl.style.color = mNet >= 0 ? "#9df09d" : "#ff8899";
      }
      
      state.homeStatsLoaded = true;
      
      // Update history list
      const box = $("#historyList");
      if(box) {
        box.innerHTML = "";
        
        if(r.history && r.history.length > 0){
          r.history.forEach(trade => {
            const div = document.createElement("div");
            div.className = "op";
            const pnl = Number(trade.pnl);
            const color = pnl >= 0 ? "#9df09d" : "#ff8899";
            const date = new Date(trade.closed_at).toLocaleDateString();
            const reason = trade.close_reason === 'auto_expire' ? '✅ مكتمل' 
              : trade.close_reason === 'admin_close' ? '🛡️ إداري' 
              : trade.close_reason === 'user_close' ? '✋ يدوي'
              : trade.close_reason || '';
            
            div.innerHTML = `
              <div style="display:flex; justify-content:space-between; width:100%">
                <div>
                  <span>${trade.symbol || 'XAUUSD'} ${trade.direction || ''}</span>
                  <small>${date} • ${reason}</small>
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
    }
  }catch(err){
    console.error("Failed to load stats:", err);
  }
}

const names = [
  "أحمد","محمد","خالد","سارة","رامي","نور","ليلى","وسيم","حسن","طارق",
  "عبدالله","فهد","سلطان","ياسر","عمر","مريم","هند","ريم","بدر","ناصر",
  "تركي","عادل","سعود","جاسم","ماجد","لمى","دانة","فيصل","حمد","زياد",
  "منصور","صالح","يوسف","إبراهيم","عبدالرحمن","هاني","وليد","سامي","أنس","بلال"
];

// Avatar colors for fake notifications
const avatarColors = [
  '#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F',
  '#BB8FCE','#85C1E9','#82E0AA','#F8C471','#D7BDE2','#A3E4D7','#FAD7A0','#AED6F1'
];

function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function getInitial(name) {
  return name.charAt(0);
}

function startFeed(){
  if(state.feedTimer) clearInterval(state.feedTimer);
  const feed = $("#feed");
  
  const feedLabels = {
    withdrawal: { ar: 'سحب بنجاح', en: 'Withdrew successfully', tr: 'Başarıyla çekildi', de: 'Erfolgreich abgehoben' },
    profit: { ar: 'ربح من صفقة', en: 'Profited from', tr: 'Kâr etti', de: 'Gewinn aus' },
    loss: { ar: 'خسر في صفقة', en: 'Lost in', tr: 'Kaybetti', de: 'Verlust bei' },
    newUser: { ar: 'مستخدم جديد أودع', en: 'New user deposited', tr: 'Yeni kullanıcı yatırdı', de: 'Neuer Benutzer hat eingezahlt' },
    justNow: { ar: 'الآن', en: 'Just now', tr: 'Şimdi', de: 'Gerade' }
  };
  
  const getLbl = (key) => feedLabels[key]?.[state.lang] || feedLabels[key]?.en || '';
  
  const push = (name, icon, amountText, descText, amountColor)=>{
    const it = document.createElement("div");
    it.className="item";
    const color = getAvatarColor(name);
    const initial = getInitial(name);
    it.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:36px;height:36px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;color:#000;flex-shrink:0;">${initial}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;font-size:13px;color:#e6edf3;">${name}</span>
            <span style="font-size:14px;font-weight:700;color:${amountColor};">${amountText}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px;">
            <span style="font-size:11px;color:#888;">${icon} ${descText}</span>
            <span style="font-size:10px;color:#555;">${getLbl('justNow')}</span>
          </div>
        </div>
      </div>
    `;
    feed.prepend(it);
    $("#sndNotify")?.play().catch(()=>{});
    while(feed.childElementCount>12) feed.lastChild.remove();
  };
  
  const once = ()=>{
    if(!isMarketOpen()){
      const it = document.createElement("div");
      it.className="item"; it.textContent = `📅 ${t('marketClosed')}`;
      feed.prepend(it);
      while(feed.childElementCount>12) feed.lastChild.remove();
      return;
    }
    
    const r = Math.random();
    const name = names[Math.floor(Math.random()*names.length)];
    
    if(r < 0.25){
      const v = 50+Math.floor(Math.random()*200);
      push(name, '💸', `$${v}`, getLbl('withdrawal'), '#FFD700');
    } else if(r < 0.55){
      const v = 20+Math.floor(Math.random()*120);
      const m = ["Gold","BTC","ETH","Silver"][Math.floor(Math.random()*4)];
      push(name, '📈', `+$${v}`, `${getLbl('profit')} ${m}`, '#00d68f');
    } else if(r < 0.75){
      const v = 10+Math.floor(Math.random()*80);
      const m = ["Gold","BTC","ETH","Silver"][Math.floor(Math.random()*4)];
      push(name, '📉', `-$${v}`, `${getLbl('loss')} ${m}`, '#ff3b63');
    } else {
      const v = 150+Math.floor(Math.random()*400);
      const newName = names[Math.floor(Math.random()*names.length)];
      push(newName, '🎉', `$${v}`, getLbl('newUser'), '#FFD700');
    }
  };
  
  once();
  state.feedTimer = setInterval(once, 180000);
}

// Track rendered trade IDs to avoid full re-render on update
let _renderedTradeIds = [];

async function loadTrades(forceRedraw = false){
  const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
  if(!tg) return;
  
  try{
    const r = await fetch(`/api/trades/${tg}`).then(r=>r.json());
    const box = $("#tradesList");
    
    // Calculate total PnL from all open trades
    let totalPnl = 0;
    
    if(r.ok && r.trades && r.trades.length > 0){
      // Use unique keys (type_id) to distinguish between different trade types with same id
      const currentIds = r.trades.map(t => `${t.trade_type}_${t.id}`);
      
      // Check if trade list changed (new trade added or trade closed)
      const listChanged = forceRedraw ||
        currentIds.length !== _renderedTradeIds.length ||
        currentIds.some((id, i) => id !== _renderedTradeIds[i]);
      
      if(listChanged){
        // Full redraw only when list changes
        box.innerHTML = "";
        _renderedTradeIds = currentIds;
        
        r.trades.forEach(trade=>{
          const div = document.createElement("div");
          div.className="op";
          // Use unique key combining id + type to avoid conflicts
          const tradeKey = `${trade.trade_type}_${trade.id}`;
          div.dataset.tradeId = trade.id;
          div.dataset.tradeKey = tradeKey;
          div.dataset.tradeType = trade.trade_type || 'regular';
          
          const pnl = Number(trade.pnl || 0);
          totalPnl += pnl;
          const pnlColor = pnl >= 0 ? "#00d68f" : "#ff3b63";
          const pnlSign = pnl >= 0 ? "+" : "";
          
          const opened = new Date(trade.opened_at);
          const duration = Number(trade.duration_seconds || trade.mt_duration || 3600);
          const elapsed = Math.floor((Date.now() - opened.getTime()) / 1000);
          const remaining = Math.max(0, duration - elapsed);
          const hours = Math.floor(remaining / 3600);
          const minutes = Math.floor((remaining % 3600) / 60);
          const seconds = remaining % 60;
          const timeStr = remaining > 0 ? `${hours}h ${minutes}m ${seconds}s` : (state.lang === 'ar' ? 'جاري الإغلاق...' : 'Closing...');
          
          const isMassTrade = trade.trade_type === 'mass';
          const isCustomTrade = trade.trade_type === 'custom';
          let tradeLabel = '';
          let labelColor = '#3d8bff';
          if (isMassTrade) {
            tradeLabel = state.lang === 'ar' ? '🤖 صفقة البوت' : '🤖 Bot Trade';
            labelColor = '#3d8bff';
          } else if (isCustomTrade) {
            tradeLabel = state.lang === 'ar' ? '🎯 صفقة إضافية' : '🎯 Extra Trade';
            labelColor = '#a371f7';
          }
          
          // Speed indicator
          const speed = trade.speed || 'normal';
          let speedIcon = '';
          if (speed === 'fast') speedIcon = '⚡';
          else if (speed === 'turbo') speedIcon = '🚀';
          
          const progressPercent = Math.min(100, Math.round((elapsed / duration) * 100));
          const progressColor = pnl >= 0 ? '#00d68f' : '#ff3b63';
          const canClose = !isMassTrade && (trade.trade_type !== 'custom' || trade.can_close);
          
          div.innerHTML = `
            <div style="width:100%;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
                <div style="flex:1;">
                  <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <span>${trade.symbol} ${trade.direction} (${trade.lot_size})</span>
                    ${speedIcon ? `<span style="font-size:12px;">${speedIcon}</span>` : ''}
                    ${tradeLabel ? `<span style="font-size:10px; background:rgba(0,102,255,0.15); color:${labelColor}; padding:2px 6px; border-radius:10px;">${tradeLabel}</span>` : ''}
                  </div>
                  <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
                    <small class="trade-timer" style="opacity:0.6">⏱ ${timeStr}</small>
                    <small class="trade-price" style="opacity:0.5;">💰 $${Number(trade.current_price || 0).toFixed(2)}</small>
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  <div style="text-align:right;">
                    <b class="trade-pnl" style="color:${pnlColor}; font-size:16px;">${pnlSign}$${Math.abs(pnl).toFixed(2)}</b>
                  </div>
                  ${canClose ? `<button class="btn-close-trade" data-trade-id="${trade.id}" data-trade-type="${trade.trade_type || 'regular'}" style="padding:4px 8px; font-size:12px; background:#ff4444; color:white; border:none; border-radius:4px; cursor:pointer;">✕</button>` : ''}
                </div>
              </div>
              <div style="width:100%; height:4px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden;">
                <div class="trade-progress" style="width:${progressPercent}%; height:100%; background:${progressColor}; border-radius:2px; transition:width 1s linear;"></div>
              </div>
            </div>
          `;
          box.appendChild(div);
        });
        
        // Add close trade handlers
        $$(".btn-close-trade").forEach(btn=>{
          btn.addEventListener("click", async ()=>{
            const tradeId = btn.dataset.tradeId;
            const tradeType = btn.dataset.tradeType;
            if (tradeType === 'mass') return;
            
            const confirmMsg = state.lang === 'ar' ? 'هل تريد إغلاق هذه الصفقة الآن؟' : 'Close this trade now?';
            if(confirm(confirmMsg)){
              try{
                const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
                const r = await fetch(`/api/trades/close`, {
                  method: "POST",
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tg_id: tg, trade_id: tradeId, trade_type: tradeType })
                }).then(r=>r.json());
                if(r.ok){
                  const closedMsg = state.lang === 'ar' ? `✅ تم إغلاق الصفقة: ${r.pnl >= 0 ? '+' : ''}$${Number(r.pnl).toFixed(2)}` : `✅ Trade closed: ${r.pnl >= 0 ? '+' : ''}$${Number(r.pnl).toFixed(2)}`;
                  notify(closedMsg);
                  await refreshUser();
                  await loadTrades(true);
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
        
      } else {
        // Smart update: only update PnL, timer, price, progress bar in-place (no flicker)
        r.trades.forEach(trade => {
          const tradeKey = `${trade.trade_type}_${trade.id}`;
          const card = box.querySelector(`[data-trade-key="${tradeKey}"]`);
          if (!card) return;
          
          const pnl = Number(trade.pnl || 0);
          totalPnl += pnl;
          const pnlColor = pnl >= 0 ? "#00d68f" : "#ff3b63";
          const pnlSign = pnl >= 0 ? "+" : "";
          
          // Update PnL value
          const pnlEl = card.querySelector('.trade-pnl');
          if (pnlEl) {
            pnlEl.textContent = `${pnlSign}$${Math.abs(pnl).toFixed(2)}`;
            pnlEl.style.color = pnlColor;
          }
          
          // Update current price
          const priceEl = card.querySelector('.trade-price');
          if (priceEl) {
            priceEl.textContent = `💰 $${Number(trade.current_price || 0).toFixed(2)}`;
          }
          
          // Update timer
          const opened = new Date(trade.opened_at);
          const duration = Number(trade.duration_seconds || trade.mt_duration || 3600);
          const elapsed = Math.floor((Date.now() - opened.getTime()) / 1000);
          const remaining = Math.max(0, duration - elapsed);
          const hours = Math.floor(remaining / 3600);
          const minutes = Math.floor((remaining % 3600) / 60);
          const seconds = remaining % 60;
          const timeStr = remaining > 0 ? `${hours}h ${minutes}m ${seconds}s` : (state.lang === 'ar' ? 'جاري الإغلاق...' : 'Closing...');
          const timerEl = card.querySelector('.trade-timer');
          if (timerEl) timerEl.textContent = `⏱ ${timeStr}`;
          
          // Update progress bar
          const progressPercent = Math.min(100, Math.round((elapsed / duration) * 100));
          const progressEl = card.querySelector('.trade-progress');
          if (progressEl) {
            progressEl.style.width = `${progressPercent}%`;
            progressEl.style.background = pnlColor;
          }
        });
      }
      
      const tradeBadge = $("#tradeBadge");
      if(tradeBadge){
        const tradesText = state.lang === 'ar' ? `${r.trades.length} صفقة مفتوحة` : `${r.trades.length} open trade${r.trades.length > 1 ? 's' : ''}`;
        tradeBadge.textContent = tradesText;
      }
      
      // Update PnL display and chart color
      updatePnLDisplay(totalPnl);
      
    } else {
      // No open trades - clear list only if it had trades before
      if (_renderedTradeIds.length > 0 || box.innerHTML === '' || forceRedraw) {
        box.innerHTML = "";
        _renderedTradeIds = [];
        const emptyDiv = document.createElement("div");
        emptyDiv.className="op";
        const noTradesText = state.lang === 'ar' ? 'لا توجد صفقات مفتوحة' : 'No open trades';
        emptyDiv.innerHTML = `<span style="opacity:0.5">${noTradesText}</span>`;
        box.appendChild(emptyDiv);
      }
      
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
  if (tradesUpdateInterval) clearInterval(tradesUpdateInterval);
  tradesUpdateInterval = setInterval(async () => {
    try {
      // Always update trades data (smart update: no flicker if list unchanged)
      await loadTrades();
      
      // Update user balance every cycle too
      await refreshUser();
    } catch(err) {
      console.error('Realtime update error:', err);
    }
  }, 2000); // Every 2 seconds for smooth real-time feel
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
      const botUsername = window.__BOT_USERNAME || 'test5616_bot';
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

// ===== Button Click Animation & Sound System =====
(function initClickFeedback() {
  // Create click sound using Web Audio API (no file needed)
  let audioCtx = null;

  function getAudioCtx() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
    }
    return audioCtx;
  }

  function playClickSound(type = 'soft') {
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'soft') {
        osc.frequency.setValueAtTime(520, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === 'success') {
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.setValueAtTime(660, ctx.currentTime + 0.07);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.14);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
      } else if (type === 'tab') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(380, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(480, ctx.currentTime + 0.06);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.08);
      }
    } catch(e) {}
  }

  function triggerHaptic(style = 'light') {
    try {
      if (TWA?.HapticFeedback?.impactOccurred) {
        TWA.HapticFeedback.impactOccurred(style);
      } else if (navigator.vibrate) {
        navigator.vibrate(style === 'light' ? 10 : style === 'medium' ? 20 : 30);
      }
    } catch(e) {}
  }

  function addRipple(el, e) {
    const rect = el.getBoundingClientRect();
    const x = (e.clientX || rect.left + rect.width / 2) - rect.left;
    const y = (e.clientY || rect.top + rect.height / 2) - rect.top;
    const ripple = document.createElement('span');
    ripple.style.cssText = `
      position:absolute;left:${x}px;top:${y}px;
      width:0;height:0;border-radius:50%;
      background:rgba(255,255,255,0.35);
      transform:translate(-50%,-50%);
      animation:rippleAnim 0.45s ease-out forwards;
      pointer-events:none;z-index:9999;
    `;
    const prev = el.style.position;
    if (!prev || prev === 'static') el.style.position = 'relative';
    el.style.overflow = 'hidden';
    el.appendChild(ripple);
    setTimeout(() => { ripple.remove(); if(!prev || prev==='static') el.style.position = prev; }, 460);
  }

  // Inject ripple keyframe CSS once
  if (!document.getElementById('rippleStyle')) {
    const s = document.createElement('style');
    s.id = 'rippleStyle';
    s.textContent = `
      @keyframes rippleAnim {
        0%   { width:0; height:0; opacity:1; }
        100% { width:200px; height:200px; opacity:0; }
      }
      .btn-press { transform: scale(0.94) !important; transition: transform 0.08s ease !important; }
    `;
    document.head.appendChild(s);
  }

  // Delegate click events on all buttons
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('button, .seg-btn, .s-item, .mini-btn, .i-btn, .sheet-btn, [data-tab]');
    if (!el) return;

    // Add press animation
    el.classList.add('btn-press');
    setTimeout(() => el.classList.remove('btn-press'), 120);

    // Ripple effect
    addRipple(el, e);

    // Determine sound type
    const isTab = el.classList.contains('seg-btn') || el.dataset.tab;
    const isSuccess = el.classList.contains('success') || el.id === 'confirmWithdrawBtn';

    if (isTab) {
      playClickSound('tab');
      triggerHaptic('light');
    } else if (isSuccess) {
      playClickSound('success');
      triggerHaptic('medium');
    } else {
      playClickSound('soft');
      triggerHaptic('light');
    }
  }, { passive: true });
})();

// Country/Flag feature removed

// ===== Reward Box System =====
(function initRewardSystem() {
  let rewardData = null;
  let rewardChecked = false;

  async function checkReward() {
    if (!state.tg_id || rewardChecked) return;
    try {
      const r = await fetch(`/api/reward/check?tg_id=${state.tg_id}`).then(r => r.json());
      if (r.ok && r.hasReward) {
        rewardData = { rewardId: r.rewardId, amount: r.amount };
        showRewardBox();
      }
      rewardChecked = true;
    } catch(e) {
      console.log('Reward check failed:', e);
    }
  }

  function showRewardBox() {
    const overlay = document.getElementById('rewardOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Apply i18n
    const tapText = overlay.querySelector('[data-i18n="rewardTap"]');
    if (tapText) tapText.textContent = t('rewardTap');
    const collectBtn = document.getElementById('rewardCollectBtn');
    if (collectBtn) collectBtn.textContent = t('rewardCollect');

    // Spawn background stars
    const particles = document.getElementById('rewardParticles');
    if (particles) {
      particles.innerHTML = '';
      for (let i = 0; i < 30; i++) {
        const star = document.createElement('div');
        star.className = 'reward-star';
        star.textContent = ['\u2728', '\u2B50', '\u2726', '\u2605'][Math.floor(Math.random() * 4)];
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        star.style.animationDelay = (Math.random() * 2) + 's';
        star.style.fontSize = (10 + Math.random() * 14) + 'px';
        particles.appendChild(star);
      }
    }
  }

  function spawnCoinBurst() {
    const container = document.getElementById('rewardCoins');
    if (!container) return;
    container.innerHTML = '';
    const emojis = ['\ud83e\ude99', '\ud83d\udcb0', '\ud83d\udcb5', '\ud83c\udf1f', '\u2728', '\ud83d\udc8e', '\ud83c\udfc6'];
    for (let i = 0; i < 20; i++) {
      const coin = document.createElement('div');
      coin.className = 'reward-coin';
      coin.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      const angle = (Math.PI * 2 * i) / 20;
      const dist = 80 + Math.random() * 120;
      coin.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
      coin.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
      coin.style.left = '50%';
      coin.style.top = '50%';
      coin.style.animationDelay = (Math.random() * 0.3) + 's';
      coin.style.fontSize = (18 + Math.random() * 16) + 'px';
      container.appendChild(coin);
    }
  }

  function spawnGoldParticles() {
    const particles = document.getElementById('rewardParticles');
    if (!particles) return;
    particles.innerHTML = '';
    const colors = ['#FFD700', '#FFE44D', '#DAA520', '#FFA500', '#FF6347', '#00d68f', '#fff'];
    for (let i = 0; i < 60; i++) {
      const p = document.createElement('div');
      p.className = 'reward-particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDuration = (2 + Math.random() * 3) + 's';
      p.style.animationDelay = (Math.random() * 2) + 's';
      p.style.width = (4 + Math.random() * 8) + 'px';
      p.style.height = p.style.width;
      if (Math.random() > 0.5) {
        p.style.borderRadius = '2px';
        p.style.transform = 'rotate(45deg)';
      }
      particles.appendChild(p);
    }
  }

  // Click on unopened box
  document.getElementById('rewardBoxUnopened')?.addEventListener('click', async () => {
    if (!rewardData) return;
    const unopened = document.getElementById('rewardBoxUnopened');
    const opened = document.getElementById('rewardBoxOpened');
    if (!unopened || !opened) return;

    // Shake animation
    unopened.classList.add('opening');

    // Claim from server
    try {
      const r = await fetch('/api/reward/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_id: state.tg_id })
      }).then(r => r.json());

      if (!r.ok) {
        document.getElementById('rewardOverlay')?.classList.add('hidden');
        document.body.style.overflow = '';
        return;
      }

      // After shake, show opened state
      setTimeout(() => {
        unopened.classList.add('hidden');
        opened.classList.remove('hidden');

        // Set amount
        const amountEl = document.getElementById('rewardAmountText');
        if (amountEl) amountEl.textContent = '$' + r.amount.toFixed(2);

        // Set congrats text
        const congratsEl = document.getElementById('rewardCongratsText');
        if (congratsEl) congratsEl.textContent = t('rewardCongrats');

        // Spawn effects
        spawnCoinBurst();
        spawnGoldParticles();

        // Update balance display
        const balEl = document.getElementById('balance');
        if (balEl && r.newBalance !== undefined) {
          balEl.textContent = '$' + Number(r.newBalance).toLocaleString('en', { minimumFractionDigits: 2 });
        }
      }, 600);

    } catch(e) {
      console.log('Claim error:', e);
      document.getElementById('rewardOverlay')?.classList.add('hidden');
      document.body.style.overflow = '';
    }
  });

  // Collect button
  document.getElementById('rewardCollectBtn')?.addEventListener('click', () => {
    const overlay = document.getElementById('rewardOverlay');
    if (overlay) {
      overlay.style.animation = 'rewardFadeIn 0.3s ease reverse';
      setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.style.animation = '';
        document.body.style.overflow = '';
      }, 300);
    }
  });

  // Check reward after user data loads
  const origHydrate = window._rewardHydrateHook;
  window._rewardHydrateHook = (user) => {
    if (origHydrate) origHydrate(user);
    setTimeout(checkReward, 1000);
  };

  // Also check on load if tg_id already set
  setTimeout(() => {
    if (state.tg_id) checkReward();
  }, 2000);
})();
