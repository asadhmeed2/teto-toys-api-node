/**
 * Per-IP token bucket, held in Redis so every instance shares one budget.
 *
 * Each client gets a bucket of RATE_LIMIT_*_BURST tokens that refills continuously
 * at limit/window tokens per second. A request spends one token; if the bucket is
 * empty the request is rejected.
 *
 * Chosen over a fixed window because a fixed window lets a client spend its whole
 * budget at the end of one window and again at the start of the next — a 2x burst at
 * the boundary. A bucket smooths that out: burst size is capped by capacity and the
 * long-run average can never exceed the refill rate.
 *
 * Key format matches the other backends: ratelimit:{service}:{scope}:{ip}
 */

const SERVICE_NAME = process.env.RATE_LIMIT_SERVICE || 'storefront-node';

const ENABLED = process.env.RATE_LIMIT_ENABLED !== 'false';

// Sustained rate: LIMIT tokens per WINDOW seconds. BURST is the bucket capacity
// (largest instantaneous burst) and defaults to the limit.
const GLOBAL_LIMIT = parseInt(process.env.RATE_LIMIT_GLOBAL || '100', 10);
const GLOBAL_WINDOW = parseInt(process.env.RATE_LIMIT_GLOBAL_WINDOW || '60', 10);
const GLOBAL_BURST = parseInt(process.env.RATE_LIMIT_GLOBAL_BURST || String(GLOBAL_LIMIT), 10);

// Login/refresh/register/reset are what actually get brute-forced.
const AUTH_LIMIT = parseInt(process.env.RATE_LIMIT_AUTH || '10', 10);
const AUTH_WINDOW = parseInt(process.env.RATE_LIMIT_AUTH_WINDOW || '60', 10);
const AUTH_BURST = parseInt(process.env.RATE_LIMIT_AUTH_BURST || String(AUTH_LIMIT), 10);

const STRICT_PREFIXES = (process.env.RATE_LIMIT_STRICT_PREFIXES || '/api/auth')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

/**
 * X-Forwarded-For is client-settable, so only trust it behind a proxy you control —
 * otherwise anyone can forge an identity and sidestep the limit entirely.
 */
const TRUST_FORWARDED = process.env.RATE_LIMIT_TRUST_PROXY === 'true';

/**
 * Token bucket, evaluated atomically so concurrent requests can't both read the
 * same token count and each decide they may proceed.
 *
 * Time comes from redis.call('TIME'), not the caller: instances may have skewed
 * clocks, and the bucket must advance on a single shared timeline. Safe to
 * replicate since Redis 5 propagates script *effects* rather than the script.
 *
 * Must stay byte-identical to the C# and flask copies so all services agree.
 */
const TOKEN_BUCKET_SCRIPT = `
local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill   = tonumber(ARGV[2])
local wanted   = tonumber(ARGV[3])

local t   = redis.call('TIME')
local now = tonumber(t[1]) + (tonumber(t[2]) / 1000000)

local bucket = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts     = tonumber(bucket[2])

if tokens == nil or ts == nil then
  tokens = capacity
  ts     = now
end

local elapsed = now - ts
if elapsed > 0 then
  tokens = math.min(capacity, tokens + (elapsed * refill))
end

local allowed = 0
if tokens >= wanted then
  tokens  = tokens - wanted
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
-- Reclaim idle buckets once they would have refilled completely.
redis.call('EXPIRE', key, math.ceil(capacity / refill) + 1)

local retry = 0
if allowed == 0 then
  retry = math.ceil((wanted - tokens) / refill)
end

return { allowed, math.floor(tokens), retry }
`;

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
  // defineCommand registers the script once and calls it via EVALSHA, falling back
  // to EVAL automatically if the server has forgotten it (e.g. after SCRIPT FLUSH).
  if (redis && typeof redis.defineCommand === 'function' && !redis.tokenBucket) {
    redis.defineCommand('tokenBucket', { numberOfKeys: 1, lua: TOKEN_BUCKET_SCRIPT });
  }

  return async function rateLimit(req, res, next) {
    // CORS preflights are issued by the browser, not the caller — charging them
    // would halve every cross-origin client's effective budget.
    if (!ENABLED || !redis || req.method === 'OPTIONS') return next();

    const path = req.originalUrl || req.url || '';
    const isStrict = STRICT_PREFIXES.some((prefix) => path.startsWith(prefix));

    const limit = isStrict ? AUTH_LIMIT : GLOBAL_LIMIT;
    const window = Math.max(1, isStrict ? AUTH_WINDOW : GLOBAL_WINDOW);
    const capacity = Math.max(1, isStrict ? AUTH_BURST : GLOBAL_BURST);
    const scope = isStrict ? 'auth' : 'global';

    // Tokens per second. Guarded so a misconfigured 0 limit can't divide by zero.
    const refillPerSecond = Math.max(0.0001, limit / window);
    const key = `ratelimit:${SERVICE_NAME}:${scope}:${resolveClientId(req)}`;

    let allowed;
    let remaining;
    let retryAfter;

    try {
      const [allowedFlag, tokensLeft, retry] = await redis.tokenBucket(
        key,
        capacity,
        refillPerSecond,
        1,
      );
      allowed = Number(allowedFlag) === 1;
      remaining = Number(tokensLeft);
      retryAfter = Math.max(1, Number(retry));
    } catch (err) {
      // Fail open. A Redis outage must degrade to "unlimited", never to "down".
      console.error('Rate limit check failed, allowing request:', err.message);
      return next();
    }

    res.set('X-RateLimit-Limit', String(capacity));
    res.set('X-RateLimit-Remaining', String(Math.max(0, remaining)));

    if (!allowed) {
      res.set('Retry-After', String(retryAfter));
      res.set('X-RateLimit-Reset', String(retryAfter));
      return res.status(429).json({
        error: 'rate_limited',
        error_description: `Too many requests. Please try again in ${retryAfter} seconds.`,
      });
    }

    return next();
  };
}

module.exports = { createRateLimiter, TOKEN_BUCKET_SCRIPT };
