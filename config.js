// 網站設定
// 接上 Supabase 後，把下面兩個值換成你自己專案的資料
// （Supabase 後台 → Project Settings → API）。
// anon key 是設計給前端公開使用的，但務必先執行 schema.sql 設好 RLS 權限。
// 兩個值都留空時，網站會以「示範模式」顯示 sample-stores.json。
export const CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",

  // 地圖初始中心與縮放（台灣全島）
  DEFAULT_CENTER: [23.7, 121.0],
  DEFAULT_ZOOM: 8,
};
