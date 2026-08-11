/**
 * Per-account failed-login throttle, counted in Redis.
 *
 * The IP rate limiter caps how fast any one host can call the API; this caps how
 * many times a *specific account* may be guessed, no matter how many hosts try.
 * The two are complementary: distributed credential stuffing spreads across IPs
 * but still converges on one email.
 *
 * The counter is keyed by a hash of the email, not the email itself, so Redis
 * never holds a plaintext list of who has been attacked.
 *
 * Key format matches the other backends: login_fail:{service}:{emailHash}
 */

const crypto = require('crypto');

const SERVICE = process.env.LOGIN_LOCKOUT_SERVICE || 'storefront-node';
const MAX_ATTEMPTS = parseInt(process.env.LOGIN_LOCKOUT_MAX_ATTEMPTS || '5', 10);
const LOCKOUT_SECONDS = parseInt(process.env.LOGIN_LOCKOUT_SECONDS || '900', 10);

function keyFor(email) {
  const normalized = String(email).trim().toLowerCase();
  // Truncated: 96 bits is ample to avoid collisions and keeps the key short.
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
  return `login_fail:${SERVICE}:${hash}`;
}

/**
 * Seconds remaining on the lockout, or 0 when the account may attempt a login.
 * Fails open — a Redis outage must not lock everyone out.
 */
async function getLockoutRemaining(redis, email) {
  if (!redis || !email) return 0;
  try {
    const key = keyFor(email);
    const attempts = parseInt((await redis.get(key)) || '0', 10);
    if (attempts < MAX_ATTEMPTS) return 0;

    const ttl = await redis.ttl(key);
    return ttl > 0 ? ttl : LOCKOUT_SECONDS;
  } catch (err) {
    console.error('Login lockout check failed, allowing attempt:', err.message);
    return 0;
  }
}

/**
 * Records a failed attempt. The TTL is set on the first failure and not extended
 * afterwards, so the window is "N failures within LOCKOUT_SECONDS" rather than a
 * lockout a persistent attacker can keep alive indefinitely.
 */
async function recordFailure(redis, email) {
  if (!redis || !email) return;
  try {
    const key = keyFor(email);
    const attempts = await redis.incr(key);
    if (attempts === 1) await redis.expire(key, LOCKOUT_SECONDS);
  } catch (err) {
    // Best effort — never block a login because the counter couldn't be written.
    console.error('Login failure counter write failed:', err.message);
  }
}

/** Clears the counter after a successful login. */
async function resetAttempts(redis, email) {
  if (!redis || !email) return;
  try {
    await redis.del(keyFor(email));
  } catch {
    // Best effort.
  }
}

module.exports = { getLockoutRemaining, recordFailure, resetAttempts };
