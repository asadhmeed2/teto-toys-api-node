const express = require('express');
const { db } = require('../server');
const router = express.Router();

// ponytail: GET /products (public storefront endpoint)
router.get('/products', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const search = req.query.search || '';
  const category = req.query.category || 'All';
  const lang = req.query.lang || 'en';
  const offset = (page - 1) * pageSize;

  try {
    // Double LEFT JOIN product_translations resolves requested-language text with
    // an 'en' fallback; the count query needs the same joins since the search
    // filter matches translated text.
    let countSql = `SELECT COUNT(1) AS count FROM products p
      LEFT JOIN product_translations req ON req.product_id = p.product_id AND req.language_code = ?
      LEFT JOIN product_translations fb ON fb.product_id = p.product_id AND fb.language_code = 'en'
      WHERE p.is_deleted = 0 AND p.is_displayed = 1`;
    let itemsSql = `SELECT p.product_id,
        COALESCE(req.title, fb.title) AS title,
        COALESCE(req.subtitle, fb.subtitle) AS subtitle,
        COALESCE(req.description, fb.description) AS description,
        p.category, p.subcategory, p.price, p.image_urls
      FROM products p
      LEFT JOIN product_translations req ON req.product_id = p.product_id AND req.language_code = ?
      LEFT JOIN product_translations fb ON fb.product_id = p.product_id AND fb.language_code = 'en'
      WHERE p.is_deleted = 0 AND p.is_displayed = 1`;
    let params = [lang];

    const filterByCategory = category !== 'All' && !isNaN(parseInt(category));
    if (filterByCategory) {
      countSql += ' AND p.category = ?';
      itemsSql += ' AND p.category = ?';
      params.push(parseInt(category));
    }

    if (search) {
      countSql += ' AND (COALESCE(req.title, fb.title) LIKE ? OR COALESCE(req.description, fb.description) LIKE ?)';
      itemsSql += ' AND (COALESCE(req.title, fb.title) LIKE ? OR COALESCE(req.description, fb.description) LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    itemsSql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
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
  const lang = req.query.lang || 'en';
  const offset = (page - 1) * pageSize;

  try {
    let countSql = `SELECT COUNT(1) AS count FROM parts pa
      LEFT JOIN part_translations req ON req.part_id = pa.part_id AND req.language_code = ?
      LEFT JOIN part_translations fb ON fb.part_id = pa.part_id AND fb.language_code = 'en'`;
    let itemsSql = `SELECT pa.part_id,
        COALESCE(req.title, fb.title) AS title,
        COALESCE(req.description, fb.description) AS description,
        pa.price, pa.image_urls
      FROM parts pa
      LEFT JOIN part_translations req ON req.part_id = pa.part_id AND req.language_code = ?
      LEFT JOIN part_translations fb ON fb.part_id = pa.part_id AND fb.language_code = 'en'`;
    let params = [lang];

    if (search) {
      const searchClause = ' WHERE (COALESCE(req.title, fb.title) LIKE ? OR COALESCE(req.description, fb.description) LIKE ?)';
      countSql += searchClause;
      itemsSql += searchClause;
      params.push(`%${search}%`, `%${search}%`);
    }

    itemsSql += ' ORDER BY pa.created_at DESC LIMIT ? OFFSET ?';
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
  const lang = req.query.lang || 'en';
  try {
    const itemsSql = `SELECT c.id, COALESCE(req.name, fb.name) AS name, c.slug
      FROM categories c
      LEFT JOIN category_translations req ON req.category_id = c.id AND req.language_code = ?
      LEFT JOIN category_translations fb ON fb.category_id = c.id AND fb.language_code = 'en'
      WHERE c.number_of_active_products > 0
      ORDER BY name ASC`;
    const [rows] = await db.execute(itemsSql, [lang]);
    return res.json(rows);
  } catch (err) {
    console.error('Fetch categories error:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: 'An internal error occurred.' });
  }
});

// ponytail: GET /languages (public lookup for the storefront language selector)
router.get('/languages', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT code, name, is_rtl FROM system_languages ORDER BY code ASC');
    return res.json(rows.map(r => ({ code: r.code, name: r.name, is_rtl: !!r.is_rtl })));
  } catch (err) {
    console.error('Fetch languages error:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: 'An internal error occurred.' });
  }
});

module.exports = router;
