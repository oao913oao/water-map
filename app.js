import { CONFIG } from "./config.js";

const STATUS = {
  unchecked: { label: "尚未查核", color: "#8a8f98" },
  passed: { label: "查核合格", color: "#1a9e5a" },
  failed: { label: "查核不合格", color: "#d6453d" },
};
const PHOTO_BUCKET = "submission-photos";
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const useSupabase = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
let supabase = null;

const state = {
  stores: [],
  area: "all",
  query: "",
  statuses: new Set(Object.keys(STATUS)),
  markers: new Map(),
};

const $ = (sel) => document.querySelector(sel);
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- Map ----------
const map = L.map("map").setView(CONFIG.DEFAULT_CENTER, CONFIG.DEFAULT_ZOOM);
L.tileLayer("https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}", {
  minZoom: 7,
  maxZoom: 19,
  attribution: '底圖：<a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noopener">內政部國土測繪中心</a>',
}).addTo(map);
const storeLayer = L.layerGroup().addTo(map);

const legend = L.control({ position: "bottomright" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "leaflet-bar");
  div.style.cssText = "background:#fff;padding:6px 10px;font-size:12px;line-height:1.8;color:#17212b";
  div.innerHTML = Object.entries(STATUS)
    .map(([k, s]) => `<div><span class="dot dot-${k}"></span> ${s.label}</div>`)
    .join("");
  return div;
};
legend.addTo(map);

// ---------- Data ----------
async function loadStores() {
  if (useSupabase) {
    const mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
    supabase = mod.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    const { data, error } = await supabase
      .from("stores")
      .select("id,name,area,address,lat,lng,status,equipment,cartridge_replaced_on,checked_on,note")
      .order("name");
    if (error) throw error;
    return data ?? [];
  }
  $("#demo-banner").hidden = false;
  const res = await fetch("sample-stores.json");
  return res.json();
}

// ---------- Rendering ----------
function filteredStores() {
  const q = state.query.trim().toLowerCase();
  return state.stores.filter(
    (s) =>
      (state.area === "all" || s.area === state.area) &&
      state.statuses.has(s.status) &&
      (!q || `${s.name} ${s.address ?? ""} ${s.area}`.toLowerCase().includes(q))
  );
}

function popupHtml(s) {
  const st = STATUS[s.status] ?? STATUS.unchecked;
  const rows = [
    ["觀光區", s.area],
    ["地址", s.address],
    ["設備", s.equipment],
    ["濾芯更換", s.cartridge_replaced_on],
    ["查核日期", s.checked_on],
    ["備註", s.note],
  ].filter(([, v]) => v);
  return `<div class="popup">
    <h3>${esc(s.name)}</h3>
    <span class="badge" style="background:${st.color}">${st.label}</span>
    ${s.demo ? '<div class="demo-tag">（示範資料）</div>' : ""}
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    <button class="btn btn-small" data-share="${esc(s.id)}" type="button">分享這家店</button>
  </div>`;
}

function render() {
  const list = filteredStores();
  storeLayer.clearLayers();
  state.markers.clear();

  for (const s of list) {
    const st = STATUS[s.status] ?? STATUS.unchecked;
    const m = L.circleMarker([s.lat, s.lng], {
      radius: 9,
      color: "#ffffff",
      weight: 2,
      fillColor: st.color,
      fillOpacity: 0.95,
    }).bindPopup(popupHtml(s));
    m.addTo(storeLayer);
    state.markers.set(String(s.id), m);
  }

  const ul = $("#store-list");
  ul.innerHTML = list
    .map(
      (s) => `<li tabindex="0" data-id="${esc(s.id)}">
        <span class="dot dot-${esc(s.status)}"></span>
        <div><strong>${esc(s.name)}</strong><small>${esc(s.area)} · ${STATUS[s.status]?.label ?? ""}</small></div>
      </li>`
    )
    .join("");
  $("#result-count").textContent = `共 ${list.length} 家店`;

  // counts per status (within current area + query)
  const base = state.stores.filter((s) => state.area === "all" || s.area === state.area);
  for (const k of Object.keys(STATUS)) {
    const el = document.querySelector(`[data-count="${k}"]`);
    if (el) el.textContent = base.filter((s) => s.status === k).length;
  }
}

function focusStore(id) {
  const m = state.markers.get(String(id));
  if (!m) return;
  map.setView(m.getLatLng(), Math.max(map.getZoom(), 16));
  m.openPopup();
}

function buildFilters() {
  const areas = [...new Set(state.stores.map((s) => s.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  $("#area-select").innerHTML =
    '<option value="all">全部地區</option>' + areas.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
  $("#area-options").innerHTML = areas.map((a) => `<option value="${esc(a)}">`).join("");

  $("#status-toggles").innerHTML = Object.entries(STATUS)
    .map(
      ([k, s]) => `<label class="toggle">
        <input type="checkbox" value="${k}" checked>
        <span class="dot dot-${k}"></span> ${s.label}
        <span class="count" data-count="${k}">0</span>
      </label>`
    )
    .join("");
}

// ---------- Events ----------
$("#area-select").addEventListener("change", (e) => {
  state.area = e.target.value;
  render();
  const pts = filteredStores().map((s) => [s.lat, s.lng]);
  if (state.area === "all") map.setView(CONFIG.DEFAULT_CENTER, CONFIG.DEFAULT_ZOOM);
  else if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
});
$("#search").addEventListener("input", (e) => {
  state.query = e.target.value;
  render();
});
$("#status-toggles").addEventListener("change", (e) => {
  if (e.target.checked) state.statuses.add(e.target.value);
  else state.statuses.delete(e.target.value);
  render();
});
$("#store-list").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (li) focusStore(li.dataset.id);
});
$("#store-list").addEventListener("keydown", (e) => {
  const li = e.target.closest("li[data-id]");
  if (li && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    focusStore(li.dataset.id);
  }
});

map.on("popupopen", (e) => {
  const btn = e.popup.getElement()?.querySelector("[data-share]");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const id = btn.dataset.share;
    const store = state.stores.find((s) => String(s.id) === id);
    const url = `${location.origin}${location.pathname}#store=${encodeURIComponent(id)}`;
    history.replaceState(null, "", `#store=${encodeURIComponent(id)}`);
    const title = `${store?.name ?? ""}｜合格用水場所地圖`;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        btn.textContent = "已複製連結";
      }
    } catch {
      /* user cancelled */
    }
  });
});

