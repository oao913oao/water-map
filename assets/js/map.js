import { fetchStores, STATUS, LAYERS, esc, fmtDate, storeUrl, baseLayers, renderChrome } from './lib.js';

renderChrome('index');
const L = window.L;

const map = L.map('map', { zoomControl: false, center: [23.7, 120.95], zoom: 8 });
L.control.zoom({ position: 'topright' }).addTo(map);
const bases = baseLayers(L);
bases['通用版電子地圖'].addTo(map);
L.control.layers(bases, null, { position: 'topright' }).addTo(map);

// 我的位置
const Locate = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const b = L.DomUtil.create('a', 'leaflet-bar leaflet-control');
    b.href = '#'; b.title = '移到我的位置'; b.setAttribute('role', 'button');
    b.style.cssText = 'width:34px;height:34px;display:grid;place-items:center;background:var(--card);font-size:18px;text-decoration:none;color:var(--ink)';
    b.innerHTML = '◎';
    L.DomEvent.on(b, 'click', e => { L.DomEvent.preventDefault(e); map.locate({ setView: true, maxZoom: 17 }); });
    return b;
  },
});
new Locate().addTo(map);
let meMarker = null;
map.on('locationfound', e => {
  meMarker?.remove();
  meMarker = L.circleMarker(e.latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#0B6A88', fillOpacity: 1 }).addTo(map);
});
map.on('locationerror', () => alert('無法取得位置，請確認已允許瀏覽器使用定位。'));

// 三個圖層（各自叢集）
const groups = Object.fromEntries(LAYERS.map(l => [l.key, L.markerClusterGroup({
  maxClusterRadius: 45, showCoverageOnHover: false,
  iconCreateFunction: c => L.divIcon({ html: `<div class="cluster ${l.key}">${c.getChildCount()}</div>`, className: '', iconSize: [40, 40] }),
})]));

let visible = { pass: true, fail: true, pending: true };
try { Object.assign(visible, JSON.parse(localStorage.getItem('layers') || '{}')); } catch { /* 瀏覽器不允許儲存 */ }

function pinIcon(status) {
  const s = STATUS[status] || STATUS.pending;
  return L.divIcon({ className: '', html: `<div class="pin ${status}"><span>${s.glyph}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28] });
}

function popupHtml(s) {
  const st = STATUS[s.status] || STATUS.pending;
  let detail = '';
  if (s.status === 'pass') detail = `<p>合格效期至 <b>${fmtDate(s.valid_until)}</b></p>${s.equipment ? `<p class="muted">${esc(s.equipment)}</p>` : ''}`;
  else if (s.status === 'fail') detail = `<p>原因：${esc(s.fail_reason || '未通過查核')}</p><p class="muted">查核日期 ${fmtDate(s.last_reviewed_at)}</p>`;
  else if (s.status === 'submitted') detail = `<p class="muted">店家已上傳資料，查核中</p>`;
  else detail = `<p class="muted">尚未查核</p>`;
  return `<h3>${esc(s.name)}</h3>
    <p><span class="tag ${s.status}">${st.label}</span> <span class="muted">${esc([s.area, s.category].filter(Boolean).join('／'))}</span></p>
    <p class="muted">${esc(s.address)}</p>${detail}
    <p><a class="btn" style="min-height:38px;width:100%" href="${storeUrl(s.id)}">查看查核紀錄</a></p>`;
}

let stores = [];
const markerById = new Map();

function renderChips() {
  const counts = { pass: 0, fail: 0, pending: 0 };
  stores.forEach(s => counts[(STATUS[s.status] || STATUS.pending).layer]++);
  const bar = document.getElementById('layerbar');
  bar.innerHTML = LAYERS.map(l => `<button type="button" class="chip" style="--chip:${l.color}" data-layer="${l.key}" aria-pressed="${visible[l.key]}">
      <span class="dot" style="background:${l.color}">${STATUS[l.key].glyph}</span>${l.label}<span class="count">${counts[l.key]}</span></button>`).join('');
  bar.querySelectorAll('.chip').forEach(btn => btn.addEventListener('click', () => {
    const k = btn.dataset.layer;
    visible[k] = !visible[k];
    btn.setAttribute('aria-pressed', visible[k]);
    visible[k] ? groups[k].addTo(map) : groups[k].remove();
    try { localStorage.setItem('layers', JSON.stringify(visible)); } catch { /* 忽略 */ }
  }));
}

function renderMarkers() {
  Object.values(groups).forEach(g => g.clearLayers());
  stores.forEach(s => {
    const m = L.marker([s.lat, s.lng], { icon: pinIcon(s.status), title: s.name, alt: `${s.name}（${(STATUS[s.status] || STATUS.pending).label}）` })
      .bindPopup(() => popupHtml(s), { maxWidth: 280 });
    groups[(STATUS[s.status] || STATUS.pending).layer].addLayer(m);
    markerById.set(s.id, m);
  });
  LAYERS.forEach(l => visible[l.key] ? groups[l.key].addTo(map) : groups[l.key].remove());
}

function focusStore(s) {
  const k = (STATUS[s.status] || STATUS.pending).layer;
  if (!visible[k]) document.querySelector(`.chip[data-layer="${k}"]`)?.click();
  const m = markerById.get(s.id);
  groups[k].zoomToShowLayer(m, () => m.openPopup());
}

// 搜尋
const q = document.getElementById('q'), results = document.getElementById('results');
q.addEventListener('input', () => {
  const t = q.value.trim().toLowerCase();
  if (!t) { results.classList.add('hidden'); return; }
  const hits = stores.filter(s => `${s.name} ${s.address} ${s.area || ''} ${s.category || ''}`.toLowerCase().includes(t)).slice(0, 8);
  results.innerHTML = hits.length
    ? hits.map(s => `<li><button type="button" data-id="${s.id}"><span class="tag ${s.status}">${STATUS[s.status]?.label}</span><span>${esc(s.name)}<br><small>${esc(s.address)}</small></span></button></li>`).join('')
    : `<li class="muted" style="padding:10px 14px">找不到「${esc(q.value)}」。試試店名的一部分，或改搜地址。</li>`;
  results.classList.remove('hidden');
});
results.addEventListener('click', e => {
  const b = e.target.closest('button[data-id]'); if (!b) return;
  const s = stores.find(x => String(x.id) === b.dataset.id);
  results.classList.add('hidden'); q.blur();
  focusStore(s);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') results.classList.add('hidden'); });
map.on('click', () => results.classList.add('hidden'));

// 觀光區快速切換
const areaSel = document.getElementById('area');
areaSel.addEventListener('change', () => {
  const list = stores.filter(s => !areaSel.value || s.area === areaSel.value);
  if (list.length) map.fitBounds(L.latLngBounds(list.map(s => [s.lat, s.lng])).pad(0.25), { maxZoom: 17 });
});

try {
  stores = await fetchStores();
  renderChips();
  renderMarkers();
  [...new Set(stores.map(s => s.area).filter(Boolean))].sort().forEach(a => areaSel.add(new Option(a, a)));
  if (stores.some(s => s.is_demo)) {
    const f = document.createElement('div');
    f.className = 'demo-flag'; f.textContent = '範例資料';
    document.querySelector('.map-wrap').append(f);
  }
  const focus = new URLSearchParams(location.search).get('store');
  const target = focus && stores.find(s => String(s.id) === focus);
  if (target) focusStore(target);
  else if (stores.length) map.fitBounds(L.latLngBounds(stores.map(s => [s.lat, s.lng])).pad(0.1));
} catch (err) {
  console.error(err);
  const n = document.createElement('div');
  n.className = 'notice error'; n.style.cssText = 'position:absolute;z-index:700;top:64px;left:12px;right:12px;max-width:460px';
  n.textContent = '店家資料載入失敗，請重新整理頁面。若持續發生，可能是資料庫暫停中，請稍後再試。';
  document.querySelector('.map-wrap').append(n);
}
