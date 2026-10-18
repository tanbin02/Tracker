/* Client for the Hisab Khata Google Apps Script web app (Google Sheets as the database). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HishabSheets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const URL_RE = /^https:\/\/script\.google\.com\/(a\/(macros\/)?[\w.-]+\/)?macros\/s\/[\w-]+\/exec$/;
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const MESSAGES = {
    bad_login: 'Wrong email or password.',
    locked: 'Too many wrong attempts. Try again in 15 minutes.',
    exists: 'An account with this email already exists. Use Sign in instead.',
    bad_code: 'Wrong signup code.',
    bad_email: 'Enter a valid email address.'
  };

  // The plain password never leaves the device: only a slow PBKDF2 hash of it is sent.
  async function hashPassword(email, password) {
    const subtle = typeof crypto !== 'undefined' && crypto.subtle;
    if (!subtle) throw fail(0, 'Secure sign-in is not available here. Open the site with https://.');
    const enc = new TextEncoder();
    const key = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode('hisab-khata:' + String(email).trim().toLowerCase()), iterations: 100000, hash: 'SHA-256' }, key, 256);
    return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function post(url, body, fetchFn) {
    const doFetch = fetchFn || ((...a) => fetch(...a));
    let r;
    try {
      r = await doFetch(url, {
        method: 'POST', redirect: 'follow', cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // keeps it a "simple" request (no CORS preflight)
        body: JSON.stringify(body)
      });
    } catch (e) { throw new TypeError('network'); }
    if (!r.ok) throw fail(r.status, 'Server error ' + r.status);
    let j;
    try { j = await r.json(); } catch (e) { throw new TypeError('not-json'); } // usually a Google sign-in page: access is not "Anyone"
    if (!j.ok) {
      if (j.error === 'auth') throw fail(401, 'Session expired. Please sign in again.');
      throw fail(400, MESSAGES[j.error] || j.error || 'Server error');
    }
    return j;
  }

  // action: 'login' | 'register'
  async function authenticate(url, action, email, password, code, fetchFn) {
    const pw = await hashPassword(email, password);
    return post(url, { action, email, pw, code }, fetchFn);
  }

  function create(cfg, fetchFn) {
    const call = (body) => post(cfg.url, Object.assign({ token: cfg.token }, body), fetchFn);
    return {
      ping: () => call({ action: 'ping' }),
      sync: (payload) => call(Object.assign({ action: 'sync' }, payload)),
      logoutAll: () => call({ action: 'logoutAll' })
    };
  }

  return { create, authenticate, hashPassword, URL_RE };
});