// ---------- Submission form ----------
const dialog = $("#submit-dialog");
const form = $("#submit-form");
const msg = $("#form-msg");
let pickMarker = null;

function setMsg(text, kind = "") {
  msg.textContent = text;
  msg.className = `form-msg ${kind}`;
}
function setLocation(lat, lng) {
  form.lat.value = lat.toFixed(6);
  form.lng.value = lng.toFixed(6);
  if (pickMarker) pickMarker.setLatLng([lat, lng]);
  else pickMarker = L.marker([lat, lng]).addTo(map);
}

$("#open-submit").addEventListener("click", () => {
  setMsg(useSupabase ? "" : "目前為示範模式，尚未連接資料庫，送出不會儲存資料。", useSupabase ? "" : "warn");
  dialog.showModal();
});
dialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dialog.close()));

$("#pick-on-map").addEventListener("click", () => {
  dialog.close();
  $("#pick-banner").hidden = false;
  map.getContainer().style.cursor = "crosshair";
  map.once("click", (e) => {
    setLocation(e.latlng.lat, e.latlng.lng);
    endPick();
    dialog.showModal();
  });
});
function endPick() {
  $("#pick-banner").hidden = true;
  map.getContainer().style.cursor = "";
}
$("#cancel-pick").addEventListener("click", () => {
  map.off("click");
  endPick();
  dialog.showModal();
});

$("#use-gps").addEventListener("click", () => {
  if (!navigator.geolocation) return setMsg("這個瀏覽器不支援定位。", "error");
  setMsg("定位中…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setLocation(pos.coords.latitude, pos.coords.longitude);
      map.setView([pos.coords.latitude, pos.coords.longitude], 17);
      setMsg("已取得目前位置。", "ok");
    },
    () => setMsg("無法取得位置，請改用「在地圖上點選」。", "error"),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const name = String(fd.get("store_name") || "").trim();
  const area = String(fd.get("area") || "").trim();
  const lat = parseFloat(fd.get("lat"));
  const lng = parseFloat(fd.get("lng"));
  const photos = fd.getAll("photos").filter((f) => f instanceof File && f.size > 0);

  if (!name || !area) return setMsg("請填寫店名與觀光區。", "error");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return setMsg("請設定店家位置。", "error");
  if (!fd.get("consent")) return setMsg("請勾選同意事項。", "error");
  if (photos.length > MAX_PHOTOS) return setMsg(`照片最多 ${MAX_PHOTOS} 張。`, "error");
  if (photos.some((f) => f.size > MAX_PHOTO_BYTES)) return setMsg("每張照片需小於 5 MB。", "error");
  if (photos.some((f) => !/^image\/(jpeg|png|webp)$/.test(f.type))) return setMsg("照片格式需為 JPG、PNG 或 WebP。", "error");

  if (!useSupabase) return setMsg("示範模式：資料格式檢查通過，但尚未連接資料庫，所以沒有送出。", "warn");

  const btn = $("#submit-btn");
  btn.disabled = true;
  setMsg("上傳中…");
  try {
    const id = crypto.randomUUID();
    const paths = [];
    for (const [i, f] of photos.entries()) {
      const ext = f.type.split("/")[1].replace("jpeg", "jpg");
      const path = `${id}/${i + 1}.${ext}`;
      const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, f, { contentType: f.type, upsert: false });
      if (error) throw error;
      paths.push(path);
    }
    const { error } = await supabase.from("submissions").insert({
      id,
      store_name: name,
      area,
      address: String(fd.get("address") || "").trim() || null,
      lat,
      lng,
      equipment: String(fd.get("equipment") || "").trim() || null,
      cartridge_replaced_on: fd.get("cartridge_replaced_on") || null,
      photo_paths: paths,
      contact: String(fd.get("contact") || "").trim() || null,
    });
    if (error) throw error;
    form.reset();
    if (pickMarker) {
      pickMarker.remove();
      pickMarker = null;
    }
    setMsg("已送出，審核通過後會顯示在地圖上。謝謝！", "ok");
  } catch (err) {
    console.error(err);
    setMsg("送出失敗，請稍後再試。", "error");
  } finally {
    btn.disabled = false;
  }
});

// ---------- Boot ----------
(async () => {
  try {
    state.stores = (await loadStores()).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  } catch (err) {
    console.error(err);
    $("#result-count").textContent = "資料載入失敗，請稍後重新整理。";
    return;
  }
  buildFilters();
  render();
  const m = location.hash.match(/store=([^&]+)/);
  if (m) focusStore(decodeURIComponent(m[1]));
})();
