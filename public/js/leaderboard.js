// public/js/leaderboard.js — shared client for the per-game high-score board.
// Fails soft: offline renders a quiet note and the games keep working.
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

  async function render(el, game, opts = {}) {
    if (!el) return;
    const format = opts.format || ((row) => String(row.score));
    el.innerHTML = `<div class="lb-head">Leaderboard</div><div class="lb-loading">Loading…</div>`;
    const data = await top(game, opts.limit || 8);
    if (!data.online) {
      el.innerHTML = `<div class="lb-head">Leaderboard</div><div class="lb-empty">Board offline right now.</div>`;
      return;
    }
    if (!data.scores.length) {
      el.innerHTML = `<div class="lb-head">Leaderboard</div><div class="lb-empty">No scores yet. Be the first.</div>`;
      return;
    }
    const rows = data.scores.map((row, i) => `
      <div class="lb-row">
        <span class="lb-pos">${i + 1}</span>
        <span class="lb-name">${escapeHtml(row.name)}</span>
        <span class="lb-score">${escapeHtml(format(row))}</span>
      </div>`).join('');
    el.innerHTML = `<div class="lb-head">Leaderboard</div>${rows}`;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function buildSave(el, game, score, meta, onSaved) {
    if (!el) return;
    el.innerHTML = `
      <div class="lb-save-row">
        <input class="lb-name-input" maxlength="16" placeholder="Your name" />
        <button class="lb-save-btn" type="button">Save score</button>
      </div>
      <div class="lb-save-msg"></div>`;
    const input = el.querySelector('.lb-name-input');
    const btn = el.querySelector('.lb-save-btn');
    const msg = el.querySelector('.lb-save-msg');
    btn.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) { msg.textContent = 'Enter a name first.'; return; }
      btn.disabled = true;
      btn.textContent = 'Saving…';
      const r = await submit(game, name, score, meta);
      if (r.ok) {
        msg.textContent = r.rank ? `Saved at #${r.rank}.` : 'Saved.';
        el.querySelector('.lb-save-row').style.display = 'none';
        if (onSaved) onSaved();
      } else {
        msg.textContent = r.offline ? 'Board offline — score not saved.' : 'Could not save.';
        btn.disabled = false;
        btn.textContent = 'Save score';
      }
    });
  }

  window.LB = { top, submit, render, escapeHtml, buildSave };
})();
