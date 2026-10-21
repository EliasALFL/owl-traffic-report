// Owl Traffic Report: FDOT traffic counts around FAU's Boca Raton campus.
// Data comes live from FDOT's public Florida Traffic Online ArcGIS service,
// with a bundled snapshot in /data used if that request fails.

const FDOT = 'https://gis.fdot.gov/arcgis/rest/services/FTO/fto_PROD/MapServer';
const BBOX = '-80.17,26.33,-80.05,26.42'; // Boca Raton, centered on FAU
const FAU = [26.3727, -80.1013];

const QUERY = `geometry=${BBOX}&geometryType=esriGeometryEnvelope&inSR=4326` +
  '&spatialRel=esriSpatialRelIntersects&outSR=4326&geometryPrecision=5&f=json';
const AADT_URL = `${FDOT}/7/query?${QUERY}&outFields=YEAR_,COSITE,ROADWAY,DESC_FRM,DESC_TO,AADT,KFCTR,DFCTR,TFCTR`;
const SITE_URLS = [1, 5].map(l => `${FDOT}/${l}/query?${QUERY}&outFields=*`);

// FDOT roadway IDs grouped into the corridors people actually call by name.
const CORRIDORS = [
  { id: 'i95', name: 'I-95', roadways: ['93220000'], color: '#001f3f' },
  { id: 'tpk', name: "Florida's Turnpike", roadways: ['93470000'], color: '#7a8ca3' },
  { id: 'glades', name: 'Glades Rd', roadways: ['93004000'], color: '#cc0000', fau: true },
  { id: 'palmetto', name: 'Palmetto Park Rd', roadways: ['93260000'], color: '#e08a00' },
  { id: 'yamato', name: 'Yamato Rd', roadways: ['93005000', '93862000'], color: '#2f7fd1' },
  { id: 'military', name: 'Military Trail', roadways: ['93070000'], color: '#1a7f4b' },
  { id: 'jog', name: 'Jog Rd', roadways: ['93000051'], color: '#8e44ad' },
  { id: 'powerline', name: 'Powerline Rd', roadways: ['93026000'], color: '#b8860b' },
  { id: 'clintmoore', name: 'Clint Moore Rd', roadways: ['93000001'], color: '#5d6d7e' },
  { id: 'us1', name: 'Federal Hwy (US-1)', roadways: ['93010000'], color: '#00897b' },
  { id: 'congress', name: 'Congress Ave', roadways: ['93580506', '93580500'], color: '#6d4c41' },
  { id: 'spanish', name: 'Spanish River Blvd', roadways: ['93000152', '93000014', '93002000'], color: '#c2185b' },
  { id: 'faublvd', name: 'FAU Blvd', roadways: ['93000166'], color: '#ff5252', fau: true },
  { id: 'a1a', name: 'A1A', roadways: ['93060000'], color: '#0097a7' },
];
const DEFAULT_TREND = ['glades', 'military', 'yamato', 'palmetto', 'faublvd', 'jog'];

const BINS = [
  { max: 10000, color: '#a9bfd8', label: '< 10k' },
  { max: 25000, color: '#5b86b8', label: '10k–25k' },
  { max: 40000, color: '#1f4f86', label: '25k–40k' },
  { max: 60000, color: '#e36a6a', label: '40k–60k' },
  { max: Infinity, color: '#cc0000', label: '60k+' },
];

const fmt = n => Math.round(n).toLocaleString('en-US');
const fmtK = n => n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : fmt(n);
const pct = n => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
const titleCase = s => s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase())
  .replace(/\b(Sr|Us|Nb|Sb|Eb|Wb|Nw|Ne|Sw|Se|Cr|Tpk|Fau)\b/g, w => w.toUpperCase());

async function getJSON(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j.error || !Array.isArray(j.features)) throw new Error('Bad FDOT response');
    return j;
  } finally {
    clearTimeout(t);
  }
}

async function loadData() {
  try {
    const [aadt, ...sites] = await Promise.all([getJSON(AADT_URL), ...SITE_URLS.map(u => getJSON(u))]);
    if (!aadt.features.length) throw new Error('No features');
    return { aadt: aadt.features, sites: sites.flatMap(s => s.features), live: true };
  } catch (err) {
    console.warn('Live FDOT fetch failed, using snapshot:', err);
    const [aadt, sites] = await Promise.all([
      fetch('data/aadt-snapshot.json').then(r => r.json()),
      fetch('data/sites-snapshot.json').then(r => r.json()),
    ]);
    return { aadt: aadt.features, sites: sites.features, live: false };
  }
}

