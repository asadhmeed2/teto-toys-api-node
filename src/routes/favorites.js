const express = require('express');
const jwt = require('jsonwebtoken');
const { db } = require('../server');
const router = express.Router();

function getSecret() {
  return process.env.JWT_SECRET || 'SuperSecretKeyForTetoToysTokenAuth2026';
}

/** Validate Bearer token and return the userId, or null on failure. */
function extractUserId(req, res) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    res.status(401).json({ error: 'unauthorized', error_description: 'Missing or invalid Authorization header.' });
    return null;
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, getSecret(), {
      issuer: 'tatotoys-api',
      audience: 'tatotoys-frontend',
      algorithms: ['HS256'],
    });
    return decoded.sub;
  } catch {
    res.status(401).json({ error: 'unauthorized', error_description: 'Token is invalid or expired.' });
    return null;
  }
}

// GET /favorites — list authenticated user's favourite products
router.get('/favorites', async (req, res) => {
  const userId = extractUserId(req, res);
  if (!userId) return;

  try {
    const sql = `
      SELECT p.product_id, p.title, p.subtitle, p.description,
             p.category, p.subcategory, p.price, p.image_urls
      FROM favorites_products f
      JOIN products p ON p.product_id = f.product_id
      WHERE f.user_id = ?
        AND p.is_deleted = 0
        AND p.is_displayed = 1
      ORDER BY f.created_at DESC`;

    const [rows] = await db.execute(sql, [userId]);

    const items = rows.map(row => ({
      product_id: row.product_id,
      title: row.title,
      subtitle: row.subtitle,
      description: row.description,
      category: row.category,
      subcategory: row.subcategory,
      price: parseFloat(row.price),
      image_urls: row.image_urls
        ? (typeof row.image_urls === 'string' ? JSON.parse(row.image_urls) : row.image_urls)
        : [],
    }));

    return res.json({ items });
  } catch (err) {
    console.error('Fetch favorites error:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: 'An internal error occurred.' });
  }
});

// GET /favorites/ids — return only favorite product IDs for the authenticated user
router.get('/favorites/ids', async (req, res) => {
  const userId = extractUserId(req, res);
  if (!userId) return;

  try {
    const [rows] = await db.execute(
      'SELECT product_id FROM favorites_products WHERE user_id = ?',
      [userId]
    );
    const ids = rows.map(r => r.product_id);
    return res.json({ ids });
  } catch (err) {
    console.error('Fetch favorite IDs error:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: 'An internal error occurred.' });
  }
});

// POST /favorites/:productId — add product to favorites
router.post('/favorites/:productId', async (req, res) => {
  const userId = extractUserId(req, res);
  if (!userId) return;

  const { productId } = req.params;

  try {
    // Check product exists and is visible
    const [check] = await db.execute(
      'SELECT COUNT(1) AS count FROM products WHERE product_id = ? AND is_deleted = 0 AND is_displayed = 1',
      [productId]
    );
    if (check[0].count === 0) {
      return res.status(404).json({ error: 'not_found', error_description: 'Product not found.' });
    }

    // INSERT IGNORE silently skips duplicates
    await db.execute(
      'INSERT IGNORE INTO favorites_products (user_id, product_id) VALUES (?, ?)',
      [userId, productId]
    );

    return res.json({ product_id: productId, is_favorite: true });
  } catch (err) {
    console.error('Add favorite error:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: 'An internal error occurred.' });
  }
});

// DELETE /favorites/:productId — remove product from favorites
router.delete('/favorites/:productId', async (req, res) => {
  const userId = extractUserId(req, res);
  if (!userId) return;

  const { productId } = req.params;

  try {
    await db.execute(
      'DELETE FROM favorites_products WHERE user_id = ? AND product_id = ?',
      [userId, productId]
    );
    return res.json({ product_id: productId, is_favorite: false });
  } catch (err) {
    console.error('Remove favorite error:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: 'An internal error occurred.' });
  }
});

module.exports = router;
