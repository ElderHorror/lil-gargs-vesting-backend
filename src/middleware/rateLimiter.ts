import { Request, Response, NextFunction } from 'express';

/**
 * Simple in-memory rate limiter
 * For production, use Redis-based rate limiting
 */

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  Object.keys(store).forEach(key => {
    if (store[key].resetTime < now) {
      delete store[key];
    }
  });
}, 5 * 60 * 1000);

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}) {
  const {
    windowMs,
    max,
    message = 'Too many requests, please try again later.',
    keyGenerator = (req) => req.ip || 'unknown',
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator(req);
    const now = Date.now();

    if (!store[key] || store[key].resetTime < now) {
      // New window
      store[key] = {
        count: 1,
        resetTime: now + windowMs,
      };
      return next();
    }

    if (store[key].count < max) {
      // Within limit
      store[key].count++;
      return next();
    }

    // Rate limit exceeded
    const retryAfter = Math.ceil((store[key].resetTime - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      error: message,
      retryAfter,
    });
  };
}

// Preset rate limiters
export const strictRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: 'Too many requests from this IP, please try again later.',
});

export const moderateRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per window
});

export const apiRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
});

// Admin-specific rate limiter (by wallet address)
export const adminRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 admin operations per window
  keyGenerator: (req) => {
    const adminWallet = req.body?.adminWallet || req.query?.adminWallet;
    return adminWallet ? `admin:${adminWallet}` : `ip:${req.ip}`;
  },
  message: 'Too many admin operations, please try again later.',
});

// Claim-specific rate limiter (by user wallet)
// Max 1 claim per wallet per 10 seconds to prevent accidental double-claims
export const claimRateLimiter = createRateLimiter({
  windowMs: 10 * 1000, // 10 seconds
  max: 1, // 1 claim per window
  keyGenerator: (req) => {
    const userWallet = req.body?.userWallet;
    return userWallet ? `claim:${userWallet}` : `ip:${req.ip}`;
  },
  message: 'Please wait 10 seconds before claiming again.',
});