function buildModel({ aadt, sites }) {
  const roadwayToCorridor = {};
  CORRIDORS.forEach(c => c.roadways.forEach(r => { roadwayToCorridor[r] = c; }));

  // Count stations give readable names for roadway IDs we don't map by hand.
  const siteNames = {};
  sites.forEach(s => {
    const a = s.attributes;
    if (!siteNames[a.SECTION_]) {
      siteNames[a.SECTION_] = titleCase(a.COMM.replace(/\(.*$/, '').replace(/^ON /, '').trim());
    }
  });

  const segments = aadt.map(f => {
    const a = f.attributes;
    const corridor = roadwayToCorridor[a.ROADWAY];
    const clean = s => (s && s !== 'N/A' ? titleCase(s) : null);
    return {
      year: a.YEAR_, cosite: a.COSITE, roadway: a.ROADWAY, aadt: a.AADT,
      k: a.KFCTR, d: a.DFCTR, t: a.TFCTR,
      from: clean(a.DESC_FRM), to: clean(a.DESC_TO),
      corridor,
      name: corridor ? corridor.name : (siteNames[a.ROADWAY] || 'Local road'),
      paths: (f.geometry?.paths || []).map(p => p.map(([x, y]) => [y, x])),
    };
  }).filter(s => s.aadt > 0);

  const years = [...new Set(segments.map(s => s.year))].sort();
  const latest = years[years.length - 1];

  const historyBySite = {};
  segments.forEach(s => { (historyBySite[s.cosite] ||= {})[s.year] = s.aadt; });

  const corridorStats = CORRIDORS.map(c => {
    const segs = segments.filter(s => s.corridor === c);
    if (!segs.length) return null;
    // Trend uses only count sites present in every year, so new sites don't skew it.
    const steady = [...new Set(segs.map(s => s.cosite))]
      .filter(cs => years.every(y => historyBySite[cs][y] != null));
    const byYear = {};
    years.forEach(y => {
      const pool = segs.filter(s => s.year === y && (steady.length ? steady.includes(s.cosite) : true));
      byYear[y] = pool.length ? avg(pool.map(s => s.aadt)) : null;
    });
    const factors = y => {
      const pool = segs.filter(s => s.year === y);
      return pool.length ? {
        aadt: avg(pool.map(s => s.aadt)),
        max: Math.max(...pool.map(s => s.aadt)),
        k: avg(pool.map(s => s.k)), d: avg(pool.map(s => s.d)), t: avg(pool.map(s => s.t)),
        n: pool.length,
      } : null;
    };
    const first = byYear[years[0]], last = byYear[latest];
    return { ...c, byYear, factors, change: first && last ? (last / first - 1) * 100 : null };
  }).filter(Boolean);

  return { segments, years, latest, historyBySite, corridorStats };
}

/* ---------- Status + KPIs ---------- */

function renderStatus(live, model) {
  const el = document.getElementById('data-status');
  el.className = `data-status ${live ? 'live' : 'cached'}`;
  el.innerHTML = `<span class="dot"></span>${live ? 'Live from FDOT' : 'FDOT snapshot (live service unreachable)'} · ` +
    `${model.years[0]}–${model.latest} counts · ${model.segments.filter(s => s.year === model.latest).length} road segments`;
}

function renderKpis(model) {
  const { corridorStats, latest, segments } = model;
  const get = id => corridorStats.find(c => c.id === id);
  const i95 = get('i95').factors(latest);
  const gladesSegs = segments.filter(s => s.year === latest && s.corridor?.id === 'glades');
  const gladesTop = gladesSegs.reduce((a, b) => (b.aadt > a.aadt ? b : a));
  const surface = corridorStats.filter(c => !['i95', 'tpk'].includes(c.id) && c.change != null);
  const fastest = surface.reduce((a, b) => (b.change > a.change ? b : a));
  const all = corridorStats.filter(c => c.change != null);
  const overall = avg(all.map(c => c.change));

  const tiles = [
    { label: `I-95 through Boca · ${latest}`, value: fmt(i95.aadt), note: 'vehicles per day, average of counted segments' },
    { label: 'Busiest Glades Rd segment', value: fmt(gladesTop.aadt),
      note: gladesTop.from && gladesTop.to ? `${gladesTop.from} → ${gladesTop.to}`
        : gladesTop.from || gladesTop.to ? `vehicles/day near ${gladesTop.from || gladesTop.to}` : 'vehicles per day' },
    { label: `Fastest-growing local road`, value: fastest.name,
      note: `<span class="up">${pct(fastest.change)}</span> since ${model.years[0]}` },
    { label: 'Average corridor growth', value: pct(overall),
      note: `across ${all.length} named roads, ${model.years[0]}–${latest}` },
  ];
  document.getElementById('kpis').innerHTML = tiles.map(t =>
    `<div class="kpi"><div class="label">${t.label}</div><div class="value">${t.value}</div><div class="note">${t.note}</div></div>`
  ).join('');
}

/* ---------- Map ---------- */

function binFor(v) { return BINS.find(b => v < b.max); }

function renderMap(model) {
  const map = L.map('leaflet-map', { scrollWheelZoom: false, maxZoom: 16 }).setView(FAU, 13);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri, HERE, Garmin, © OpenStreetMap contributors', maxZoom: 16,
  }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 16, pane: 'shadowPane',
  }).addTo(map);

  const owl = L.divIcon({ className: 'owl-pin', html: '<img src="img/owls-logo.svg" alt="">', iconSize: [54, 35], iconAnchor: [27, 18] });
  L.marker(FAU, { icon: owl, zIndexOffset: 1000 }).addTo(map)
    .bindPopup('<h4>FAU Boca Raton campus</h4>Home of the Owls. Glades Rd runs along the south edge, I-95 to the east.');

  const layer = L.layerGroup().addTo(map);
  const select = document.getElementById('year-select');
  select.innerHTML = [...model.years].reverse().map(y => `<option>${y}</option>`).join('');

  const draw = year => {
    layer.clearLayers();
    model.segments.filter(s => s.year === +year)
      .sort((a, b) => a.aadt - b.aadt)
      .forEach(s => {
        const bin = binFor(s.aadt);
        const weight = s.aadt > 100000 ? 8 : s.aadt > 40000 ? 6 : s.aadt > 15000 ? 4.5 : 3;
        const hist = model.historyBySite[s.cosite];
        const histRows = model.years.filter(y => hist[y] != null)
          .map(y => `<tr><td>${y}</td><td><b>${fmt(hist[y])}</b></td></tr>`).join('');
        const span = [s.from, s.to].filter(Boolean).join(' → ');
        const popup = `<h4>${s.name}</h4>${span ? `<div>${span}</div>` : ''}
          <div style="margin:6px 0"><b style="font-size:1.2rem">${fmt(s.aadt)}</b> vehicles/day (${s.year})</div>
          <table>${histRows}</table>
          <div style="margin-top:6px;color:#5a6778">Peak hour ≈ ${fmt(s.aadt * s.k / 100)} · Trucks ${s.t}%</div>`;
        L.polyline(s.paths, { color: bin.color, weight, opacity: .9 })
          .bindPopup(popup)
          .bindTooltip(`${s.name}: ${fmtK(s.aadt)}/day`, { sticky: true })
          .on('mouseover', e => e.target.setStyle({ weight: weight + 3 }))
          .on('mouseout', e => e.target.setStyle({ weight }))
          .addTo(layer);
      });
  };
  select.addEventListener('change', () => draw(select.value));
  draw(model.latest);

  document.getElementById('legend').innerHTML = 'Vehicles per day: ' +
    BINS.map(b => `<span><i style="background:${b.color}"></i>${b.label}</span>`).join('');
}

