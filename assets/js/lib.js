import { SUPABASE_URL, SUPABASE_ANON_KEY, SITE_NAME } from './config.js';

export const CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let _client = null;
export async function sb() {
  if (!CONFIGURED) throw new Error('網站尚未連接資料庫（展示模式）。');
  if (!_client) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _client;
}

/* ---------- 狀態 ---------- */
export const STATUS = {
  pending:   { label: '未查核',     layer: 'pending', glyph: '·' },
  submitted: { label: '已申報待審', layer: 'pending', glyph: '…' },
  pass:      { label: '合格',       layer: 'pass',    glyph: '✓' },
  fail:      { label: '不合格',     layer: 'fail',    glyph: '✕' },
};
export const LAYERS = [
  { key: 'pass',    label: '合格',   color: 'var(--pass)' },
  { key: 'fail',    label: '不合格', color: 'var(--fail)' },
  { key: 'pending', label: '未查核', color: 'var(--pending)' },
];
export const REVIEW_LABEL = { pending: '待審核', pass: '合格', fail: '不合格', returned: '退件補件', approved: '已核准', rejected: '未核准' };

/* ---------- 資料 ---------- */
export async function fetchStores() {
  if (!CONFIGURED) {
    const r = await fetch(new URL('../demo-stores.json', import.meta.url));
    return r.json();
  }
  const c = await sb();
  const { data, error } = await c.from('map_stores').select('*').order('id');
  if (error) throw error;
  return data;
}
export async function fetchStore(id) {
  if (!CONFIGURED) return (await fetchStores()).find(s => String(s.id) === String(id)) || null;
  const c = await sb();
  const { data, error } = await c.from('map_stores').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

/* ---------- 工具 ---------- */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
export function fmtDate(d) {
  if (!d) return '—';
  const t = new Date(d);
  return `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')}`;
}
export function todayStr(d = new Date()) {
  const tz = new Date(d.getTime() + 8 * 3600e3); // 以台灣時間計
  return tz.toISOString().slice(0, 10);
}
export function storeUrl(id) {
  return `store.html?id=${encodeURIComponent(id)}`;
}
export function storeIdFromUrl() {
  const m = location.pathname.match(/\/store\/(\d+)/);
  return m ? m[1] : new URLSearchParams(location.search).get('id');
}

// 當日驗證碼：店家手寫在紙條上一起入鏡，查核員可用送件日期重新算出比對
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export async function verificationCode(storeId, dateStr = todayStr()) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`water-map|${storeId}|${dateStr}`));
  const b = new Uint8Array(buf);
  return Array.from(b.slice(0, 4), x => ALPHA[x % ALPHA.length]).join('');
}

// 在瀏覽器端壓縮照片（長邊 1600px、JPEG），節省免費儲存額度
export async function compressImage(file, maxDim = 1600, quality = 0.78) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  const src = bmp || await new Promise((res, rej) => {
    const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = URL.createObjectURL(file);
  });
  const w = src.width, h = src.height, k = Math.min(1, maxDim / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
  return new Promise(res => cv.toBlob(res, 'image/jpeg', quality));
}

/* ---------- 底圖：國土測繪中心 WMTS（免申請） ---------- */
export function baseLayers(L) {
  const attr = '底圖 © <a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noopener">內政部國土測繪中心</a>';
  const nlsc = (layer) => L.tileLayer(`https://wmts.nlsc.gov.tw/wmts/${layer}/default/GoogleMapsCompatible/{z}/{y}/{x}`,
    { attribution: attr, maxNativeZoom: 19, maxZoom: 20, minZoom: 7 });
  return { '通用版電子地圖': nlsc('EMAP'), '正射影像': nlsc('PHOTO2') };
}

/* ---------- 共用頁首、頁尾 ---------- */
const LOGO = `<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M13 2C13 2 5 11.5 5 16.5a8 8 0 0 0 16 0C21 11.5 13 2 13 2Z" fill="var(--action)"/><path d="m9.5 16.5 2.6 2.6 4.6-5" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export function renderChrome(active) {
  const nav = [['index', './', '地圖'], ['about', 'about.html', '查核說明'], ['account', 'account.html', '店家專區']];
  const header = document.createElement('header');
  header.className = 'topbar';
  header.innerHTML = `<a class="brand" href="./">${LOGO}<span>${esc(SITE_NAME)}</span></a>
    <nav aria-label="主選單">${nav.map(([k, href, t]) => `<a href="${href}"${k === active ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;
  document.body.prepend(header);
  if (active !== 'index') {
    const f = document.createElement('footer');
    f.className = 'site';
    f.innerHTML = `${esc(SITE_NAME)}為民間自主查核平台，非政府機關網站。查核結果反映送件當時的資料，如有錯誤請由<a href="about.html#contact">更正申請</a>聯繫我們。`;
    document.body.append(f);
  }
}

export function setMeta({ title, description }) {
  if (title) document.title = `${title}｜${SITE_NAME}`;
  if (description) document.querySelector('meta[name="description"]')?.setAttribute('content', description);
}
