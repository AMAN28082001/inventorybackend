import { Request, Response, NextFunction } from 'express';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const WINDOW_MS = Math.max(5_000, Number(process.env.MAPS_RATE_LIMIT_WINDOW_MS || 60_000));
const MAX_REQUESTS = Math.max(5, Number(process.env.MAPS_RATE_LIMIT_MAX || 60));

const clientKey = (req: Request): string => {
  const userId =
    req.user?.id ||
    (req as any).dealer?.id ||
    (req as any).visitor?.id ||
    (req as any).installationTeam?.id ||
    '';
  const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
  return userId ? `u:${userId}` : `ip:${ip}`;
};

/** Simple in-memory rate limit for Google Maps proxy endpoints. */
export const mapsRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  const key = clientKey(req);
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  const remaining = Math.max(0, MAX_REQUESTS - bucket.count);
  res.setHeader('X-RateLimit-Limit', String(MAX_REQUESTS));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > MAX_REQUESTS) {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_001',
        message: 'Too many map requests. Try again shortly.'
      }
    });
    return;
  }
  next();
};