/* ---------- Charts ---------- */

Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
Chart.defaults.color = '#5a6778';

function renderCorridorChart(model) {
  const rows = model.corridorStats.map(c => ({ c, f: c.factors(model.latest) }))
    .filter(r => r.f).sort((a, b) => b.f.aadt - a.f.aadt);
  new Chart(document.getElementById('corridor-chart'), {
    type: 'bar',
    data: {
      labels: rows.map(r => r.c.name),
      datasets: [{
        label: `Avg vehicles/day (${model.latest})`,
        data: rows.map(r => Math.round(r.f.aadt)),
        backgroundColor: rows.map(r => (r.c.fau ? '#cc0000' : '#003366')),
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y', maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => {
          const f = rows[ctx.dataIndex].f;
          return [`Average: ${fmt(f.aadt)} / day`, `Busiest segment: ${fmt(f.max)}`, `${f.n} segment(s) counted`];
        } } },
      },
      scales: {
        x: { type: 'logarithmic', title: { display: true, text: 'Vehicles per day (log scale)' },
          ticks: { callback: v => ([5000, 10000, 20000, 50000, 100000, 200000].includes(v) ? fmtK(v) : '') },
          grid: { color: '#eef1f5' } },
        y: { grid: { display: false }, ticks: { color: '#14202e', font: { weight: 500 } } },
      },
    },
  });
}

