// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
const S = {
  data:        null,
  page:        'dashboard',
  posFilter:   { showAll: false, sort: 'valeur' },
  histoFilter: { type: 'all', courtier: 'all', compte: 'all' },
  period:      '3m',
  charts:      {}
};

// ═══════════════════════════════════════════════════════════════
// FORMATTERS
// ═══════════════════════════════════════════════════════════════
const fmt = {
  eur(v, sign = false) {
    if (v == null || isNaN(v)) return '—';
    const abs = Math.abs(v);
    const str = abs.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
    if (v > 0) return (sign ? '+' : '') + str;
    if (v < 0) return '−' + str;
    return str;
  },
  pct(v, sign = false, d = 1) {
    if (v == null || isNaN(v)) return '—';
    const str = Math.abs(v).toFixed(d) + '%';
    if (v > 0) return (sign ? '+' : '') + str;
    if (v < 0) return '−' + str;
    return str;
  },
  qty(v) {
    if (v == null || isNaN(v)) return '—';
    return v.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
  }
};

// color class: positive → col-g, negative → col-r, zero → col-t2
const cc = v => v > 0 ? 'col-g' : v < 0 ? 'col-r' : 'col-t2';
// badge class: pos/neg
const bc = v => v >= 0 ? 'pos' : 'neg';

// ═══════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => goTo(btn.dataset.page));
  });

  updateClock();
  setInterval(updateClock, 30000);
  loadData();
});

