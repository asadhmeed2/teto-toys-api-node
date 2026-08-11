/**
 * Baseline response hardening.
 *
 * These are cheap and apply to every response. Note this is a JSON API, so the
 * headers that matter here are the ones limiting how a browser may *interpret* and
 * *embed* responses — a full CSP belongs on whatever serves the Angular bundles,
 * not here, since an API response has no scripts to restrict.
 *
 * Kept in sync with the C# and flask equivalents.
 */
function securityHeaders(req, res, next) {
  // Stop the browser second-guessing Content-Type. Without it, a JSON response
  // an attacker can influence may be sniffed as HTML and executed.
  res.set('X-Content-Type-Options', 'nosniff');

  // No reason to ever frame an API response; blocks clickjacking on any
  // HTML error page the stack might emit.
  res.set('X-Frame-Options', 'DENY');

  // Don't spill the full URL (which can carry ids or tokens) to third parties.
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // The API needs none of these device APIs; deny them explicitly.
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');

  res.set('X-Permitted-Cross-Domain-Policies', 'none');

  // HSTS tells browsers to refuse plain HTTP for this host. Production only —
  // on localhost it would pin the dev machine to HTTPS and break local work.
  if (process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Express advertises itself by default; no reason to name the stack.
  res.removeHeader('X-Powered-By');

  return next();
}

module.exports = { securityHeaders };
