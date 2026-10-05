/* ==========================================================================
   Email + password login with email confirmation, backed by Supabase Auth.
   Talks to the Supabase REST API directly (no library) so the site's
   Content-Security-Policy can keep script-src 'self'.

   Flow:
   1. Sign up with username, email and password. Supabase emails a link.
   2. The link returns the visitor here with tokens in the URL fragment,
      which signs them in.
   3. Later visits: sign in with email and password.
   ========================================================================== */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://khwpqueqpllwukqsyrex.supabase.co';
  // Publishable key: designed to be public; access is enforced by Row Level Security.
  var SUPABASE_KEY = 'sb_publishable_6r6TbqDVIaTIbmhnpeVMcw_oAv39m5b';

  var USERNAME_RE = /^[a-z0-9_]{3,24}$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var STORE_KEY = 'weather-auth-session';

  var session = null;
  var onReady = [];
  var started = false;

  /* ---------- Session storage ---------- */

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { return null; }
  }
  function save(s) {
    session = s;
    try {
      if (s) localStorage.setItem(STORE_KEY, JSON.stringify(s));
      else localStorage.removeItem(STORE_KEY);
    } catch (e) { /* storage unavailable: session lasts for this page only */ }
  }

  function usernameOf(user) {
    return (user && user.user_metadata && user.user_metadata.username) || (user && user.email) || '';
  }

  function toSession(json) {
    return {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: Number(json.expires_at) || Math.floor(Date.now() / 1000) + (Number(json.expires_in) || 3600),
      username: usernameOf(json.user)
    };
  }

  /* ---------- Supabase API ---------- */

  function api(method, path, body, token) {
    var headers = { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var init = { method: method, headers: headers };
    if (method !== 'GET') init.body = JSON.stringify(body || {});
    return fetch(SUPABASE_URL + path, init)
      .then(function (r) {
        return r.text().then(function (t) {
          var json = null;
          try { json = t ? JSON.parse(t) : null; } catch (e) { /* non-JSON body */ }
          if (!r.ok) {
            var msg = (json && (json.msg || json.message || json.error_description || json.error)) || ('HTTP ' + r.status);
            var err = new Error(msg);
            err.code = json && (json.error_code || json.code);
            throw err;
          }
          return json;
        });
      });
  }

  // Where the confirmation link sends people back to (this page, without query or fragment).
  function returnUrl() { return location.origin + location.pathname; }

  function signIn(email, password) {
    return api('POST', '/auth/v1/token?grant_type=password', { email: email, password: password })
      .then(function (json) { var s = toSession(json); save(s); return s; })
      .catch(function (err) {
        if (err.code === 'email_not_confirmed' || /not confirmed/i.test(err.message)) {
          var e = new Error('Please confirm your email first. Check your inbox for the link.');
          e.unconfirmed = true;
          throw e;
        }
        if (err.code === 'invalid_credentials' || /invalid login/i.test(err.message)) {
          throw new Error('Incorrect email or password.');
        }
        throw err;
      });
  }

  // Resolves to a session if the project does not require confirmation,
  // or to null when a confirmation email has been sent.
  function signUp(username, email, password) {
    return api('POST', '/rest/v1/rpc/username_available', { p_username: username })
      .then(function (free) {
        if (free === false) throw new Error('That username is already taken.');
        return api('POST', '/auth/v1/signup?redirect_to=' + encodeURIComponent(returnUrl()),
          { email: email, password: password, data: { username: username } });
      })
      .then(function (json) {
        if (json && json.access_token) { var s = toSession(json); save(s); return s; }
        return null;
      })
      .catch(function (err) {
        if (/database error saving new user/i.test(err.message)) throw new Error('That username is already taken.');
        if (err.code === 'user_already_exists' || /already registered/i.test(err.message)) {
          throw new Error('An account with that email already exists. Sign in instead.');
        }
        if (err.code === 'weak_password') throw new Error('Choose a stronger password (at least 6 characters).');
        if (err.code === 'over_email_send_rate_limit') throw new Error('Too many emails sent. Please wait a few minutes and try again.');
        throw err;
      });
  }

  function resend(email) {
    return api('POST', '/auth/v1/resend?redirect_to=' + encodeURIComponent(returnUrl()), { type: 'signup', email: email });
  }

  function refresh(s) {
    return api('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token })
      .then(function (json) { var n = toSession(json); n.username = n.username || s.username; save(n); return n; });
  }

  // Handles the return from the confirmation link: #access_token=...&refresh_token=...
  // or #error=...&error_description=...
  function fromLink() {
    if (!location.hash || location.hash.length < 2) return null;
    var p = new URLSearchParams(location.hash.slice(1));
    if (!p.get('access_token') && !p.get('error')) return null;
    history.replaceState(null, '', location.pathname + location.search); // keep tokens out of the address bar

    if (p.get('error')) {
      var msg = p.get('error_code') === 'otp_expired'
        ? 'That confirmation link has expired. Sign in to get a new one.'
        : (p.get('error_description') || 'The confirmation link did not work.').replace(/\+/g, ' ');
      return Promise.reject(new Error(msg));
    }
    var s = toSession({
      access_token: p.get('access_token'),
      refresh_token: p.get('refresh_token'),
      expires_at: p.get('expires_at'),
      expires_in: p.get('expires_in')
    });
    return api('GET', '/auth/v1/user', null, s.access_token).then(function (user) {
      s.username = usernameOf(user);
      save(s);
      return s;
    });
  }

  function signOut() {
    var token = session && session.access_token;
    save(null);
    var done = function () { location.reload(); };
    if (token) api('POST', '/auth/v1/logout', {}, token).then(done, done);
    else done();
  }

  // Refresh the access token shortly before it expires while the page is open.
  var refreshTimer = null;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (!session) return;
    var ms = Math.max(5000, (session.expires_at - 60) * 1000 - Date.now());
    refreshTimer = setTimeout(function () {
      refresh(session).then(scheduleRefresh, function () { save(null); showLogin('Your session expired. Please sign in again.'); });
    }, ms);
  }

  /* ---------- UI ---------- */

  function $(id) { return document.getElementById(id); }
  var gate = $('auth'), form = $('auth-form'), fields = $('auth-fields');
  var userRow = $('auth-username-row'), userInput = $('auth-username');
  var emailInput = $('auth-email'), passInput = $('auth-password');
  var confirmRow = $('auth-confirm-row'), confirmInput = $('auth-confirm');
  var submitBtn = $('auth-submit'), switchBtn = $('auth-switch'), switchText = $('auth-switch-text');
  var heading = $('auth-heading'), sub = $('auth-sub');
  var errorEl = $('auth-error'), noticeEl = $('auth-notice');
  var resendRow = $('auth-resend-row'), resendBtn = $('auth-resend');
  var accountEl = $('account'), accountName = $('account-name');
  var mode = 'signin';
  var pendingEmail = '';

  function setMode(m) {
    mode = m;
    var up = m === 'signup';
    heading.textContent = up ? 'Create Account' : 'Sign In';
    sub.hidden = false;
    sub.textContent = up ? 'We will email you a link to confirm your address.' : 'Sign in to see the weather.';
    submitBtn.textContent = up ? 'Create Account' : 'Sign In';
    switchText.textContent = up ? 'Already have an account?' : 'New here?';
    switchBtn.textContent = up ? 'Sign In' : 'Create an account';
    fields.hidden = false;
    submitBtn.hidden = false;
    userRow.hidden = !up;
    confirmRow.hidden = !up;
    passInput.setAttribute('autocomplete', up ? 'new-password' : 'current-password');
    errorEl.textContent = '';
    noticeEl.hidden = true;
    resendRow.hidden = true;
  }

  // Shown after sign-up: the account exists but the email is not confirmed yet.
  function showCheckEmail(email) {
    pendingEmail = email;
    mode = 'signin';
    heading.textContent = 'Check Your Email';
    sub.hidden = true;
    fields.hidden = true;
    submitBtn.hidden = true;
    errorEl.textContent = '';
    noticeEl.textContent = 'We sent a confirmation link to ' + email + '. Open it on this device to finish signing in.';
    noticeEl.hidden = false;
    resendRow.hidden = false;
    switchText.textContent = 'Already confirmed?';
    switchBtn.textContent = 'Sign In';
  }

  function showLogin(msg) {
    document.body.classList.add('locked');
    gate.hidden = false;
    accountEl.hidden = true;
    errorEl.textContent = msg || '';
    setTimeout(function () { (mode === 'signup' ? userInput : emailInput).focus(); }, 0);
  }

  function enter(s) {
    gate.hidden = true;
    document.body.classList.remove('locked');
    accountName.textContent = s.username;
    accountEl.hidden = false;
    scheduleRefresh();
    if (!started) {
      started = true;
      onReady.forEach(function (fn) { fn(); });
    }
  }

  switchBtn.addEventListener('click', function () {
    var inCheckEmail = fields.hidden;
    setMode(inCheckEmail || mode === 'signup' ? 'signin' : 'signup');
    if (inCheckEmail) emailInput.value = pendingEmail;
  });
  $('account-signout').addEventListener('click', signOut);

  resendBtn.addEventListener('click', function () {
    var email = pendingEmail || emailInput.value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { errorEl.textContent = 'Enter your email address above first.'; return; }
    resendBtn.disabled = true;
    resend(email)
      .then(function () {
        errorEl.textContent = '';
        noticeEl.textContent = 'A new confirmation link was sent to ' + email + '.';
        noticeEl.hidden = false;
      }, function (err) {
        errorEl.textContent = err.code === 'over_email_send_rate_limit'
          ? 'Too many emails sent. Please wait a few minutes and try again.'
          : (err.message || 'Could not resend the email.');
      })
      .then(function () { resendBtn.disabled = false; });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = emailInput.value.trim().toLowerCase();
    var password = passInput.value;
    var username = userInput.value.trim().toLowerCase();
    errorEl.textContent = '';
    noticeEl.hidden = true;
    resendRow.hidden = true;

    if (mode === 'signup' && !USERNAME_RE.test(username)) {
      errorEl.textContent = 'Usernames are 3–24 characters: lowercase letters, numbers and underscores.';
      return;
    }
    if (!EMAIL_RE.test(email)) { errorEl.textContent = 'Enter a valid email address.'; return; }
    if (password.length < 6) { errorEl.textContent = 'Passwords must be at least 6 characters.'; return; }
    if (mode === 'signup' && password !== confirmInput.value) {
      errorEl.textContent = 'The passwords do not match.';
      return;
    }

    submitBtn.disabled = true;
    var work = mode === 'signup'
      ? signUp(username, email, password).then(function (s) { if (s) enter(s); else showCheckEmail(email); })
      : signIn(email, password).then(enter);
    work
      .then(function () { passInput.value = ''; confirmInput.value = ''; })
      .catch(function (err) {
        errorEl.textContent = err.message || 'Something went wrong. Please try again.';
        if (err.unconfirmed) { pendingEmail = email; resendRow.hidden = false; }
      })
      .then(function () { submitBtn.disabled = false; });
  });

  /* ---------- Start ---------- */

  window.WeatherAuth = {
    // Runs fn once the visitor is signed in.
    ready: function (fn) { if (started) fn(); else onReady.push(fn); },
    signOut: signOut
  };

  setMode('signin');
  var linked = fromLink();
  if (linked) {
    linked.then(enter, function (err) { save(null); showLogin(err.message); });
  } else {
    var stored = load();
    if (!stored || !stored.refresh_token) {
      showLogin();
    } else if (stored.expires_at - 60 > Date.now() / 1000) {
      session = stored;
      enter(stored);
    } else {
      refresh(stored).then(enter, function () { save(null); showLogin(); });
    }
  }
})();
