const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const Redis = require('ioredis');
require('dotenv').config();

const app = express();

// Redis client — single global instance (ioredis handles connection pooling internally)
const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  connectTimeout: 5000,
  commandTimeout: 3000,
  lazyConnect: false,
});

redis.on('connect', () => console.log('Redis connected'));
redis.on('error', (err) => console.error('Redis error:', err.message));

// Export for use in route handlers
module.exports.redis = redis;
module.exports.db = require('./services/db');

// Middleware
// First so even short-circuited responses (429s, errors) carry the headers.
const { securityHeaders } = require('./middleware/security-headers');
app.disable('x-powered-by');
app.use(securityHeaders);

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:4200',
  credentials: true,
}));
app.use(express.json());
// Request bodies here are flat: an object/array where a string belongs is the
// operator/object-injection vector (mysql2, Redis keys), so reject it at the door.
// ponytail: top-level only; give a route a schema if it ever needs nested JSON.
app.use((req, res, next) => {
  const b = req.body;
  if (Array.isArray(b) || b && typeof b === 'object' && Object.values(b).some(v => v !== null && typeof v === 'object')) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Body fields must be plain values.' });
  }
  next();
});
app.use(cookieParser());

// Rate limiting, before the routes so rejected traffic never reaches a handler.
// Mounted after cors() so 429 responses still carry CORS headers and the browser
// can read them instead of reporting an opaque network error.
const { createRateLimiter } = require('./middleware/rate-limit');
app.use(createRateLimiter(redis));

// Routes
const authRouter = require('./routes/auth');
app.use('/api/auth', authRouter);

const productsRouter = require('./routes/products');
app.use('/api', productsRouter);

const favoritesRouter = require('./routes/favorites');
app.use('/api', favoritesRouter);

const contactRouter = require('./routes/contact');
app.use('/api', contactRouter);

const storeHoursRouter = require('./routes/store-hours');
app.use('/api', storeHoursRouter);

// Central error handling: every error is JSON in the API's {error, error_description}
// shape — never Express's default HTML page (which includes a stack trace outside production).
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', error_description: 'Resource not found.' });
});
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('Unhandled error:', err);
  res.status(status).json(status >= 500
    ? { error: 'server_error', error_description: 'An internal error occurred.' }
    : { error: 'invalid_request', error_description: err.expose ? err.message : 'Bad request.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});