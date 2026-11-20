// 搶答鈴的 Supabase 設定（publishable / anon key 本來就是公開金鑰，可以放在網頁裡）。
// 兩個值都留空時，頁面會自動使用「模擬模式」（只在同一台電腦的瀏覽器分頁之間同步，供測試用）。
export const config = Object.freeze({
  supabaseUrl: '',      // 例：https://abcdefghijklmnop.supabase.co
  supabaseAnonKey: '',  // Supabase 後台 → Project Settings → API Keys → publishable key
});
