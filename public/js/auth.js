// public/js/auth.js — sign in / create account / sign out.
// Runs last: checks the session, then either boots the shell or shows the form.
(function () {
  const $ = (sel) => document.querySelector(sel);
  const A = { mode: 'login' };

  function msg(text) {
    const el = $('#auth-msg');
    if (el) el.textContent = text || '';
  }

  function setMode(mode) {
    A.mode = mode === 'register' ? 'register' : 'login';
    document.querySelectorAll('.auth-tab').forEach((b) => {
      const on = b.dataset.authTab === A.mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const pw = $('#auth-password');
    const submit = $('#auth-submit');
    if (A.mode === 'register') {
      if (pw) pw.setAttribute('autocomplete', 'new-password');
      if (submit) submit.textContent = 'Create account';
    } else {
      if (pw) pw.setAttribute('autocomplete', 'current-password');
      if (submit) submit.textContent = 'Sign in';
    }
    msg('');
  }

  async function submitForm(e) {
    e.preventDefault();
    const username = $('#auth-username').value.trim();
    const password = $('#auth-password').value;
    const btn = $('#auth-submit');
    if (!username || !password) { msg('Enter a username and a password.'); return; }

    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = A.mode === 'register' ? 'Creating…' : 'Signing in…';
    msg('');
    try {
      const r = await fetch(`/api/auth/${A.mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        msg(d.error || 'That did not work. Try again.');
        return;
      }
      $('#auth-password').value = '';
      window.Arcade.setUser(d.user);
      window.Arcade.enterApp();
    } catch (_) {
      msg('Network error. Check your connection and try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch (_) { /* sign out locally regardless */ }
    window.Arcade.setUser(null);
    window.Arcade.enterAuth();
    $('#auth-password').value = '';
    setMode('login');
    msg('Signed out.');
  }

  async function boot() {
    let user = null;
    try {
      const r = await fetch('/api/auth/me');
      if (r.ok) {
        const d = await r.json();
        if (d.ok) user = d.user;
      }
    } catch (_) { /* offline */ }

    if (user) {
      window.Arcade.setUser(user);
      window.Arcade.enterApp();
    } else {
      window.Arcade.enterAuth();
      setMode('login');
    }
  }

  document.querySelectorAll('.auth-tab').forEach((b) => {
    b.addEventListener('click', () => setMode(b.dataset.authTab));
  });
  $('#auth-form').addEventListener('submit', submitForm);
  $('#logout-btn').addEventListener('click', logout);

  boot();
})();
