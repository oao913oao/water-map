# 合格用水場所地圖

記錄各大觀光區使用合格淨水設備的店家，提供旅客參考。

- 底圖：內政部國土測繪中心（NLSC）電子地圖，免費使用
- 地圖套件：Leaflet
- 資料庫與照片儲存：Supabase（免費方案）
- 網站託管：GitHub Pages

> 本站為民間自主整理的資訊平台，並非政府機關網站。

## 圖層

| 顏色 | 狀態 |
| --- | --- |
| 灰色 | 尚未查核 |
| 綠色 | 查核合格 |
| 紅色 | 查核不合格 |

## 檔案說明

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 網頁主體 |
| `style.css` | 樣式（支援手機版與深色模式） |
| `app.js` | 地圖、篩選、分享連結、店家登錄表單 |
| `config.js` | Supabase 連線設定（留空時為示範模式） |
| `sample-stores.json` | 示範資料 |
| `schema.sql` | Supabase 資料表、權限（RLS）與照片儲存空間設定 |

## 接上 Supabase

1. 到 Supabase 後台 → **SQL Editor**，貼上 `schema.sql` 全部內容並執行。
2. 到 **Project Settings → API**，複製 Project URL 與 `anon` public key。
3. 編輯 `config.js`，填入 `SUPABASE_URL` 與 `SUPABASE_ANON_KEY` 後 commit。

## 審核流程（初期）

1. 店家從網站「店家登錄」送出資料與照片 → 存進 `submissions`（待審核）。
2. 管理員在 Supabase 後台 **Table Editor → submissions** 查看，照片在 **Storage → submission-photos**。
3. 審核後，在 `stores` 新增或更新該店家，設定 `status`（`unchecked` / `passed` / `failed`）與 `checked_on`，並把 submission 的 `review_status` 改為 `approved` 或 `rejected`。

## 分享單一店家

每家店都有獨立網址：`https://oao913oao.github.io/water-map/#store=<店家 id>`
