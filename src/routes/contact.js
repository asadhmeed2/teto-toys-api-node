const express = require('express');
const { db } = require('../server');
const router = express.Router();

// ponytail: HTML-encode free-text fields so a submitted <script> tag is stored
// as inert text, protecting any future consumer (admin UI, email digest, etc.)
// that renders these values, regardless of whether that consumer remembers to encode.
const escapeHtml = (str) =>
  str.replace(/&/g, '&amp;')
     .replace(/</g, '&lt;')
     .replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;')
     .replace(/'/g, '&#39;');

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
      [
        escapeHtml(name.trim()),
        escapeHtml(email.trim()),
        (subject || '').trim() ? escapeHtml(subject.trim()) : null,
        escapeHtml(message.trim()),
      ]
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
