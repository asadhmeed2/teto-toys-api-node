const express = require('express');
const { db } = require('../server');
const router = express.Router();

// ponytail: GET /products (public storefront endpoint)
router.get('/products', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const search = req.query.search || '';
  const offset = (page - 1) * pageSize;

  try {
    let countSql = 'SELECT COUNT(1) AS count FROM products';
    let itemsSql = 'SELECT product_id, title, subtitle, description, category, subcategory, price, image_urls FROM products';
    let params = [];

    if (search) {
      countSql += ' WHERE title LIKE ? OR description LIKE ?';
      itemsSql += ' WHERE title LIKE ? OR description LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    itemsSql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    const itemsParams = [...params, pageSize, offset];

    const [countRows] = await db.execute(countSql, params);
    const totalCount = countRows[0].count;

    const [itemsRows] = await db.execute(itemsSql, itemsParams);

    const items = itemsRows.map(row => ({
      product_id: row.product_id,
      title: row.title,
      subtitle: row.subtitle,
      description: row.description,
      category: row.category,
      subcategory: row.subcategory,
      price: parseFloat(row.price),
      image_urls: row.image_urls ? (typeof row.image_urls === 'string' ? JSON.parse(row.image_urls) : row.image_urls) : []
    }));

    const totalPages = Math.ceil(totalCount / pageSize);

    return res.json({
      items,
      total_count: totalCount,
      page,
      page_size: pageSize,
      total_pages: totalPages
    });
  } catch (err) {
    console.error('Fetch products error:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: 'An internal error occurred.' });
  }
});

// ponytail: GET /parts (public storefront endpoint)
router.get('/parts', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const search = req.query.search || '';
  const offset = (page - 1) * pageSize;

  try {
    let countSql = 'SELECT COUNT(1) AS count FROM parts';
    let itemsSql = 'SELECT part_id, title, description, price, image_urls FROM parts';
    let params = [];

    if (search) {
      countSql += ' WHERE title LIKE ? OR description LIKE ?';
      itemsSql += ' WHERE title LIKE ? OR description LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    itemsSql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    const itemsParams = [...params, pageSize, offset];

    const [countRows] = await db.execute(countSql, params);
    const totalCount = countRows[0].count;

    const [itemsRows] = await db.execute(itemsSql, itemsParams);

    const items = itemsRows.map(row => ({
      part_id: row.part_id,
      title: row.title,
      description: row.description,
      price: parseFloat(row.price),
      image_urls: row.image_urls ? (typeof row.image_urls === 'string' ? JSON.parse(row.image_urls) : row.image_urls) : []
    }));

    const totalPages = Math.ceil(totalCount / pageSize);

    return res.json({
      items,
      total_count: totalCount,
      page,
      page_size: pageSize,
      total_pages: totalPages
    });
  } catch (err) {
    console.error('Fetch parts error:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: 'An internal error occurred.' });
  }
});
// ponytail: GET /categories (public storefront endpoint)
router.get('/categories', async (req, res) => {
  try {
    const itemsSql = 'SELECT id, name, slug FROM categories ORDER BY name ASC';
    const [rows] = await db.execute(itemsSql);
    return res.json(rows);
  } catch (err) {
    console.error('Fetch categories error:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: 'An internal error occurred.' });
  }
});

module.exports = router;
