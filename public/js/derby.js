// public/js/derby.js — The Derby: live pari-mutuel betting on a shared race.
(function () {
  const D = {
    socket: null,
    helpers: null,
    state: null,
    selected: null,
    lastRace: null,
    tickInt: null,
  };
  const $ = (s) => document.querySelector(s);

  function init(socket, helpers) {
    D.socket = socket;
    D.helpers = helpers;

    $('#derby-chips').querySelectorAll('[data-chip]').forEach((b) => {
      b.addEventListener('click', () => {
        const input = $('#derby-amount');
        input.value = b.dataset.chip;
      });
    });

    $('#derby-lanes').addEventListener('click', (e) => {
      const lane = e.target.closest('[data-horse]');
      if (!lane || !D.state || D.state.phase !== 'betting') return;
      D.selected = lane.dataset.horse;
      renderLanes();
      renderTarget();
    });

    $('#derby-place').addEventListener('click', placeBet);

    socket.on('derbyState', (s) => {
      const newRace = s.raceId !== D.lastRace;
      D.lastRace = s.raceId;
      D.state = s;
      if (newRace) {
        D.selected = null;
        const result = $('#derby-result');
        if (result) { result.classList.add('hidden'); result.innerHTML = ''; }
      }
      render();
    });

    if (D.tickInt) clearInterval(D.tickInt);
    D.tickInt = setInterval(updateTimer, 250);
  }

  function open() {
    D.helpers.show('derby-screen');
    if (D.state) render();
  }

  function render() {
    const s = D.state;
    if (!s) return;
    const phaseText = { betting: 'Betting open', racing: 'Race in progress', results: 'Results' };
    $('#derby-phase').textContent = phaseText[s.phase] || s.phase;
    $('#derby-pool').textContent = `Pool ${s.totalPool || 0}`;
    if (window.Arcade && window.Arcade.user) $('#derby-wallet').textContent = window.Arcade.user.points || 0;
    renderLanes();
    renderTarget();
    updateTimer();

    const place = $('#derby-place');
    place.disabled = s.phase !== 'betting';
    $('#derby-amount').disabled = s.phase !== 'betting';
    $('#derby-chips').querySelectorAll('[data-chip]').forEach((c) => { c.disabled = s.phase !== 'betting'; });

    renderResult(s);
  }

  function renderLanes() {
    const s = D.state;
    const wrap = $('#derby-lanes');
    if (!wrap) return;
    wrap.innerHTML = (s.horses || []).map((h) => {
      const odds = h.odds || {};
      const mult = odds.multiplier ? odds.multiplier.toFixed(2) + '×' : '—';
      const prob = odds.probability != null ? Math.round(odds.probability * 100) + '% implied' : '';
      const classes = ['horse-lane', 'tone-' + h.tone];
      if (D.selected === h.id) classes.push('selected');
      if (s.winnerId === h.id) classes.push('is-winner');
      const pct = Math.round((h.progress || 0) * 100);
      return `<button type="button" class="${classes.join(' ')}" data-horse="${esc(h.id)}">
        <span class="hl-copy">
          <span class="hl-name">${esc(h.name)}</span>
          <span class="hl-sub">${prob} · pool ${h.pool || 0}</span>
        </span>
        <span class="hl-track"><span class="hl-fill" style="width:${pct}%"></span></span>
        <span class="hl-odds"><b>${mult}</b><span class="hl-sub">${s.phase === 'betting' ? 'payout' : 'settled'}</span></span>
      </button>`;
    }).join('');
  }

  function renderTarget() {
    const s = D.state;
    const el = $('#derby-bet-target');
    if (!s) return;
    if (s.phase !== 'betting') {
      const winner = s.horses.find((h) => h.id === s.winnerId);
      el.textContent = winner ? `${winner.name} won` : 'Betting closed';
      return;
    }
    const horse = D.selected && s.horses.find((h) => h.id === D.selected);
    el.textContent = horse ? `Backing ${horse.name}` : 'Choose a horse';
  }

  function updateTimer() {
    const s = D.state;
    const el = $('#derby-timer');
    if (!s || !el) return;
    if (s.phase === 'racing' || !s.endsAt) { el.textContent = s.phase === 'racing' ? 'live' : '—'; return; }
    const remain = Math.max(0, s.endsAt - Date.now());
    const sec = Math.ceil(remain / 1000);
    el.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  }

  async function placeBet() {
    const s = D.state;
    const msg = $('#derby-msg');
    if (!s || s.phase !== 'betting') { msg.textContent = 'Betting is closed for this race.'; return; }
    if (!D.selected) { msg.textContent = 'Choose a horse first.'; return; }
    const amount = Math.floor(Number($('#derby-amount').value));
    if (!Number.isFinite(amount) || amount < s.minBet) { msg.textContent = `Minimum bet is ${s.minBet} points.`; return; }
    if (amount > s.maxBet) { msg.textContent = `Maximum bet is ${s.maxBet} points.`; return; }
    msg.textContent = '';
    D.socket.emit('derbyBet', { horse: D.selected, amount });
  }

  function renderResult(s) {
    const box = $('#derby-result');
    if (!box) return;
    if (s.phase !== 'results' || !s.result) { box.classList.add('hidden'); return; }
    const winner = s.horses.find((h) => h.id === s.result.winnerId);
    const payouts = s.result.payouts || [];
    let body;
    if (payouts.length) {
      body = payouts.map((p) => {
        const horse = s.horses.find((h) => h.id === p.horseId);
        const name = horse ? horse.name : p.horseId;
        return `<div class="payout-row">
          <span>${esc(name)} · stake ${p.stake}</span>
          <span>${p.refund ? 'refunded ' + p.payout : p.payout > 0 ? '+' + p.payout : 'lost'}</span>
        </div>`;
      }).join('');
    } else {
      body = '<div class="payout-row"><span>You had no ticket on this race.</span><span>—</span></div>';
    }
    box.innerHTML = `<div class="derby-result-card">
      <p class="kicker">Result</p>
      <h2>${winner ? esc(winner.name) + ' wins' : 'Race void'}</h2>
      <p class="meta">${s.result.refunded ? 'Nobody backed the winner — every stake was refunded.' : `Pool ${s.totalPool} points paid to winning tickets.`}</p>
      ${body}
    </div>`;
    box.classList.remove('hidden');
  }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.DerbyClient = { init, open };
})();
