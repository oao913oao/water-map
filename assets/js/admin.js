import { sb, CONFIGURED, STATUS, esc, fmtDate, todayStr, storeUrl, verificationCode, baseLayers, renderChrome } from './lib.js';
import { VALID_MONTHS } from './config.js';

renderChrome('admin');
const $ = id => document.getElementById(id);
const msg = (text, kind = '') => { $('msg').innerHTML = text ? `<div class="notice ${kind}">${text}</div>` : ''; };
const L = window.L;

/* 座標選擇小地圖 */
function makePicker(el, onPick, center = [23.7, 120.95], zoom = 7) {
  const m = L.map(el, { center, zoom });
  baseLayers(L)['通用版電子地圖'].addTo(m);
  let mk = null;
  const set = (lat, lng, fly = true) => {
    mk ? mk.setLatLng([lat, lng]) : (mk = L.marker([lat, lng], { draggable: true }).addTo(m).on('dragend', e => { const p = e.target.getLatLng(); onPick(p.lat, p.lng); }));
    if (fly) m.setView([lat, lng], 18);
    onPick(lat, lng);
  };
  m.on('click', e => set(e.latlng.lat, e.latlng.lng, false));
  return { map: m, set };
}
async function geocode(address) {
  const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=tw&accept-language=zh-TW&q=${encodeURIComponent(address)}`;
  const r = await fetch(u, { headers: { Accept: 'application/json' } });
  const [hit] = await r.json();
  return hit ? [Number(hit.lat), Number(hit.lon)] : null;
}

if (!CONFIGURED) {
  msg('網站目前是展示模式，尚未連接資料庫。');
} else {
  const c = await sb();
  const { data: { session } } = await c.auth.getSession();
  const { data: prof } = session ? await c.from('profiles').select('role').eq('id', session.user.id).maybeSingle() : { data: null };
  if (!session) msg('請先到<a href="/account.html">店家專區</a>登入查核員帳號。', 'error');
  else if (!['reviewer', 'admin'].includes(prof?.role)) msg('這個帳號沒有查核權限。如需開通，請聯繫網站管理員。', 'error');
  else start(c);
}

function start(c) {
  $('app').classList.remove('hidden');
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
    document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab));
    if (b.dataset.tab === 'add') addMap.map.invalidateSize();
    if (b.dataset.tab === 'stats') loadStats();
  }));

  /* ---------- 待審送件 ---------- */
  async function loadSubs() {
    const { data, error } = await c.from('submissions').select('*, stores(name,address,status)').eq('status', 'pending').order('created_at');
    if (error) return msg(esc(error.message), 'error');
    $('n-subs').textContent = data.length ? `(${data.length})` : '';
    if (!data.length) { $('subs').innerHTML = '<li class="muted">目前沒有待審送件。</li>'; return; }
    const allPaths = data.flatMap(s => s.photo_paths);
    const { data: signed } = allPaths.length ? await c.storage.from('submissions').createSignedUrls(allPaths, 3600) : { data: [] };
    const urlOf = Object.fromEntries((signed || []).map(x => [x.path, x.signedUrl]));
    const items = await Promise.all(data.map(async s => {
      const expected = await verificationCode(s.store_id, todayStr(new Date(s.created_at)));
      const codeOk = expected === s.verification_code;
      return `<li data-id="${s.id}"><div class="review">
        <div>
          <h3><a href="${storeUrl(s.store_id)}" target="_blank">${esc(s.stores?.name)}</a></h3>
          <p class="muted">${esc(s.stores?.address)}｜送件 ${fmtDate(s.created_at)}</p>
          <dl class="facts">
            <dt>淨水器</dt><dd>${esc(s.purifier_model)}</dd>
            <dt>濾芯</dt><dd>${esc(s.cartridge_model || '—')}</dd>
            <dt>更換日期</dt><dd>${fmtDate(s.replaced_on)}</dd>
            <dt>驗證碼</dt><dd>照片應寫 <b>${expected}</b>
              <span class="code-check ${codeOk ? 'ok' : 'bad'}">${codeOk ? '（與送件日相符）' : `（系統紀錄 ${esc(s.verification_code)}，日期不符）`}</span></dd>
            ${s.note ? `<dt>說明</dt><dd>${esc(s.note)}</dd>` : ''}
          </dl>
        </div>
        <div class="photos">${s.photo_paths.map(p => `<a href="${urlOf[p] || '#'}" target="_blank" rel="noopener"><img src="${urlOf[p] || ''}" alt="店家上傳照片" loading="lazy"></a>`).join('')}</div>
      </div>
      <label for="cm-${s.id}">查核意見 <span class="muted">不合格與退件必填，會顯示給店家</span></label>
      <textarea id="cm-${s.id}"></textarea>
      <div class="row" style="margin-top:10px">
        <button class="btn ok" data-act="pass">合格（${VALID_MONTHS} 個月）</button>
        <button class="btn danger" data-act="fail">不合格</button>
        <button class="btn secondary" data-act="returned">退件補件</button>
      </div></li>`;
    }));
    $('subs').innerHTML = items.join('');
  }
  $('subs').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const li = b.closest('li'), id = Number(li.dataset.id), comment = $(`cm-${id}`).value.trim();
    if (b.dataset.act !== 'pass' && !comment) return msg('不合格或退件時，請填寫查核意見讓店家知道原因。', 'error');
    if (b.dataset.act === 'fail' && !confirm('判定不合格後，地圖會公開顯示此店為不合格。確定嗎？')) return;
    b.disabled = true;
    const { error } = await c.rpc('review_submission', { p_id: id, p_decision: b.dataset.act, p_comment: comment || null, p_valid_months: VALID_MONTHS });
    if (error) { b.disabled = false; return msg(esc(error.message), 'error'); }
    msg('已完成審核，地圖已更新。', 'ok');
    loadSubs();
  });

  /* ---------- 待審認領 ---------- */
  const pickers = new Map();
  async function loadClaims() {
    const { data, error } = await c.from('store_claims').select('*').eq('status', 'pending').order('created_at');
    if (error) return msg(esc(error.message), 'error');
    $('n-claims').textContent = data.length ? `(${data.length})` : '';
    if (!data.length) { $('claims').innerHTML = '<li class="muted">目前沒有待審認領。</li>'; return; }
    const ids = data.map(r => r.store_id).filter(Boolean);
    const { data: stores } = ids.length ? await c.from('stores').select('id,name,address,owner_id').in('id', ids) : { data: [] };
    const byId = Object.fromEntries((stores || []).map(s => [s.id, s]));
    $('claims').innerHTML = data.map(r => {
      const s = byId[r.store_id];
      return `<li data-id="${r.id}">
        <h3>${r.store_id ? `認領：${esc(s?.name)}` : `申請新增：${esc(r.proposed_name)}`}</h3>
        <p class="muted">${esc(s?.address || r.proposed_address)}${r.proposed_area ? `｜${esc(r.proposed_area)}` : ''}｜申請 ${fmtDate(r.created_at)}</p>
        ${s?.owner_id ? '<div class="notice error">這家店已經有店主，核准會改由此申請人管理。</div>' : ''}
        <dl class="facts">
          <dt>聯絡人</dt><dd>${esc(r.contact_name)}｜<a href="tel:${esc(r.contact_phone)}">${esc(r.contact_phone)}</a></dd>
          <dt>統一編號</dt><dd>${r.tax_id ? `${esc(r.tax_id)}　<a href="https://findbiz.nat.gov.tw/fts/query/QueryBar/queryInit.do" target="_blank" rel="noopener">至商工登記查詢</a>` : '未填'}</dd>
          ${r.note ? `<dt>說明</dt><dd>${esc(r.note)}</dd>` : ''}
        </dl>
        ${r.store_id ? '' : `<p><button class="btn secondary" type="button" data-geo>依地址找座標</button> <span class="muted" data-ll>請在地圖上點選店家位置</span></p><div class="pick-map" data-map></div>`}
        <label for="cc-${r.id}">審核意見 <span class="muted">選填，會顯示給申請人</span></label>
        <textarea id="cc-${r.id}"></textarea>
        <div class="row" style="margin-top:10px">
          <button class="btn ok" data-act="approved">核准</button>
          <button class="btn secondary" data-act="rejected">不核准</button>
        </div></li>`;
    }).join('');
    pickers.clear();
    data.filter(r => !r.store_id).forEach(r => {
      const li = $('claims').querySelector(`li[data-id="${r.id}"]`);
      const state = { lat: null, lng: null, address: r.proposed_address };
      state.picker = makePicker(li.querySelector('[data-map]'), (lat, lng) => {
        state.lat = lat; state.lng = lng;
        li.querySelector('[data-ll]').textContent = `座標 ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      });
      pickers.set(r.id, state);
    });
  }
  $('claims').addEventListener('click', async e => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    const id = Number(li.dataset.id), st = pickers.get(id);
    if (e.target.closest('[data-geo]')) {
      const hit = await geocode(st.address).catch(() => null);
      return hit ? st.picker.set(...hit) : msg('找不到這個地址的座標，請直接在地圖上點選。', 'error');
    }
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'approved' && st && st.lat == null) return msg('新增店家前，請先在地圖上點選位置。', 'error');
    b.disabled = true;
    const { error } = await c.rpc('review_claim', { p_id: id, p_decision: b.dataset.act, p_comment: $(`cc-${id}`).value.trim() || null, p_lat: st?.lat ?? null, p_lng: st?.lng ?? null });
    if (error) { b.disabled = false; return msg(esc(error.message), 'error'); }
    msg(b.dataset.act === 'approved' ? '已核准，申請人現在可以上傳資料。' : '已標記為不核准。', 'ok');
    loadClaims();
  });

  /* ---------- 新增店家 ---------- */
  let addLL = null;
  const addMap = makePicker($('a-map'), (lat, lng) => { addLL = [lat, lng]; $('a-ll').textContent = `座標 ${lat.toFixed(6)}, ${lng.toFixed(6)}`; });
  $('a-geo').addEventListener('click', async () => {
    const hit = await geocode($('a-address').value.trim()).catch(() => null);
    hit ? addMap.set(...hit) : msg('找不到這個地址的座標，請直接在地圖上點選。', 'error');
  });
  $('add-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!addLL) return msg('請先設定店家座標。', 'error');
    const { data, error } = await c.from('stores').insert({
      name: $('a-name').value.trim(), address: $('a-address').value.trim(), area: $('a-area').value.trim() || null,
      category: $('a-cat').value, phone: $('a-phone').value.trim() || null, lat: addLL[0], lng: addLL[1],
    }).select('id').single();
    if (error) return msg(esc(error.message), 'error');
    msg(`已新增店家，<a href="${storeUrl(data.id)}" target="_blank">查看店家頁</a>。`, 'ok');
    $('add-form').reset(); addLL = null; $('a-ll').textContent = '尚未選擇座標';
  });

  /* ---------- 統計 ---------- */
  async function loadStats() {
    const { data } = await c.from('map_stores').select('status,claimed,is_demo');
    const real = (data || []).filter(s => !s.is_demo);
    const n = k => real.filter(s => s.status === k).length;
    $('stats').innerHTML = [
      ['店家總數', real.length], ['合格', n('pass')], ['不合格', n('fail')],
      ['已申報待審', n('submitted')], ['未查核', n('pending')], ['已認領', real.filter(s => s.claimed).length],
      ['範例資料', (data || []).length - real.length],
    ].map(([t, v]) => `<div><span class="muted">${t}</span><b>${v}</b></div>`).join('');
  }

  loadSubs(); loadClaims();
}
