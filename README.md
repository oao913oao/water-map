# 合格用水場所地圖

觀光區店家淨水設備查核地圖。民眾看地圖、店家上傳濾水器與濾芯照片、查核員審核。

## 架構（全部使用免費方案）

| 部分 | 服務 |
|---|---|
| 網站託管 | Cloudflare Pages（連結本 repo，推送即部署） |
| 資料庫、登入、照片 | Supabase 免費方案 |
| 底圖 | 內政部國土測繪中心 WMTS（通用版電子地圖、正射影像） |
| 地圖程式庫 | Leaflet＋MarkerCluster |
| 每日排程 | GitHub Actions：逾期降級＋防止 Supabase 閒置暫停 |

純靜態網站，無建置步驟。

## 首次設定

1. Supabase → SQL Editor：依序執行 `supabase/schema.sql`、`supabase/seed.sql`（範例資料）。
2. Supabase → Authentication → Sign In / Providers → Email：關閉 **Confirm email**（內建寄信服務只寄給專案成員；正式上線改接自訂 SMTP 後再開啟）。
3. Supabase → Project Settings → API：把 Project URL 與 anon key 填入 `assets/js/config.js`。
4. Cloudflare Pages：連結此 repo，Build command 留空，Output directory 填 `/`。
5. 註冊自己的帳號後，在 SQL Editor 執行：

   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = '你的信箱');
   ```

## 頁面

- `/` 地圖：合格、不合格、未查核三圖層，搜尋、觀光區切換、定位
- `/store.html?id=` 店家查核紀錄
- `/account.html` 店家專區：註冊、認領、上傳
- `/admin.html` 查核後台：審核送件與認領、新增店家、統計
- `/about.html` 查核說明、更正與隱私

## 上線前

- 刪除範例資料：`delete from public.stores where is_demo;`
