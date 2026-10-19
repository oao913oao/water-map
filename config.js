// 公開設定：publishable key 可安全放在前端（資料表已啟用 RLS）
window.APP_CONFIG = {
  SUPABASE_URL: "https://fpyykwuvhcwnrvcorszy.supabase.co",
  SUPABASE_KEY: "sb_publishable_eojv8i--wDzY-O5mIws8Fw_LjM4aJT9",
  PHOTO_BUCKET: "photos",
  MAP_CENTER: [23.7, 120.95], // 台灣
  MAP_ZOOM: 8,
};

window.STATUS = {
  pending: { label: "尚未查核", color: "#8a8f98" },
  passed:  { label: "查核合格", color: "#1f9d55" },
  failed:  { label: "查核不合格", color: "#d64545" },
};

window.sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);

window.photoUrl = (path) =>
  sb.storage.from(APP_CONFIG.PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;

window.esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 免費地址轉座標（OpenStreetMap Nominatim，請勿大量呼叫）
window.geocode = async (q) => {
  const r = await fetch(
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=tw&accept-language=zh-TW&q=" + encodeURIComponent(q)
  );
  const j = await r.json();
  return j[0] ? { lat: +j[0].lat, lng: +j[0].lon } : null;
};

window.pinIcon = (status) =>
  L.divIcon({
    className: "pin",
    html: `<span style="background:${STATUS[status].color}"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
