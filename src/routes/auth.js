const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// In-memory refresh token store (resets on restart; swap for Redis/DB in production)
const refreshTokenStore = new Set();

// JWT Utility
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function generateJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}

function getSecret() {
  return process.env.JWT_SECRET || 'SuperSecretKeyForTetoToysTokenAuth2026';
}

function setRefreshCookie(res, token) {
  res.cookie('refresh_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    path: '/',
  });
}

// POST /login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Email and password are required.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Password must be at least 8 characters.' });
  }

  if (email === 'admin@tetotoys.com' && password === 'password123') {
    const secret = getSecret();

    // Short-lived access token (15 minutes)
    const accessPayload = {
      sub: email,
      email: email,
      exp: Math.floor(Date.now() / 1000) + 15 * 60,
    };
    const accessToken = generateJWT(accessPayload, secret);

    // Long-lived refresh token (7 days)
    const refreshPayload = {
      sub: email,
      email: email,
      type: 'refresh',
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    };
    const refreshToken = generateJWT(refreshPayload, secret);
    refreshTokenStore.add(refreshToken);

    setRefreshCookie(res, refreshToken);

    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 900,
    });
  }

  return res.status(401).json({ error: 'invalid_grant', error_description: 'Invalid email or password.' });
});

// POST /refresh
router.post('/refresh', (req, res) => {
  const refreshToken = req.cookies?.refresh_token;

  if (!refreshToken || !refreshTokenStore.has(refreshToken)) {
    return res.status(401).json({ error: 'invalid_token', error_description: 'Missing or invalid refresh token.' });
  }

  // Rotate: invalidate old token and issue new ones
  refreshTokenStore.delete(refreshToken);

  const secret = getSecret();

  // Decode email from old refresh token (simple base64 decode — not verified here for brevity)
  let email;
  try {
    const payloadPart = refreshToken.split('.')[1];
    const padding = (4 - (payloadPart.length % 4)) % 4;
    const padded = payloadPart + '='.repeat(padding);
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    email = decoded.email;
  } catch {
    return res.status(401).json({ error: 'invalid_token', error_description: 'Malformed refresh token.' });
  }

  const newAccessPayload = {
    sub: email,
    email: email,
    exp: Math.floor(Date.now() / 1000) + 15 * 60,
  };
  const newAccessToken = generateJWT(newAccessPayload, secret);

  const newRefreshPayload = {
    sub: email,
    email: email,
    type: 'refresh',
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  };
  const newRefreshToken = generateJWT(newRefreshPayload, secret);
  refreshTokenStore.add(newRefreshToken);

  setRefreshCookie(res, newRefreshToken);

  return res.json({
    access_token: newAccessToken,
    token_type: 'Bearer',
    expires_in: 900,
  });
});

// POST /logout
router.post('/logout', (req, res) => {
  const refreshToken = req.cookies?.refresh_token;
  if (refreshToken) {
    refreshTokenStore.delete(refreshToken);
  }
  res.clearCookie('refresh_token', { path: '/' });
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
