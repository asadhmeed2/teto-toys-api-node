const express = require('express');
const { db } = require('../server');
const router = express.Router();

// POST /contact — save a contact form submission (public, no auth required)
router.post('/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({
      error: 'validation_error',
      error_description: 'name, email, and message are required.',
    });
  }

  try {
    await db.execute(
      'INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)',
      [name.trim(), email.trim(), (subject || '').trim() || null, message.trim()]
    );

    return res.status(201).json({
      success: true,
      message: 'Thank you for reaching out! We will get back to you within 1–2 business days.',
    });
  } catch (err) {
    console.error('Contact form error:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: 'An internal error occurred.' });
  }
});

module.exports = router;
