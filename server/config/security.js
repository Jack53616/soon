import helmet from "helmet";
import rateLimit from "express-rate-limit";

export const securityHeaders = helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
});

// Fixed: Add trust proxy configuration for Render
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true, // Enable trust proxy for Render
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/api/markets';
  }
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many login attempts, please try again later.",
  skipSuccessfulRequests: true,
  trustProxy: true,
});

export const withdrawLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: "Too many withdrawal requests, please try again later.",
  trustProxy: true,
});

export const sanitizeInput = (input) => {
  if (typeof input !== "string") return input;
  return input
    .replace(/[<>]/g, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+=/gi, "")
    .trim();
};

export const validateTelegramId = (tg_id) => {
  const id = Number(tg_id);
  return !isNaN(id) && id > 0 && id < 10000000000;
};

export const validateAmount = (amount) => {
  const num = Number(amount);
  return !isNaN(num) && num > 0 && num < 1000000;
};