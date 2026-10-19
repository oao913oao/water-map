// Supabase 連線設定。anon key 本來就是公開金鑰，資料安全由資料庫的 RLS 規則保護。
// 兩者留空時，網站會以「展示模式」讀取 assets/demo-stores.json。
export const SUPABASE_URL = 'https://fpyykwuvhcwnrvcorszy.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_eojv8i--wDzY-O5mIws8Fw_LjM4aJT9';

export const SITE_NAME = '合格用水場所地圖';
// 合格有效期限（月），審核通過時套用
export const VALID_MONTHS = 6;
