const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'asadhmeed1@gmail.com';

/**
 * Send a password reset email via Resend.
 * @param {string} toEmail
 * @param {string} resetLink
 */
async function sendPasswordResetEmail(toEmail, resetLink) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [toEmail],
      subject: 'Reset your TatoToys password',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
          <h2 style="color: #0f172a; margin-bottom: 8px;">Reset your password</h2>
          <p style="color: #475569; margin-bottom: 24px;">
            We received a request to reset your TatoToys account password.
            Click the button below to choose a new one. This link expires in <strong>15 minutes</strong>.
          </p>
          <a href="${resetLink}"
             style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #08b880, #00d4aa);
                    color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
            Reset Password
          </a>
          <p style="color: #94a3b8; font-size: 13px; margin-top: 24px;">
            If you didn't request a password reset, you can safely ignore this email.
          </p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API error ${response.status}: ${body}`);
  }
}

module.exports = { sendPasswordResetEmail };
