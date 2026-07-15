const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { redis, db } = require('../server');
const { sendPasswordResetEmail } = require('../services/email');
const router = express.Router();

const BCRYPT_ROUNDS = 10;
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

function getSecret() {
  return process.env.JWT_SECRET || 'SuperSecretKeyForTetoToysTokenAuth2026';
}

function generateToken(userId, expireTime, tokenType = 'access', firstName, lastName, timezone) {
  const payload = {
    sub: userId,
    role: 'User',
    ...(tokenType === 'refresh' && { token_type: 'refresh' }),
    ...(firstName && { firstName }),
    ...(lastName && { lastName }),
    ...(tokenType === 'refresh' && timezone && { timezone }),
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
  const { email, password, timezone } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Email and password are required.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Password must be at least 8 characters.' });
  }

  try {
    // Look up user by email
    const [rows] = await db.execute('SELECT user_id, email, password_hash, is_active, first_name, last_name FROM users WHERE email = ?', [email]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'invalid_grant', error_description: 'Invalid email or password.' });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(401).json({ error: 'invalid_grant', error_description: 'Account is deactivated.' });
    }

    // Verify password against stored hash
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'invalid_grant', error_description: 'Invalid email or password.' });
    }

    // Update last_login timestamp
    await db.execute('UPDATE users SET last_login = NOW() WHERE user_id = ?', [user.user_id]);

    const accessToken = generateToken(user.user_id, '15m');
    const refreshToken = generateToken(user.user_id, '7d', 'refresh', user.first_name, user.last_name, timezone);

    // Store refresh token in Redis with 7-day TTL
    await redis.set(`refresh:${refreshToken}`, '1', 'EX', REFRESH_TOKEN_TTL);
    setRefreshCookie(res, refreshToken);

    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 900,
    });
  } catch (err) {
    console.error('Login DB error:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: 'An internal error occurred.' });
  }
});

// POST /refresh — issue a new access token from the existing refresh token
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.refresh_token;

  if (!refreshToken) {
    return res.status(401).json({ error: 'invalid_token', error_description: 'Missing or invalid refresh token.' });
  }

  const exists = await redis.exists(`refresh:${refreshToken}`);
  if (!exists) {
    return res.status(401).json({ error: 'invalid_token', error_description: 'Missing or invalid refresh token.' });
  }

  // Decode userId (token already validated via Redis store)
  let decoded;
  try {
    decoded = jwt.decode(refreshToken);
    if (!decoded?.sub) throw new Error('Missing sub claim');
  } catch {
    return res.status(401).json({ error: 'invalid_token', error_description: 'Malformed refresh token.' });
  }

  const newAccessToken = generateToken(decoded.sub, '15m');

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
router.get('/me', async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return res.status(401).json({ error: 'unauthorized', error_description: 'Missing or invalid Authorization header.' });
  }

  const token = authHeader.slice(7);
  let decoded;
  try {
    decoded = jwt.verify(token, getSecret(), {
      issuer: 'tatotoys-api',
      audience: 'tatotoys-frontend',
      algorithms: ['HS256'],
    });
  } catch {
    return res.status(401).json({ error: 'unauthorized', error_description: 'Token is invalid or expired.' });
  }

  // The refresh token carries first/last name — pull it from there for the full profile
  const refreshToken = req.cookies?.refresh_token;
  if (refreshToken && await redis.exists(`refresh:${refreshToken}`)) {
    try {
      const refreshDecoded = jwt.verify(refreshToken, getSecret(), {
        issuer: 'tatotoys-api',
        audience: 'tatotoys-frontend',
        algorithms: ['HS256'],
      });
      return res.json({
        userId: refreshDecoded.sub,
        role: refreshDecoded.role,
        firstName: refreshDecoded.firstName || '',
        lastName: refreshDecoded.lastName || '',
      });
    } catch {
      // fall through to access-token-only info
    }
  }

  return res.json({ userId: decoded.sub, role: decoded.role, firstName: '', lastName: '' });
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

  // --- Persist to MySQL ---
  const userId = uuidv4();
  const now = new Date();
  const termsVersion = '1.0';

  try {
    await db.execute(
      `INSERT INTO users (user_id, email, password_hash, first_name, last_name, is_adult, terms_accepted_at, terms_version, marketing_opt_in, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, email, passwordHash, first_name, last_name, true, now, termsVersion, !!marketing_opt_in, now]
    );
  } catch (err) {
    // MySQL duplicate-entry error code: ER_DUP_ENTRY
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'conflict', error_description: 'An account with this email already exists.' });
    }
    console.error('Register DB error:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: 'An internal error occurred.' });
  }

  return res.status(201).json({
    message: 'Account created successfully.',
    user: {
      user_id: userId,
      email,
      first_name,
      last_name,
      is_adult: true,
      terms_accepted_at: now.toISOString(),
      terms_version: termsVersion,
      marketing_opt_in: !!marketing_opt_in,
      created_at: now.toISOString(),
    },
  });
});

// POST /forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Email is required.' });
  }

  try {
    const [rows] = await db.execute(
      'SELECT user_id, email, is_active FROM users WHERE email = ?',
      [email.trim()]
    );

    // Always return 200 to prevent user enumeration
    if (rows.length > 0 && rows[0].is_active) {
      const user = rows[0];
      const token = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
      const RESET_TTL = 15 * 60; // 15 minutes

      await redis.set(`reset:${token}`, user.user_id, 'EX', RESET_TTL);

      const frontendBaseUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:4200';
      const resetLink = `${frontendBaseUrl}/reset-password?token=${token}`;
      await sendPasswordResetEmail(user.email, resetLink);
    }

    return res.json({ message: "If an account with that email exists, a password reset link has been sent." });
  } catch (err) {
    console.error('ForgotPassword error:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: 'An internal error occurred.' });
  }
});

// POST /reset-password
router.post('/reset-password', async (req, res) => {
  const { token, new_password, confirm_password } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Token is required.' });
  }
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Password must be at least 8 characters.' });
  }
  if (new_password !== confirm_password) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Passwords do not match.' });
  }

  try {
    const userId = await redis.get(`reset:${token}`);
    if (!userId) {
      return res.status(400).json({ error: 'invalid_token', error_description: 'Reset token is invalid or has expired.' });
    }

    await redis.del(`reset:${token}`);

    const passwordHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
    await db.execute('UPDATE users SET password_hash = ? WHERE user_id = ?', [passwordHash, userId]);

    return res.json({ message: 'Password has been reset successfully.' });
  } catch (err) {
    console.error('ResetPassword error:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: 'An internal error occurred.' });
  }
});

module.exports = router;
