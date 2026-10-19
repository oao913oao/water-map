import { fetchStore, storeIdFromUrl, STATUS, esc, fmtDate, baseLayers, renderChrome, setMeta } from './lib.js';

renderChrome('store');
const main = document.getElementById('main');
const id = storeIdFromUrl();

function stampHtml(s) {
  const map = {
    pass: ['合格', `效期至 ${fmtDate(s.valid_until)}`],
    fail: ['不合格', `查核 ${fmtDate(s.last_reviewed_at)}`],
    submitted: ['審核中', '店家已送件'],
    pending: ['未查核', '尚無查核資料'],
  };
  const [big, small] = map[s.status] || map.pending;
  return `<div class="stamp land ${s.status}" role="img" aria-label="查核結果：${big}，${small}"><div><b>${big}</b><small>${esc(small)}</small></div></div>`;
}

function explain(s) {
  if (s.status === 'pass') return `這家店上傳了淨水設備與濾芯更換紀錄的照片，經查核員比對後判定合格。合格效期 6 個月，到期前店家需要重新上傳，否則會自動改回「未查核」。`;
  if (s.status === 'fail') return `這家店最近一次查核未通過。店家改善後可重新上傳資料申請複查。`;
  if (s.status === 'submitted') return `店家已上傳淨水設備資料，正在等待查核員審核。審核前地圖仍列在「未查核」。`;
  return `這家店還沒有查核資料。如果你是店家，可以到「店家專區」認領並上傳淨水設備照片。`;
}

if (!id) {
  main.innerHTML = `<div class="notice error">網址缺少店家編號。請從<a href="./">地圖</a>點選店家進入。</div>`;
} else {
  try {
    const s = await fetchStore(id);
    if (!s) throw new Error('not found');
    const st = STATUS[s.status] || STATUS.pending;
    setMeta({ title: `${s.name}（${st.label}）`, description: `${s.name}｜${s.address}｜淨水設備查核結果：${st.label}` });
    main.innerHTML = `
      <p><a href="./?store=${encodeURIComponent(s.id)}">回到地圖</a></p>
      <div class="store-head">
        <div>
          <h1>${esc(s.name)}</h1>
          <p class="muted">${esc([s.area, s.category].filter(Boolean).join('／'))}</p>
        </div>
        ${stampHtml(s)}
      </div>
      <p>${explain(s)}</p>
      ${s.is_demo ? '<div class="notice">這是範例資料，用來展示網站功能，並非真實店家。</div>' : ''}
      <section class="panel">
        <h2>查核資料</h2>
        <dl class="facts">
          <dt>地址</dt><dd>${esc(s.address)}</dd>
          ${s.phone ? `<dt>電話</dt><dd><a href="tel:${esc(s.phone)}">${esc(s.phone)}</a></dd>` : ''}
          <dt>目前結果</dt><dd><span class="tag ${s.status}">${st.label}</span></dd>
          ${s.equipment ? `<dt>淨水設備</dt><dd>${esc(s.equipment)}</dd>` : ''}
          ${s.status === 'fail' ? `<dt>未通過原因</dt><dd>${esc(s.fail_reason || '—')}</dd>` : ''}
          <dt>最近查核</dt><dd>${fmtDate(s.last_reviewed_at)}</dd>
          <dt>店家最近上傳</dt><dd>${fmtDate(s.last_submission_at)}</dd>
          <dt>店家認領</dt><dd>${s.claimed ? '已認領' : '尚未認領'}</dd>
        </dl>
      </section>
      <div class="minimap" id="minimap" aria-label="店家位置"></div>
      <div class="row" style="margin-top:16px">
        <button class="btn" id="share" type="button">分享這家店</button>
        <a class="btn secondary" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" rel="noopener">導航前往</a>
      </div>
      <p class="muted" style="margin-top:24px">我是這家店的負責人：<a href="account.html?claim=${encodeURIComponent(s.id)}">認領並上傳資料</a>。資料有誤：<a href="about.html#contact">申請更正</a>。</p>`;

    const L = window.L;
    const mm = L.map('minimap', { center: [s.lat, s.lng], zoom: 17, scrollWheelZoom: false });
    baseLayers(L)['通用版電子地圖'].addTo(mm);
    L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: `<div class="pin ${s.status}"><span>${st.glyph}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30] }) }).addTo(mm);

    document.getElementById('share').addEventListener('click', async () => {
      const data = { title: document.title, text: `${s.name} 的淨水設備查核結果：${st.label}`, url: location.href };
      try {
        if (navigator.share) await navigator.share(data);
        else { await navigator.clipboard.writeText(location.href); alert('已複製連結'); }
      } catch { /* 使用者取消分享 */ }
    });
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="notice error">找不到這家店（編號 ${esc(id)}）。它可能已被移除，請回到<a href="./">地圖</a>重新搜尋。</div>`;
  }
}
