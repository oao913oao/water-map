import { sb, CONFIGURED, STATUS, REVIEW_LABEL, esc, fmtDate, todayStr, storeUrl, verificationCode, compressImage, renderChrome } from './lib.js';

renderChrome('account');
const $ = id => document.getElementById(id);
const msg = (text, kind = '') => { $('msg').innerHTML = text ? `<div class="notice ${kind}">${text}</div>` : ''; if (text) $('msg').scrollIntoView({ block: 'nearest' }); };
const busy = (btn, on, label) => { btn.disabled = on; if (label) btn.textContent = label; };

if (!CONFIGURED) {
  msg('網站目前是展示模式，尚未連接資料庫，暫時無法註冊與上傳。');
} else {
  const c = await sb();
  let user = null, uploadStore = null;

  /* ---------- 登入／註冊 ---------- */
  let mode = 'login';
  function setMode(m) {
    mode = m;
    $('auth-title').textContent = m === 'login' ? '登入' : '註冊店家帳號';
    $('auth-submit').textContent = m === 'login' ? '登入' : '註冊';
    $('auth-toggle').textContent = m === 'login' ? '還沒有帳號？註冊' : '已有帳號？登入';
    $('name-field').classList.toggle('hidden', m === 'login');
    $('password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  }
  $('auth-toggle').addEventListener('click', () => { setMode(mode === 'login' ? 'signup' : 'login'); msg(''); });
  $('auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('email').value.trim(), password = $('password').value;
    busy($('auth-submit'), true);
    const res = mode === 'login'
      ? await c.auth.signInWithPassword({ email, password })
      : await c.auth.signUp({ email, password, options: { data: { display_name: $('display-name').value.trim() } } });
    busy($('auth-submit'), false);
    if (res.error) {
      const m = res.error.message;
      msg(/Invalid login/i.test(m) ? 'Email 或密碼不正確。' : /registered/i.test(m) ? '這個 Email 已經註冊過，請直接登入。' : `無法${mode === 'login' ? '登入' : '註冊'}：${esc(m)}`, 'error');
    } else if (!res.data.session) {
      msg('註冊完成，請到信箱點擊確認信後再登入。', 'ok');
    } else msg('');
  });
  $('logout').addEventListener('click', () => c.auth.signOut());

  let ready = false;
  c.auth.onAuthStateChange((_e, session) => {
    const u = session?.user || null;
    if (ready && u?.id === user?.id) return;
    ready = true;
    user = u;
    $('auth').classList.toggle('hidden', !!user);
    $('dash').classList.toggle('hidden', !user);
    if (user) setTimeout(loadDashboard, 0); // 避免在 auth 回呼內直接呼叫資料庫
  });

  /* ---------- 儀表板 ---------- */
  async function loadDashboard() {
    $('who').textContent = `已登入：${user.email}`;
    const { data: prof } = await c.from('profiles').select('role').eq('id', user.id).maybeSingle();
    $('admin-link').classList.toggle('hidden', !['reviewer', 'admin'].includes(prof?.role));
    await Promise.all([loadStores(), loadSubs(), loadClaims()]);
    const pre = new URLSearchParams(location.search).get('claim');
    if (pre) preselectClaim(pre);
  }

  let myStores = [];
  async function loadStores() {
    const { data, error } = await c.from('stores').select('id,name,address,status,valid_until,fail_reason').eq('owner_id', user.id).order('id');
    if (error) return msg(`讀取店家失敗：${esc(error.message)}`, 'error');
    myStores = data;
    $('my-stores').innerHTML = data.length ? data.map(s => `<li>
        <div class="row" style="justify-content:space-between">
          <div><b><a href="${storeUrl(s.id)}">${esc(s.name)}</a></b> <span class="tag ${s.status}">${STATUS[s.status].label}</span><br>
          <span class="muted">${s.status === 'pass' ? `合格效期至 ${fmtDate(s.valid_until)}` : s.status === 'fail' ? `未通過：${esc(s.fail_reason || '')}` : esc(s.address)}</span></div>
          <button class="btn" type="button" data-upload="${s.id}">上傳資料</button>
        </div></li>`).join('')
      : '<li class="muted">你還沒有已認領的店。請在下方「認領我的店」送出申請，通過後就能上傳資料。</li>';
  }
  $('my-stores').addEventListener('click', async e => {
    const b = e.target.closest('[data-upload]'); if (!b) return;
    uploadStore = myStores.find(s => String(s.id) === b.dataset.upload);
    $('upload-store').textContent = uploadStore.name;
    $('vcode').textContent = await verificationCode(uploadStore.id);
    $('replaced').max = todayStr();
    $('upload-panel').classList.remove('hidden');
    $('upload-panel').scrollIntoView({ behavior: 'smooth' });
  });
  $('upload-cancel').addEventListener('click', () => { $('upload-panel').classList.add('hidden'); $('upload-form').reset(); });

  $('upload-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('upload-submit');
    const files = ['p1', 'p2', 'p3'].map(id => $(id).files[0]).filter(Boolean);
    try {
      busy(btn, true, '壓縮照片中…');
      const paths = [];
      for (const [i, f] of files.entries()) {
        const blob = await compressImage(f);
        const path = `${uploadStore.id}/${user.id}/${Date.now()}-${i + 1}.jpg`;
        busy(btn, true, `上傳照片 ${i + 1}/${files.length}…`);
        const { error } = await c.storage.from('submissions').upload(path, blob, { contentType: 'image/jpeg' });
        if (error) throw error;
        paths.push(path);
      }
      busy(btn, true, '送出中…');
      const { error } = await c.from('submissions').insert({
        store_id: uploadStore.id,
        purifier_model: $('purifier').value.trim(),
        cartridge_model: $('cartridge').value.trim() || null,
        replaced_on: $('replaced').value,
        verification_code: $('vcode').textContent,
        photo_paths: paths,
        note: $('note').value.trim() || null,
      });
      if (error) throw error;
      $('upload-form').reset(); $('upload-panel').classList.add('hidden');
      msg(`已送出「${esc(uploadStore.name)}」的資料，查核員審核後會更新地圖。`, 'ok');
      await Promise.all([loadStores(), loadSubs()]);
    } catch (err) {
      msg(`送出失敗：${esc(err.message || err)}。請確認網路後再試一次。`, 'error');
    } finally { busy(btn, false, '送出審核'); }
  });

  async function loadSubs() {
    const { data } = await c.from('submissions').select('id,store_id,status,review_comment,created_at,stores(name)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20);
    $('my-subs').innerHTML = data?.length ? data.map(s => `<li><b>${esc(s.stores?.name || '店家 #' + s.store_id)}</b>
        <span class="tag ${s.status}">${REVIEW_LABEL[s.status]}</span><br>
        <span class="muted">送件 ${fmtDate(s.created_at)}${s.review_comment ? `｜查核意見：${esc(s.review_comment)}` : ''}</span></li>`).join('')
      : '<li class="muted">還沒有送件紀錄。</li>';
  }

  /* ---------- 認領 ---------- */
  let searchTimer;
  $('claim-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const t = $('claim-search').value.trim();
      if (!t) return;
      const { data } = await c.from('map_stores').select('id,name,address,claimed').ilike('name', `%${t}%`).limit(20);
      fillClaimSelect(data || []);
    }, 300);
  });
  function fillClaimSelect(list) {
    const sel = $('claim-store');
    sel.innerHTML = list.length ? '' : '<option value="">找不到符合的店，可勾選下方申請新增</option>';
    list.forEach(s => sel.add(new Option(`${s.name}｜${s.address}${s.claimed ? '（已被認領）' : ''}`, s.id)));
  }
  async function preselectClaim(id) {
    const { data } = await c.from('map_stores').select('id,name,address,claimed').eq('id', id).maybeSingle();
    if (data) { fillClaimSelect([data]); $('claim-search').value = data.name; $('claim-panel').scrollIntoView(); }
  }
  $('claim-new').addEventListener('change', e => {
    $('new-fields').classList.toggle('hidden', !e.target.checked);
    $('claim-store').disabled = e.target.checked;
    ['new-name', 'new-address'].forEach(id => $(id).required = e.target.checked);
  });
  $('claim-form').addEventListener('submit', async e => {
    e.preventDefault();
    const isNew = $('claim-new').checked;
    if (!isNew && !$('claim-store').value) return msg('請先搜尋並選擇你的店，或勾選「申請新增」。', 'error');
    const row = {
      tax_id: $('tax-id').value.trim() || null,
      contact_name: $('contact-name').value.trim(),
      contact_phone: $('contact-phone').value.trim(),
      note: $('claim-note').value.trim() || null,
      ...(isNew
        ? { proposed_name: $('new-name').value.trim(), proposed_address: $('new-address').value.trim(), proposed_area: $('new-area').value.trim() || null, proposed_category: $('new-cat').value }
        : { store_id: Number($('claim-store').value) }),
    };
    busy($('claim-submit'), true);
    const { error } = await c.from('store_claims').insert(row);
    busy($('claim-submit'), false);
    if (error) return msg(`送出失敗：${esc(error.message)}`, 'error');
    $('claim-form').reset(); $('new-fields').classList.add('hidden'); $('claim-store').disabled = false; $('claim-store').innerHTML = '';
    msg('已送出認領申請，查核員確認後就能上傳資料。', 'ok');
    loadClaims();
  });
  async function loadClaims() {
    const { data } = await c.from('store_claims').select('id,status,store_id,proposed_name,review_comment,created_at').eq('user_id', user.id).order('created_at', { ascending: false });
    const ids = [...new Set((data || []).map(r => r.store_id).filter(Boolean))];
    const names = {};
    if (ids.length) (await c.from('map_stores').select('id,name').in('id', ids)).data?.forEach(s => { names[s.id] = s.name; });
    $('my-claims').innerHTML = data?.length ? data.map(r => `<li><b>${esc(names[r.store_id] || r.proposed_name || '店家 #' + r.store_id)}</b>
        <span class="tag ${r.status === 'approved' ? 'pass' : r.status === 'rejected' ? 'fail' : 'submitted'}">${REVIEW_LABEL[r.status]}</span><br>
        <span class="muted">申請 ${fmtDate(r.created_at)}${r.review_comment ? `｜${esc(r.review_comment)}` : ''}</span></li>`).join('')
      : '<li class="muted">還沒有認領申請。</li>';
  }
}
