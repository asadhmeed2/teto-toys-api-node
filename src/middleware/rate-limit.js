/**
 * Per-IP request limits, counted in Redis so every instance shares one budget.
 *
 * Fixed-window counter: INCR a key named for the current window, set its TTL on
 * first hit, reject once the count exceeds the limit. Cheap (one round trip) and
 * good enough to stop floods and credential stuffing. The trade-off versus a
 * sliding window is burstiness at window boundaries — a client can spend its full
 * budget at the end of one window and again at the start of the next.
 *
 * Key format matches the other backends: ratelimit:{service}:{scope}:{ip}:{window}
 */

const SERVICE_NAME = process.env.RATE_LIMIT_SERVICE || 'storefront-node';

const ENABLED = process.env.RATE_LIMIT_ENABLED !== 'false';
const GLOBAL_LIMIT = parseInt(process.env.RATE_LIMIT_GLOBAL || '100', 10);
const GLOBAL_WINDOW = parseInt(process.env.RATE_LIMIT_GLOBAL_WINDOW || '60', 10);
// Login/refresh/register/reset are what actually get brute-forced.
const AUTH_LIMIT = parseInt(process.env.RATE_LIMIT_AUTH || '10', 10);
const AUTH_WINDOW = parseInt(process.env.RATE_LIMIT_AUTH_WINDOW || '60', 10);

const STRICT_PREFIXES = (process.env.RATE_LIMIT_STRICT_PREFIXES || '/api/auth')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

/**
 * X-Forwarded-For is client-settable, so only trust it behind a proxy you control —
 * otherwise anyone can forge an identity and sidestep the limit entirely.
 */
const TRUST_FORWARDED = process.env.RATE_LIMIT_TRUST_PROXY === 'true';

function resolveClientId(req) {
  if (TRUST_FORWARDED) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * @param {import('ioredis').Redis} redis
 */
function createRateLimiter(redis) {
  return async function rateLimit(req, res, next) {
    // CORS preflights are issued by the browser, not the caller — charging them
    // would halve every cross-origin client's effective budget.
    if (!ENABLED || !redis || req.method === 'OPTIONS') return next();

    const path = req.originalUrl || req.url || '';
    const isStrict = STRICT_PREFIXES.some((prefix) => path.startsWith(prefix));

    const limit = isStrict ? AUTH_LIMIT : GLOBAL_LIMIT;
    const window = Math.max(1, isStrict ? AUTH_WINDOW : GLOBAL_WINDOW);
    const scope = isStrict ? 'auth' : 'global';

    const now = Math.floor(Date.now() / 1000);
    const windowIndex = Math.floor(now / window);
    const key = `ratelimit:${SERVICE_NAME}:${scope}:${resolveClientId(req)}:${windowIndex}`;

    let count;
    try {
      count = await redis.incr(key);
      // Only the request that created the key sets the TTL, so the window
      // doesn't slide forward on every hit.
      if (count === 1) await redis.expire(key, window);
    } catch (err) {
      // Fail open. A Redis outage must degrade to "unlimited", never to "down".
      console.error('Rate limit check failed, allowing request:', err.message);
      return next();
    }

    const resetSeconds = Math.max(1, (windowIndex + 1) * window - now);

    res.set('X-RateLimit-Limit', String(limit));
    res.set('X-RateLimit-Remaining', String(Math.max(0, limit - count)));
    res.set('X-RateLimit-Reset', String(resetSeconds));

    if (count > limit) {
      res.set('Retry-After', String(resetSeconds));
      return res.status(429).json({
        error: 'rate_limited',
        error_description: `Too many requests. Please try again in ${resetSeconds} seconds.`,
      });
    }

    return next();
  };
}

module.exports = { createRateLimiter };
