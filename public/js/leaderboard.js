// public/js/leaderboard.js — shared client helper for the MongoDB leaderboard.
// Fails soft: if the backend/DB is offline, render shows a friendly note and
// games keep working with local-only best scores.
(function () {
  async function top(game, limit = 10) {
    try {
      const r = await fetch(`/api/leaderboard?game=${encodeURIComponent(game)}&limit=${limit}`);
      return await r.json();
    } catch (_) {
      return { ok: false, online: false, scores: [] };
    }
  }

  async function submit(game, name, score, meta) {
    try {
      const r = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game, name, score, meta: meta || {} }),
      });
      return await r.json();
    } catch (_) {
      return { ok: false };
    }
  }

  // Render a leaderboard panel into `el`. `format(row)` returns the right-hand text.
  async function render(el, game, opts = {}) {
    const format = opts.format || ((row) => String(row.score));
    el.innerHTML = `<div class="lb-head">🏆 Leaderboard</div><div class="lb-loading">Loading…</div>`;
    const data = await top(game, opts.limit || 8);
    if (!data.online) {
      el.innerHTML = `<div class="lb-head">🏆 Leaderboard</div><div class="lb-empty">Leaderboard offline right now.</div>`;
      return;
    }
    if (!data.scores.length) {
      el.innerHTML = `<div class="lb-head">🏆 Leaderboard</div><div class="lb-empty">No scores yet — be the first!</div>`;
      return;
    }
    const rows = data.scores.map((row, i) => {
      const medal = ['🥇', '🥈', '🥉'][i] || `<span class="rank">${i + 1}</span>`;
      return `<div class="lb-row"><span class="lb-pos">${medal}</span>` +
        `<span class="lb-name">${escapeHtml(row.name)}</span>` +
        `<span class="lb-score">${escapeHtml(format(row))}</span></div>`;
    }).join('');
    el.innerHTML = `<div class="lb-head">🏆 Leaderboard</div>${rows}`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // A "save your score" widget (name input + button). Calls onSaved() on success.
  function buildSave(el, game, score, meta, onSaved) {
    const prefill = localStorage.getItem('arcadeName') || '';
    el.innerHTML = `
      <div class="lb-save-row">
        <input class="lb-name-input" maxlength="16" placeholder="Your name" value="${escapeHtml(prefill)}" />
        <button class="lb-save-btn">Save score</button>
      </div>
      <div class="lb-save-msg"></div>`;
    const input = el.querySelector('.lb-name-input');
    const btn = el.querySelector('.lb-save-btn');
    const msg = el.querySelector('.lb-save-msg');
    btn.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) { msg.textContent = 'Enter a name first.'; return; }
      localStorage.setItem('arcadeName', name);
      btn.disabled = true; btn.textContent = 'Saving…';
      const r = await submit(game, name, score, meta);
      if (r.ok) {
        msg.textContent = r.rank ? `Saved! You're #${r.rank}.` : 'Saved!';
        el.querySelector('.lb-save-row').style.display = 'none';
        if (onSaved) onSaved();
      } else {
        msg.textContent = r.offline ? 'Leaderboard offline — score not saved.' : 'Could not save.';
        btn.disabled = false; btn.textContent = 'Save score';
      }
    });
  }

  window.LB = { top, submit, render, escapeHtml, buildSave };
})();