function updateClock() {
  const el = document.getElementById('header-ts');
  if (el) el.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ═══════════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════════
async function loadData(force = false) {
  if (!CONFIG.GAS_URL || CONFIG.GAS_URL.includes('REMPLACER')) {
    showSetup(); return;
  }

  const cache = getCache();
  if (cache && !force) {
    S.data = cache.data;
    showApp(); renderAll(); stampTs(cache.data.lastUpdate, cache.stale);
    if (cache.stale) fetchFresh();
  } else {
    // first load or forced refresh
    const data = await fetchFresh(true);
    if (!S.data) showSetup();
  }
}

async function fetchFresh(initial = false) {
  const btn = document.getElementById('refresh-btn');
  if (btn) btn.classList.add('spinning');

  try {
    const res = await fetch(CONFIG.GAS_URL, { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
    S.data = data;
    stampTs(data.lastUpdate, false);
    showApp();
    renderAll();
    return data;
  } catch (err) {
    console.error('[Portfolio] fetch error:', err);
    const cache = getCache();
    if (cache) { S.data = cache.data; showApp(); renderAll(); }
    return null;
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

function getCache() {
  try {
    const raw = localStorage.getItem(CONFIG.CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    return { data, ts, stale: Date.now() - ts > CONFIG.CACHE_MAX_AGE };
  } catch { return null; }
}

function stampTs(iso) {
  const el = document.getElementById('header-ts');
  if (!el || !iso) return;
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) el.textContent = 'live';
  else if (m < 60) el.textContent = m + 'min';
  else el.textContent = Math.floor(m / 60) + 'h';
}

function showApp()   { document.getElementById('loading').style.display = 'none'; document.getElementById('app').classList.remove('app-hidden'); }
function showSetup() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').classList.remove('app-hidden');
  const el = document.getElementById('page-dashboard');
  el.classList.add('active');
  el.innerHTML = `
    <div class="setup-wrap">
      <div class="setup-title">CONFIGURATION</div>
      <p class="setup-body">Ouvre <strong>config.js</strong> dans ton repo et remplace <code>REMPLACER_PAR_VOTRE_URL_GAS</code> par l'URL de ton Web App Google Apps Script.</p>
      <div class="setup-code">CONFIG.GAS_URL = 'https://script.google.com/macros/s/<b>TON_ID</b>/exec'</div>
    </div>`;
}

function refreshData() { loadData(true); }

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════
function goTo(page) {
  if (S.page === page) return;
  S.page = page;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  if (page === 'evolution') renderEvolution();
}

// ═══════════════════════════════════════════════════════════════
// RENDER DISPATCHER
// ═══════════════════════════════════════════════════════════════
function renderAll() {
  if (!S.data) return;
  renderDashboard();
  renderPositions();
  renderHistorique();
  if (S.page === 'evolution') renderEvolution();
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════
function renderDashboard() {
  killChart('allocType'); killChart('allocTop');

  const { summary, positions } = S.data;
  const actives = positions.filter(p => p.actif).sort((a, b) => b.valeur - a.valeur);
  const pnlB = bc(summary.pnl);
  const el = document.getElementById('page-dashboard');

  el.innerHTML = `
    <div class="dash-hero">
      <div class="dash-hero-lbl">VALEUR TOTALE</div>
      <div class="dash-hero-val">${fmt.eur(summary.valeurTotale)}</div>
      <div class="dash-badge ${pnlB}">
        <span>${fmt.eur(summary.pnl, true)}</span>
        <span class="sep">|</span>
        <span>${fmt.pct(summary.rendementGlobal, true)}</span>
      </div>
    </div>

    <div class="stats-2">
      <div class="stat-box">
        <div class="stat-box-lbl">TOTAL INVESTI</div>
        <div class="stat-box-val">${fmt.eur(summary.totalInvesti)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-lbl">DIVIDENDES</div>
        <div class="stat-box-val col-g">${fmt.eur(summary.dividendes)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-lbl">ATH PORTEFEUILLE</div>
        <div class="stat-box-val">${fmt.eur(summary.athWallet)}</div>
        <div class="stat-box-sub ${cc(summary.pctAthWallet)}">${fmt.pct(summary.pctAthWallet, true)} vs ATH</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-lbl">POSITIONS FERMÉES</div>
        <div class="stat-box-val ${cc(summary.resultatsPosFermees)}">${fmt.eur(summary.resultatsPosFermees, true)}</div>
      </div>
    </div>

    <div class="sec-hd">RÉPARTITION</div>
    <div class="alloc-row">
      <div class="alloc-card">
        <div class="alloc-card-title">ACTIONS / ETF</div>
        <div class="alloc-donut-wrap"><canvas id="c-alloc-type"></canvas></div>
        <div class="alloc-legend" id="leg-type"></div>
      </div>
      <div class="alloc-card">
        <div class="alloc-card-title">TOP POSITIONS</div>
        <div class="alloc-donut-wrap"><canvas id="c-alloc-top"></canvas></div>
        <div class="alloc-legend" id="leg-top"></div>
      </div>
    </div>

    <div class="sec-hd">TOP ACTIVES</div>
    <div class="top-list">
      ${actives.slice(0, 6).map(p => `
        <div class="top-row" onclick="openDetail('${esc(p.ticker)}')">
          <div class="top-ticker">${p.ticker}</div>
          <div class="top-mid">
            <div class="top-name">${p.nom}</div>
            <div class="top-bar"><div class="top-bar-fill" style="width:${Math.min(100, p.pctWallet)}%"></div></div>
          </div>
          <div class="top-right">
            <div class="top-val">${fmt.eur(p.valeur)}</div>
            <div class="top-pnl ${cc(p.pnl)}">${fmt.pct(p.pnlPct, true)}</div>
          </div>
        </div>`).join('')}
    </div>`;

  buildAllocCharts(positions);
}

function buildAllocCharts(positions) {
  const actives = positions.filter(p => p.actif);
  const sorted  = [...actives].sort((a, b) => b.valeur - a.valeur);
  const total   = actives.reduce((s, p) => s + p.valeur, 0);

  const actionV = actives.filter(p => p.type === 'ACTION').reduce((s, p) => s + p.valeur, 0);
  const etfV    = actives.filter(p => p.type === 'ETF').reduce((s, p) => s + p.valeur, 0);

  // Chart 1 — Actions vs ETF
  const ctx1 = document.getElementById('c-alloc-type');
  if (ctx1) {
    S.charts.allocType = new Chart(ctx1, {
      type: 'doughnut',
      data: { datasets: [{ data: [actionV, etfV], backgroundColor: ['#ededed', '#2e2e2e'], borderWidth: 0, hoverOffset: 2 }] },
      options: donutOpts()
    });
  }
  const legType = document.getElementById('leg-type');
  if (legType) legType.innerHTML = [
    { label: 'Actions', val: actionV, color: '#ededed' },
    { label: 'ETF',     val: etfV,    color: '#2e2e2e' }
  ].map(i => legRow(i.label, i.color, total > 0 ? i.val / total * 100 : 0, '#3a3a3a')).join('');

  // Chart 2 — Top 5 + Others
  const top5    = sorted.slice(0, 5);
  const otherV  = sorted.slice(5).reduce((s, p) => s + p.valeur, 0);
  const palette = ['#ededed', '#b0b0b0', '#777', '#3f3f3f', '#222'];
  const ctx2    = document.getElementById('c-alloc-top');
  if (ctx2) {
    const vals = [...top5.map(p => p.valeur)];
    const cols = [...palette.slice(0, top5.length)];
    if (otherV > 0) { vals.push(otherV); cols.push('#161616'); }
    S.charts.allocTop = new Chart(ctx2, {
      type: 'doughnut',
      data: { datasets: [{ data: vals, backgroundColor: cols, borderWidth: 0, hoverOffset: 2 }] },
      options: donutOpts()
    });
  }
  const legTop = document.getElementById('leg-top');
  if (legTop) legTop.innerHTML = top5.slice(0, 3).map((p, i) =>
    legRow(p.ticker, palette[i], total > 0 ? p.valeur / total * 100 : 0)
  ).join('');
}

function donutOpts() {
  return {
    responsive: true, cutout: '68%',
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    animation: { duration: 500 }
  };
}
function legRow(label, color, pctVal, border = 'transparent') {
  return `<div class="alloc-leg-row">
    <span class="alloc-leg-name"><span class="alloc-dot" style="background:${color};border:1px solid ${border}"></span>${label}</span>
    <span class="alloc-leg-pct">${fmt.pct(pctVal)}</span>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// POSITIONS
// ═══════════════════════════════════════════════════════════════
function renderPositions() {
  const { positions } = S.data;
  const { showAll, sort } = S.posFilter;
  let list = showAll ? [...positions] : positions.filter(p => p.actif);

  if (sort === 'valeur')  list.sort((a, b) => b.valeur - a.valeur);
  if (sort === 'pnl')     list.sort((a, b) => b.pnl - a.pnl);
  if (sort === 'pnlpct')  list.sort((a, b) => b.pnlPct - a.pnlPct);
  if (sort === 'nom')     list.sort((a, b) => a.nom.localeCompare(b.nom));

  document.getElementById('page-positions').innerHTML = `
    <div class="pos-bar">
      <div class="toggle-grp">
        <button class="toggle-btn ${!showAll ? 'on' : ''}" onclick="setPosFilter(false)">Actives</button>
        <button class="toggle-btn ${showAll  ? 'on' : ''}" onclick="setPosFilter(true)">Toutes</button>
      </div>
      <select class="sort-sel" onchange="setPosSort(this.value)">
        <option value="valeur"  ${sort==='valeur'  ?'selected':''}>Valeur ↓</option>
        <option value="pnl"     ${sort==='pnl'     ?'selected':''}>PNL €</option>
        <option value="pnlpct"  ${sort==='pnlpct'  ?'selected':''}>PNL %</option>
        <option value="nom"     ${sort==='nom'     ?'selected':''}>A → Z</option>
      </select>
    </div>
    <div class="pos-list">
      ${list.length ? list.map(posCard).join('') : emptyState('📭','Aucune position')}
    </div>`;
}

function posCard(p) {
  const active = p.actif;
  return `
    <div class="pos-card${active ? '' : ' closed'}" onclick="openDetail('${esc(p.ticker)}')">
      <div class="pos-card-top">
        <div class="pos-left">
          <div class="pos-ticker-row">
            <span class="pos-ticker">${p.ticker}</span>
            <span class="pos-badge">${p.type}</span>
            ${!active ? '<span class="pos-badge col-t2">FERMÉE</span>' : ''}
          </div>
          <div class="pos-name">${p.nom}</div>
        </div>
        <div class="pos-right">
          <div class="pos-valeur">${active ? fmt.eur(p.valeur) : '—'}</div>
          <div class="pos-pnl ${cc(p.pnl)}">
            ${active
              ? `${fmt.eur(p.pnl, true)} · ${fmt.pct(p.pnlPct, true)}`
              : `Résultat: ${fmt.eur(p.totalComplet, true)}`}
          </div>
        </div>
      </div>
      ${active ? `
        <div class="pos-foot">
          <div class="pos-meta">Cours <span>${fmt.eur(p.cours)}</span></div>
          <div class="pos-meta">PRU <span>${fmt.eur(p.pru)}</span></div>
          <div class="pos-meta">Qté <span>${fmt.qty(p.nombre)}</span></div>
        </div>` : ''}
    </div>`;
}

function setPosFilter(v) { S.posFilter.showAll = v; renderPositions(); }
function setPosSort(v)   { S.posFilter.sort = v;    renderPositions(); }

// ═══════════════════════════════════════════════════════════════
// POSITION DETAIL
// ═══════════════════════════════════════════════════════════════
function openDetail(ticker) {
  const { positions, historique } = S.data;
  const p = positions.find(x => x.ticker === ticker);
  if (!p) return;

  const txs  = historique.filter(h => h.nom.toLowerCase() === p.nom.toLowerCase());
  const pnlC = bc(p.pnl);
  const hasPerfData = p.perf30j !== 0 || p.perf6m !== 0 || p.perf5ans !== 0;

  const overlay = document.getElementById('detail-overlay');
  overlay.innerHTML = `
    <div class="det-hdr">
      <button class="back-btn" onclick="closeDetail()">
        <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="det-ticker">${p.ticker}</div>
      <div class="det-name">${p.nom}</div>
    </div>

    <div class="det-hero">
      <div class="det-cours">${fmt.eur(p.cours)}</div>
      <div class="det-pru">PRU ${fmt.eur(p.pru)}${p.actif
        ? ` · ${fmt.qty(p.nombre)} titres · ${fmt.pct(p.pctWallet, false, 1)} du wallet`
        : ' · Position fermée'}</div>
      ${p.actif ? `
        <div class="det-chips">
          <div class="chip ${pnlC}">${fmt.eur(p.pnl, true)}</div>
          <div class="chip ${pnlC}">${fmt.pct(p.pnlPct, true)}</div>
        </div>` : ''}
    </div>

    <div class="sec-hd">DÉTAILS</div>
    <div class="det-grid">
      <div class="det-stat"><div class="det-stat-lbl">VALEUR</div><div class="det-stat-val">${fmt.eur(p.valeur)}</div></div>
      <div class="det-stat"><div class="det-stat-lbl">TOTAL INVESTI</div><div class="det-stat-val">${fmt.eur(p.totalInvesti)}</div></div>
      <div class="det-stat"><div class="det-stat-lbl">DIVIDENDES</div><div class="det-stat-val col-g">${fmt.eur(p.dividendes)}</div></div>
      <div class="det-stat"><div class="det-stat-lbl">FRAIS TOTAUX</div><div class="det-stat-val col-r">${fmt.eur(Math.abs(p.totalFrais))}</div></div>
      <div class="det-stat"><div class="det-stat-lbl">RÉSULTAT COMPLET</div><div class="det-stat-val ${cc(p.totalComplet)}">${fmt.eur(p.totalComplet, true)}</div></div>
      <div class="det-stat"><div class="det-stat-lbl">ACHATS / VENTES</div><div class="det-stat-val">${p.nbAchats} / ${p.nbVentes}</div></div>
    </div>

    ${hasPerfData ? `
      <div class="sec-hd">PERFORMANCES</div>
      <div class="perf-row">
        <div class="perf-box"><div class="perf-lbl">30 JOURS</div><div class="perf-val ${cc(p.perf30j)}">${p.perf30j ? fmt.pct(p.perf30j, true) : '—'}</div></div>
        <div class="perf-box"><div class="perf-lbl">6 MOIS</div><div class="perf-val ${cc(p.perf6m)}">${p.perf6m ? fmt.pct(p.perf6m, true) : '—'}</div></div>
        <div class="perf-box"><div class="perf-lbl">5 ANS</div><div class="perf-val ${cc(p.perf5ans)}">${p.perf5ans ? fmt.pct(p.perf5ans, true) : '—'}</div></div>
      </div>` : ''}

    ${txs.length ? `
      <div class="sec-hd">TRANSACTIONS (${txs.length})</div>
      <div class="tx-list">${txs.map(txRow).join('')}</div>` : ''}`;

  requestAnimationFrame(() => overlay.classList.add('open'));
}

function closeDetail() {
  document.getElementById('detail-overlay').classList.remove('open');
}

function txRow(tx) {
  const ICONS = { ACHAT: '↑', VENTE: '↓', DIVIDENDES: '◆' };
  const colorCls = tx.type === 'ACHAT' ? 'col-r' : 'col-g';
  return `
    <div class="tx-item">
      <div class="tx-ico ${tx.type}">${ICONS[tx.type] || '·'}</div>
      <div class="tx-body">
        <div class="tx-type">${cap(tx.type)}</div>
        <div class="tx-meta">${tx.date} · ${tx.courtier} · ${tx.compte}</div>
      </div>
      <div class="tx-right">
        <div class="tx-total ${colorCls}">${fmt.eur(tx.total)}</div>
        ${tx.unites ? `<div class="tx-detail">${fmt.qty(Math.abs(tx.unites))} × ${fmt.eur(tx.prixUnite)}</div>` : ''}
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// ÉVOLUTION
// ═══════════════════════════════════════════════════════════════
function renderEvolution() {
  if (!S.data) return;
  const log = filterLog(S.data.log, S.period);

  if (!log.length) {
    document.getElementById('page-evolution').innerHTML =
      `<div class="period-bar">${periodBtns()}</div>${emptyState('📊','Pas assez de données\npour cette période.')}`;
    return;
  }

  const first  = log[0];
  const last   = log[log.length - 1];
  const varV   = last.valeurTotale - first.valeurTotale;
  const varPct = first.valeurTotale > 0 ? varV / first.valeurTotale * 100 : 0;
  const maxV   = Math.max(...log.map(e => e.valeurTotale));
  const maxPnl = Math.max(...log.map(e => e.pnl));

  killChart('valeur'); killChart('pnl'); killChart('investi');

  document.getElementById('page-evolution').innerHTML = `
    <div class="period-bar">${periodBtns()}</div>

    <div class="chart-sec" style="margin-top:4px">
      <div class="chart-sec-title">PNL EN COURS</div>
      <div class="chart-box">
        <canvas id="c-pnl"></canvas>
        <div class="chart-kpis">
          <div class="chart-kpi"><div class="chart-kpi-lbl">ACTUEL</div><div class="chart-kpi-val ${cc(last.pnl)}">${fmt.eur(last.pnl, true)}</div></div>
          <div class="chart-kpi"><div class="chart-kpi-lbl">MAX WALLET</div><div class="chart-kpi-val">${fmt.eur(maxV)}</div></div>
          <div class="chart-kpi"><div class="chart-kpi-lbl">PNL MAX</div><div class="chart-kpi-val col-g">${fmt.eur(maxPnl, true)}</div></div>
        </div>
      </div>
    </div>

    <div class="chart-sec" style="margin-top:12px">
      <div class="chart-sec-title">VALEUR DU PORTEFEUILLE</div>
      <div class="chart-box">
        <canvas id="c-valeur"></canvas>
        <div class="chart-kpis">
          <div class="chart-kpi"><div class="chart-kpi-lbl">VARIATION</div><div class="chart-kpi-val ${cc(varV)}">${fmt.eur(varV, true)}</div></div>
          <div class="chart-kpi"><div class="chart-kpi-lbl">PERF. PÉRIODE</div><div class="chart-kpi-val ${cc(varPct)}">${fmt.pct(varPct, true)}</div></div>
          <div class="chart-kpi"><div class="chart-kpi-lbl">ACTUELLE</div><div class="chart-kpi-val">${fmt.eur(last.valeurTotale)}</div></div>
        </div>
      </div>
    </div>

    <div class="chart-sec" style="margin-top:12px">
      <div class="chart-sec-title">TOTAL INVESTI</div>
      <div class="chart-box"><canvas id="c-investi"></canvas></div>
    </div>

    ${renderAnnualTable(S.data.log)}`;

  buildEvolutionCharts(log);
}

function buildEvolutionCharts(data) {
  const step = Math.max(1, Math.floor(data.length / 80));
  const pts   = data.filter((_, i) => i % step === 0 || i === data.length - 1);
  const lbls  = pts.map(e => {
    const d = new Date(e.date);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  });

  const baseOpts = {
    responsive: true, maintainAspectRatio: true, aspectRatio: 2.8,
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index', intersect: false,
        backgroundColor: '#161616', borderColor: '#2a2a2a', borderWidth: 1,
        titleColor: '#555', bodyColor: '#ededed', padding: 8,
        callbacks: { label: ctx => ' ' + fmt.eur(ctx.raw) }
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,.03)' },
        ticks: { color: '#444', maxTicksLimit: 5, font: { size: 9, family: "'DM Sans',sans-serif" } },
        border: { display: false }
      },
      y: {
        grid: { color: 'rgba(255,255,255,.04)' },
        ticks: {
          color: '#444',
          font: { size: 9, family: "'DM Sans',sans-serif" },
          callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v
        },
        border: { display: false }
      }
    },
    elements: { point: { radius: 0, hoverRadius: 3 }, line: { borderWidth: 1.5, tension: .2 } },
    interaction: { mode: 'nearest', axis: 'x', intersect: false }
  };

  const mkLine = (id, key, color, alpha) => {
    const ctx = document.getElementById(id);
    if (!ctx) return null;
    const vals = pts.map(e => e[key]);
    const c    = color === 'auto' ? (vals[vals.length - 1] >= 0 ? '#22c55e' : '#ef4444') : color;
    const r    = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
    return new Chart(ctx, {
      type: 'line',
      data: { labels: lbls, datasets: [{ data: vals, borderColor: c, backgroundColor: `rgba(${r},${g},${b},${alpha})`, fill: true, tension: .2 }] },
      options: baseOpts
    });
  };

  S.charts.valeur  = mkLine('c-valeur',  'valeurTotale', '#ededed', .04);
  S.charts.pnl     = mkLine('c-pnl',     'pnl',          'auto',   .07);
  S.charts.investi = mkLine('c-investi', 'totalInvesti', '#3a3a3a', .05);
}

// ═══════════════════════════════════════════════════════════════
// BILAN ANNUEL
// ═══════════════════════════════════════════════════════════════
function computeAnnualPerf(log) {
  if (!log || log.length < 2) return [];

  const parsed = log.map(e => ({ ...e, ts: new Date(e.date).getTime() }));

  function nearest(targetTs) {
    return parsed.reduce((b, e) =>
      Math.abs(e.ts - targetTs) < Math.abs(b.ts - targetTs) ? e : b
    );
  }

  const firstTs   = parsed[0].ts;
  const lastTs    = parsed[parsed.length - 1].ts;
  const firstYear = new Date(firstTs).getFullYear();
  const lastYear  = new Date(lastTs).getFullYear();

  const snaps = [];

  // Point de départ : première entrée du log
  snaps.push({ label: 'Départ', ts: firstTs, valeur: parsed[0].valeurTotale });

  // 1er janvier de chaque année dans la plage de données
  for (let y = firstYear + 1; y <= lastYear; y++) {
    const jan1 = new Date(y, 0, 1).getTime();
    if (jan1 > lastTs + 20 * 86400000) break;
    const e = nearest(jan1);
    if (Math.abs(e.ts - jan1) < 20 * 86400000) {
      snaps.push({ label: `1er janv. ${y}`, ts: e.ts, valeur: e.valeurTotale });
    }
  }

  // "Actuel" si +30 jours depuis le dernier snapshot
  const lastSnap = snaps[snaps.length - 1];
  if (lastTs - lastSnap.ts > 30 * 86400000) {
    snaps.push({ label: 'Actuel', ts: lastTs, valeur: parsed[parsed.length - 1].valeurTotale });
  }

  // Calcul des deltas entre snapshots consécutifs
  return snaps.map((s, i) => ({
    ...s,
    varEur: i > 0 ? s.valeur - snaps[i - 1].valeur : null,
    varPct: i > 0 && snaps[i - 1].valeur > 0
      ? (s.valeur - snaps[i - 1].valeur) / snaps[i - 1].valeur * 100
      : null
  }));
}

function renderAnnualTable(log) {
  const rows = computeAnnualPerf(log);
  if (rows.length < 2) return '';

  return `
    <div class="sec-hd" style="margin-top:4px">BILAN ANNUEL</div>
    <div class="annual-wrap">
      <div class="annual-hdr">
        <span>PÉRIODE</span><span>VALEUR</span><span style="text-align:right">VARIATION</span>
      </div>
      ${rows.map((r, i) => `
        <div class="annual-row${i === rows.length - 1 ? ' annual-current' : ''}">
          <div class="annual-label">${r.label}</div>
          <div class="annual-val">${fmt.eur(r.valeur)}</div>
          <div class="annual-delta">
            ${r.varEur !== null ? `
              <div class="annual-delta-eur ${cc(r.varEur)}">${fmt.eur(r.varEur, true)}</div>
              <div class="annual-delta-pct ${cc(r.varPct)}">${fmt.pct(r.varPct, true)}</div>
            ` : '<span class="col-t2">—</span>'}
          </div>
        </div>`).join('')}
    </div>`;
}

function filterLog(log, period) {
  if (!log || !log.length) return [];
  const days = { '7j': 7, '1m': 30, '3m': 90, '6m': 180, 'tout': 99999 }[period] || 90;
  const cut  = Date.now() - days * 86400000;
  return log.filter(e => new Date(e.date).getTime() >= cut);
}

function periodBtns() {
  return [['7j','7J'],['1m','1M'],['3m','3M'],['6m','6M'],['tout','TOUT']].map(([k, l]) =>
    `<button class="period-btn ${S.period === k ? 'on' : ''}" onclick="setPeriod('${k}')">${l}</button>`
  ).join('');
}

function setPeriod(p) { S.period = p; renderEvolution(); }

// ═══════════════════════════════════════════════════════════════
// HISTORIQUE
// ═══════════════════════════════════════════════════════════════
function renderHistorique() {
  const { historique } = S.data;
  const { type, courtier, compte } = S.histoFilter;

  const courts  = [...new Set(historique.map(h => h.courtier).filter(Boolean))];
  const comptes = [...new Set(historique.map(h => h.compte).filter(Boolean))];

  const filtered = historique.filter(h =>
    (type === 'all'     || h.type === type) &&
    (courtier === 'all' || h.courtier === courtier) &&
    (compte === 'all'   || h.compte === compte)
  );

  const groups = {};
  filtered.forEach(h => { (groups[h.date] = groups[h.date] || []).push(h); });

  document.getElementById('page-historique').innerHTML = `
    <div class="histo-sticky">
      <div class="f-scroll">
        ${['all','ACHAT','VENTE','DIVIDENDES'].map(t => `
          <button class="f-chip ${type === t ? 'on' : ''}" onclick="setHistoType('${t}')">
            ${t === 'all' ? 'Tout' : cap(t)}
          </button>`).join('')}
      </div>
      <div class="f-scroll">
        ${courts.map(c => `
          <button class="f-chip ${courtier === c ? 'on' : ''}" onclick="toggleHistoCourt('${c}')">${c}</button>`).join('')}
        ${comptes.map(c => `
          <button class="f-chip ${compte === c ? 'on' : ''}" onclick="toggleHistoCompte('${c}')">${c}</button>`).join('')}
      </div>
    </div>
    <div class="histo-body">
      ${Object.keys(groups).length
        ? Object.entries(groups).map(([date, items]) => `
          <div class="date-grp">
            <div class="date-lbl">${date}</div>
            ${items.map(histoRow).join('')}
          </div>`).join('')
        : emptyState('📋','Aucune transaction')}
    </div>`;
}

function histoRow(h) {
  const ICONS = { ACHAT: '↑', VENTE: '↓', DIVIDENDES: '◆' };
  const colorCls = h.type === 'ACHAT' ? 'col-r' : 'col-g';
  return `
    <div class="h-item">
      <div class="h-ico ${h.type}">${ICONS[h.type] || '·'}</div>
      <div class="h-info">
        <div class="h-nom">${h.nom}</div>
        <div class="h-sub">
          <span class="h-tag">${h.courtier}</span>
          <span class="h-tag">${h.compte}</span>
        </div>
      </div>
      <div class="h-right">
        <div class="h-total ${colorCls}">${fmt.eur(h.total)}</div>
        ${h.unites ? `<div class="h-prix">${fmt.qty(Math.abs(h.unites))} × ${fmt.eur(h.prixUnite)}</div>` : ''}
      </div>
    </div>`;
}

function setHistoType(t)     { S.histoFilter.type = t; renderHistorique(); }
function toggleHistoCourt(c) { S.histoFilter.courtier = S.histoFilter.courtier === c ? 'all' : c; renderHistorique(); }
function toggleHistoCompte(c){ S.histoFilter.compte   = S.histoFilter.compte   === c ? 'all' : c; renderHistorique(); }

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function killChart(k) { if (S.charts[k]) { S.charts[k].destroy(); delete S.charts[k]; } }
function esc(s) { return String(s).replace(/'/g, "\\'"); }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; }
function emptyState(ico, txt) {
  return `<div class="empty-state"><div class="ico">${ico}</div><p>${txt.replace(/\n/g,'<br>')}</p></div>`;
}