function renderTrends(model) {
  const { corridorStats, years } = model;
  const active = new Set(DEFAULT_TREND.filter(id => corridorStats.some(c => c.id === id)));
  let indexed = false;

  const chips = document.getElementById('trend-chips');
  chips.innerHTML =
    `<button class="chip" data-mode aria-pressed="false">% change vs ${years[0]}</button>` +
    corridorStats.map(c => `<button class="chip" data-id="${c.id}" aria-pressed="${active.has(c.id)}"><i style="background:${c.color}"></i>${c.name}</button>`).join('');

  const datasets = () => corridorStats.filter(c => active.has(c.id)).map(c => {
    const base = c.byYear[years[0]];
    return {
      label: c.name,
      data: years.map(y => (c.byYear[y] == null ? null : indexed ? (c.byYear[y] / base - 1) * 100 : Math.round(c.byYear[y]))),
      borderColor: c.color, backgroundColor: c.color,
      borderWidth: c.fau ? 4 : 2.5, pointRadius: 4, tension: .25, spanGaps: true,
    };
  });

  const chart = new Chart(document.getElementById('trend-chart'), {
    type: 'line',
    data: { labels: years, datasets: datasets() },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${indexed ? pct(ctx.parsed.y) : fmt(ctx.parsed.y)}` } },
      },
      scales: {
        y: { ticks: { callback: v => (indexed ? `${v}%` : fmtK(v)) }, grid: { color: '#eef1f5' } },
        x: { grid: { display: false } },
      },
    },
  });

  chips.addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    if (btn.hasAttribute('data-mode')) {
      indexed = !indexed;
    } else {
      const id = btn.dataset.id;
      active.has(id) ? active.delete(id) : active.add(id);
    }
    btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') !== 'true');
    chart.data.datasets = datasets();
    chart.update();
  });

  document.getElementById('growth-table').innerHTML = corridorStats
    .filter(c => c.change != null)
    .sort((a, b) => b.change - a.change)
    .map(c => `<div><b>${c.name}</b><span class="${c.change >= 0 ? 'up' : 'down'}">${pct(c.change)}</span> · ${fmtK(c.byYear[years[0]])} → ${fmtK(c.byYear[model.latest])}/day</div>`)
    .join('');
}

/* ---------- Rush hour ---------- */

function renderRush(model) {
  const select = document.getElementById('rush-select');
  const usable = model.corridorStats.filter(c => c.factors(model.latest));
  select.innerHTML = usable.map(c => `<option value="${c.id}" ${c.id === 'glades' ? 'selected' : ''}>${c.name}</option>`).join('');

  const draw = () => {
    const c = usable.find(x => x.id === select.value);
    const f = c.factors(model.latest);
    const peak = f.aadt * f.k / 100;
    const heavy = peak * f.d / 100;
    const trucks = f.aadt * f.t / 100;
    document.getElementById('rush-grid').innerHTML = `
      <div class="rush-tile"><div class="label">Daily traffic</div><div class="big">${fmt(f.aadt)}</div><div class="what">vehicles per day, both directions (${model.latest})</div></div>
      <div class="rush-tile red"><div class="label">Peak hour · K ${f.k.toFixed(1)}%</div><div class="big">${fmt(peak)}</div><div class="what">vehicles in the design peak hour</div></div>
      <div class="rush-tile red"><div class="label">Heavy direction · D ${f.d.toFixed(1)}%</div><div class="big">${fmt(heavy)}</div><div class="what">≈ ${fmt(heavy / 60)} cars every minute one way</div></div>
      <div class="rush-tile"><div class="label">Trucks · T ${f.t.toFixed(1)}%</div><div class="big">${fmt(trucks)}</div><div class="what">trucks per day</div></div>`;
  };
  select.addEventListener('change', draw);
  draw();
}

/* ---------- Boot ---------- */

(async () => {
  try {
    const data = await loadData();
    const model = buildModel(data);
    renderStatus(data.live, model);
    renderKpis(model);
    renderMap(model);
    renderCorridorChart(model);
    renderTrends(model);
    renderRush(model);
  } catch (err) {
    console.error(err);
    const el = document.getElementById('data-status');
    el.className = 'data-status';
    el.textContent = 'Could not load traffic data. Please refresh.';
  }
})();
