// Key extraction logic from original app.js
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

export const extractKeyCandidates = (raw = "") => {
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