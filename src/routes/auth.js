const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { redis } = require('../server');
const router = express.Router();

const BCRYPT_ROUNDS = 10;
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

function getSecret() {
  return process.env.JWT_SECRET || 'SuperSecretKeyForTetoToysTokenAuth2026';
}

function generateToken(email, expireTime, tokenType = 'access') {
  const payload = {
    sub: email,
    email: email,
    role: 'User',
    ...(tokenType === 'refresh' && { token_type: 'refresh' }),
  };

  return jwt.sign(payload, getSecret(), {
    expiresIn: expireTime,
    issuer: 'tatotoys-api',
    audience: 'tatotoys-frontend',
    algorithm: 'HS256',
  });
}

function setRefreshCookie(res, token) {
  res.cookie('refresh_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: REFRESH_TOKEN_TTL * 1000, // ms
    path: '/',
  });
}

// POST /login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Email and password are required.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Password must be at least 8 characters.' });
  }

  if (email === 'admin@tetotoys.com' && password === 'password123') {
    const accessToken = generateToken(email, '15m');
    const refreshToken = generateToken(email, '7d', 'refresh');

    // Store refresh token in Redis with 7-day TTL
    await redis.set(`refresh:${refreshToken}`, '1', 'EX', REFRESH_TOKEN_TTL);
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
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.refresh_token;

  if (!refreshToken) {
    return res.status(401).json({ error: 'invalid_token', error_description: 'Missing or invalid refresh token.' });
  }

  const exists = await redis.exists(`refresh:${refreshToken}`);
  if (!exists) {
    return res.status(401).json({ error: 'invalid_token', error_description: 'Missing or invalid refresh token.' });
  }

  // Rotate: invalidate old token
  await redis.del(`refresh:${refreshToken}`);

  // Decode email (token already validated via Redis store)
  let email;
  try {
    const decoded = jwt.decode(refreshToken);
    if (!decoded?.email) throw new Error('Missing email claim');
    email = decoded.email;
  } catch {
    return res.status(401).json({ error: 'invalid_token', error_description: 'Malformed refresh token.' });
  }

  const newAccessToken = generateToken(email, '15m');
  const newRefreshToken = generateToken(email, '7d', 'refresh');

  await redis.set(`refresh:${newRefreshToken}`, '1', 'EX', REFRESH_TOKEN_TTL);
  setRefreshCookie(res, newRefreshToken);

  return res.json({
    access_token: newAccessToken,
    token_type: 'Bearer',
    expires_in: 900,
  });
});

// POST /logout
router.post('/logout', async (req, res) => {
  const refreshToken = req.cookies?.refresh_token;
  if (refreshToken) {
    await redis.del(`refresh:${refreshToken}`);
  }
  res.clearCookie('refresh_token', { path: '/' });
  res.json({ message: 'Logged out successfully' });
});

// GET /me — validate access token and return the current user's info
router.get('/me', (req, res) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return res.status(401).json({ error: 'unauthorized', error_description: 'Missing or invalid Authorization header.' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, getSecret(), {
      issuer: 'tatotoys-api',
      audience: 'tatotoys-frontend',
      algorithms: ['HS256'],
    });
    return res.json({ email: decoded.email, role: decoded.role });
  } catch {
    return res.status(401).json({ error: 'unauthorized', error_description: 'Token is invalid or expired.' });
  }
});

// POST /register
router.post('/register', async (req, res) => {
  const { first_name, last_name, email, password, confirm_password, is_adult, terms_accepted, marketing_opt_in } = req.body;

  // --- Required field checks ---
  if (!first_name || !last_name || !email || !password || !confirm_password) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'All fields are required.' });
  }

  // --- Email format validation ---
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Please enter a valid email address.' });
  }

  // --- Password strength ---
  if (password.length < 8) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Password must be at least 8 characters.' });
  }

  // --- Passwords match ---
  if (password !== confirm_password) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Passwords do not match.' });
  }

  // --- Compliance checks ---
  if (!is_adult) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'You must confirm that you are 18 years or older.' });
  }

  if (!terms_accepted) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'You must accept the Terms of Service and Privacy Policy.' });
  }

  // --- Hash password ---
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // --- Stub response (no DB yet) ---
  const userId = uuidv4();
  const now = new Date().toISOString();

  return res.status(201).json({
    message: 'Account created successfully.',
    user: {
      user_id: userId,
      email,
      first_name,
      last_name,
      is_adult: true,
      terms_accepted_at: now,
      terms_version: '1.0',
      marketing_opt_in: !!marketing_opt_in,
      created_at: now,
    },
  });
});

module.exports = router;
