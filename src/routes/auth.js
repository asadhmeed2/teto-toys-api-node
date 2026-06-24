const express = require('express');
const crypto = require('crypto');
const router = express.Router();

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
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signatureInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signatureInput}.${signature}`;
}

// Routes
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Email and password are required.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Password must be at least 8 characters.' });
  }

  if (email === 'admin@tetotoys.com' && password === 'password123') {
    const payload = {
      sub: email,
      email: email,
      exp: Math.floor(Date.now() / 1000) + 3600
    };

    const secret = process.env.JWT_SECRET || 'SuperSecretKeyForTetoToysTokenAuth2026';
    const token = generateJWT(payload, secret);

    return res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600
    });
  }

  return res.status(401).json({ error: 'invalid_grant', error_description: 'Invalid email or password.' });
});

router.post('/logout', (req, res) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return res.status(401).json({ error: 'unauthorized', error_description: 'Missing or invalid authorization header.' });
  }

  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
