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
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:4200',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Routes
const authRouter = require('./routes/auth');
app.use('/api/auth', authRouter);

const productsRouter = require('./routes/products');
app.use('/api', productsRouter);

const favoritesRouter = require('./routes/favorites');
app.use('/api', favoritesRouter);

const contactRouter = require('./routes/contact');
app.use('/api', contactRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});